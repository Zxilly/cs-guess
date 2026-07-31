//! Engine.IO WebSocket transport backed by Yawc.
//!
//! Yawc performs the HTTP upgrade and RFC 7692 permessage-deflate
//! negotiation. The Engine.IO and Socket.IO packet layers remain unchanged.

use std::sync::Arc;

use bytes::Bytes;
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use http::{Request, Response, request::Parts};
use smallvec::smallvec;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::future::FutureExt as _;
#[cfg(feature = "__test_harness")]
use yawc::Role;
use yawc::{Frame, OpCode, Options, WebSocket};

use engineioxide_core::{Packet, ProtocolVersion, Sid, Str, TransportType};

use crate::{
    DisconnectReason, Socket, body::ResponseBody, config::EngineIoConfig, engine::EngineIo,
    errors::Error, handler::EngineIoHandler, socket::InternalRx, transport::make_open_packet,
};

const COMPRESSION_THRESHOLD: usize = 1024;

/// Upgrade a WebSocket request and negotiate permessage-deflate when offered by
/// the client. Polling-to-WebSocket upgrades keep their existing Engine.IO SID.
pub fn new_req<R: Send + 'static, B, H: EngineIoHandler>(
    engine: Arc<EngineIo<H>>,
    protocol: ProtocolVersion,
    sid: Option<Sid>,
    req: Request<R>,
) -> Result<Response<ResponseBody<B>>, Error> {
    let (parts, body) = req.into_parts();
    let req_data = parts.clone();
    let mut req = Request::from_parts(parts, body);

    let options = websocket_options(&engine.config)
        .with_low_latency_compression()
        .with_compression_threshold(COMPRESSION_THRESHOLD)
        .server_no_context_takeover()
        .client_no_context_takeover();
    let (response, upgrade) = WebSocket::upgrade_with_options(&mut req, options)?;

    tokio::spawn(async move {
        let res = match upgrade.await {
            Ok(ws) => on_init(engine.clone(), ws, protocol, sid, req_data).await,
            Err(_e) => {
                #[cfg(feature = "tracing")]
                tracing::debug!("ws upgrade error: {}", _e);
                return;
            }
        };

        match res {
            Ok(_) => {
                #[cfg(feature = "tracing")]
                tracing::debug!(?sid, "ws closed")
            }
            Err(Error::MultipleWebsocketRequests) => {}
            Err(_e) => {
                #[cfg(feature = "tracing")]
                tracing::debug!(?sid, "ws closed with error: {_e}");
                if let Some(sid) = sid {
                    engine.close_session(sid, DisconnectReason::TransportError);
                }
            }
        }
    });

    let (parts, _) = response.into_parts();
    Ok(Response::from_parts(parts, ResponseBody::empty_response()))
}

fn websocket_options(config: &EngineIoConfig) -> Options {
    let max_payload = usize::try_from(config.max_payload).unwrap_or(usize::MAX / 2);
    Options::default()
        .with_limits(max_payload, max_payload.saturating_mul(2))
        .with_utf8()
}

#[cfg(feature = "__test_harness")]
pub fn raw_websocket<S>(conn: S, config: &EngineIoConfig) -> WebSocket<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    WebSocket::from_raw_socket(Role::Server, conn, websocket_options(config))
}

/// Initialize a newly upgraded Yawc stream.
#[cfg_attr(
    feature = "tracing",
    tracing::instrument(level = "trace", name = "init_websocket", skip(engine, ws, req_data))
)]
pub async fn on_init<H: EngineIoHandler, S>(
    engine: Arc<EngineIo<H>>,
    mut ws: WebSocket<S>,
    protocol: ProtocolVersion,
    sid: Option<Sid>,
    req_data: Parts,
) -> Result<(), Error>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let socket = if let Some(sid) = sid {
        match engine.get_socket(sid) {
            None => return Err(Error::UnknownSessionID(sid)),
            Some(socket) if socket.is_ws() => return Err(Error::MultipleWebsocketRequests),
            Some(socket) => {
                let upgrade_fut = upgrade_handshake::<H, S>(&socket, &mut ws);
                match tokio::time::timeout(engine.config.upgrade_timeout, upgrade_fut)
                    .with_cancellation_token(&socket.cancellation_token)
                    .await
                {
                    Some(Ok(res)) => res?,
                    Some(Err(_)) => {
                        #[cfg(feature = "tracing")]
                        tracing::debug!(?sid, "ws upgrade timed out, closing session");
                        engine.close_session(socket.id, DisconnectReason::TransportError);
                        return Err(Error::Upgrade);
                    }
                    None => {
                        #[cfg(feature = "tracing")]
                        tracing::debug!(?sid, "socket is being closed");
                        return Err(Error::Upgrade);
                    }
                }
                socket
            }
        }
    } else {
        let socket = engine.create_session(protocol, TransportType::Websocket, req_data, false);

        #[cfg(feature = "tracing")]
        tracing::debug!("new websocket connection");

        init_handshake(socket.id, &mut ws, &engine.config).await?;
        socket
            .clone()
            .spawn_heartbeat(engine.config.ping_interval, engine.config.ping_timeout);
        socket
    };
    let (tx, rx) = ws.split();

    tokio::spawn(forward_to_socket::<H, S>(socket.clone(), tx));

    match forward_to_handler(&engine, rx, &socket)
        .with_cancellation_token(&socket.cancellation_token)
        .await
    {
        Some(Err(ref e)) => {
            let reason =
                Option::<DisconnectReason>::from(e).unwrap_or(DisconnectReason::TransportError);

            #[cfg(feature = "tracing")]
            tracing::debug!("error when handling packet: {:?}", e);
            engine.close_session(socket.id, reason);
        }
        Some(Ok(())) => {
            #[cfg(feature = "tracing")]
            tracing::debug!(sid = %socket.id, "ws transport was closed");
            engine.close_session(socket.id, DisconnectReason::TransportClose);
        }
        None => {
            #[cfg(feature = "tracing")]
            tracing::debug!(sid = %socket.id, "socket is closing");
        }
    }
    Ok(())
}

async fn forward_to_handler<H: EngineIoHandler, S>(
    engine: &Arc<EngineIo<H>>,
    mut rx: SplitStream<WebSocket<S>>,
    socket: &Arc<Socket<H::Data>>,
) -> Result<(), Error>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    while let Some(frame) = rx.next().await {
        match frame.opcode() {
            OpCode::Text => {
                match Packet::parse(socket.protocol, ws_bytes_to_str(frame.into_payload()))? {
                    Packet::Close => {
                        #[cfg(feature = "tracing")]
                        tracing::debug!("[sid={}] closing session", socket.id);
                        engine.close_session(socket.id, DisconnectReason::TransportClose);
                        break;
                    }
                    Packet::Pong | Packet::Ping => socket
                        .heartbeat_tx
                        .try_send(())
                        .map_err(|_| Error::HeartbeatTimeout),
                    Packet::Message(msg) => {
                        engine.handler.on_message(msg, socket.clone());
                        Ok(())
                    }
                    p => return Err(Error::BadPacket(p)),
                }
            }
            OpCode::Binary => {
                let mut data = frame.into_payload();
                if socket.protocol == ProtocolVersion::V3 && !data.is_empty() {
                    data = data.slice(1..);
                }
                engine.handler.on_binary(data, socket.clone());
                Ok(())
            }
            OpCode::Close => {
                #[cfg(feature = "tracing")]
                tracing::debug!("websocket closed, closing session");
                engine.close_session(socket.id, DisconnectReason::TransportClose);
                break;
            }
            _ => {
                #[cfg(feature = "tracing")]
                tracing::debug!(sid = ?socket.id, "unexpected ws frame");
                Ok(())
            }
        }?
    }
    Ok(())
}

async fn forward_to_socket<H: EngineIoHandler, S>(
    socket: Arc<Socket<H::Data>>,
    mut tx: SplitSink<WebSocket<S>, Frame>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut internal_rx = socket.internal_rx.try_lock().unwrap();
    let InternalRx {
        buffered_rx,
        volatile_rx,
        ..
    } = &mut *internal_rx;

    macro_rules! map_fn {
        ($item:ident) => {
            let res = match $item {
                Packet::Binary(bin) | Packet::BinaryV3(bin) => {
                    if socket.protocol == ProtocolVersion::V3 {
                        let mut buff = Vec::with_capacity(bin.len() + 1);
                        buff.push(0x04);
                        buff.extend(bin);
                        tx.feed(Frame::binary(buff)).await
                    } else {
                        tx.feed(Frame::binary(bin)).await
                    }
                }
                Packet::Noop => Ok(()),
                _ => {
                    let packet: String = $item.try_into().unwrap();
                    tx.feed(Frame::text(packet)).await
                }
            };
            if let Err(_e) = res {
                #[cfg(feature = "tracing")]
                tracing::debug!("[sid={}] error sending packet: {}", socket.id, _e);
            }
        };
    }

    loop {
        tokio::select! {
            biased;
            items = buffered_rx.recv() => {
                match items {
                    Some(packets) => {
                        for item in packets {
                            map_fn!(item);
                        }
                        while let Ok(packets) = buffered_rx.try_recv() {
                            for item in packets {
                                map_fn!(item);
                            }
                        }
                    }
                    None => break
                }
            }
            _ = socket.cancellation_token.cancelled() => break,
            Ok(()) = volatile_rx.changed() => {
                let val = volatile_rx.borrow_and_update().clone();
                if let Some(packets) = val {
                    #[cfg(feature = "tracing")]
                    tracing::debug!(sid = ?socket.id, "ws volatile flush: {} packets", packets.len());
                    for item in packets {
                        map_fn!(item);
                    }
                }
            },
        }

        #[cfg(feature = "tracing")]
        tracing::trace!(sid = %socket.id, "ws flush");
        tx.flush().await.ok();
    }

    #[cfg(feature = "tracing")]
    tracing::trace!(sid = %socket.id, "ws closing flush");

    tx.flush().await.ok();
    tx.close().await.ok();
}

async fn init_handshake<S>(
    sid: Sid,
    ws: &mut WebSocket<S>,
    config: &EngineIoConfig,
) -> Result<(), Error>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let packet = Packet::Open(make_open_packet(TransportType::Websocket, sid, config));
    let packet: String = packet.into();
    ws.send(Frame::text(packet)).await?;
    Ok(())
}

#[cfg_attr(
    feature = "tracing",
    tracing::instrument(level = "trace", skip(socket, ws))
)]
async fn upgrade_handshake<H: EngineIoHandler, S>(
    socket: &Arc<Socket<H::Data>>,
    ws: &mut WebSocket<S>,
) -> Result<(), Error>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    #[cfg(feature = "tracing")]
    tracing::debug!("starting websocket connection upgrade");

    socket.start_upgrade();
    socket
        .internal_tx
        .send(smallvec![Packet::Noop])
        .await
        .map_err(|_| Error::Upgrade)?;

    let _lock = socket.internal_rx.lock().await;

    let msg = match ws.next().await {
        Some(frame) if frame.opcode() == OpCode::Text => frame.into_payload(),
        _ => Err(Error::Upgrade)?,
    };
    match Packet::parse(socket.protocol, ws_bytes_to_str(msg))? {
        Packet::PingUpgrade => {
            #[cfg(feature = "tracing")]
            tracing::debug!("received first ping upgrade");
            ws.send(Frame::text(String::from(Packet::PongUpgrade)))
                .await?;
        }
        p => Err(Error::BadPacket(p))?,
    };

    let frame = ws.next().await.ok_or(Error::Upgrade)?;
    if frame.opcode() == OpCode::Close {
        #[cfg(feature = "tracing")]
        tracing::debug!("ws stream closed before upgrade");
        return Err(Error::Upgrade);
    }
    if frame.opcode() != OpCode::Text {
        #[cfg(feature = "tracing")]
        tracing::debug!("unexpected ws message before upgrade");
        return Err(Error::Upgrade);
    }
    match Packet::parse(socket.protocol, ws_bytes_to_str(frame.into_payload()))? {
        Packet::Upgrade => {
            #[cfg(feature = "tracing")]
            tracing::debug!("ws upgraded successfully")
        }
        p => Err(Error::BadPacket(p))?,
    };

    socket.upgrade_to_websocket();
    Ok(())
}

fn ws_bytes_to_str(bytes: Bytes) -> Str {
    // Yawc validates incoming text frames because Options::with_utf8 is set.
    unsafe { Str::from_bytes_unchecked(bytes) }
}
