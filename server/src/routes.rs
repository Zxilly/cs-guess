use std::time::Instant;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, HeaderName, Method, Request, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, watch},
    time::MissedTickBehavior,
};
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::{debug, warn};

use crate::{
    AppState,
    error::AppError,
    profile::{ProfileState, validate_anonymous_id},
    protocol::{
        ClientMessage, CreateRoomRequest, JoinRoomRequest, QueueCounts, QuickMatchRequest,
        SessionResponse,
    },
    state::validate_room_code,
};

pub fn app(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");
    let profile_token_header = HeaderName::from_static("x-profile-token");
    let config = state.config().clone();
    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            request_id_header.clone(),
            profile_token_header,
        ]);

    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/v1/rooms", post(create_room))
        .route("/v1/rooms/{code}/join", post(join_room))
        .route("/v1/rooms/{code}/ws", get(websocket))
        .route("/v1/matches/quick", post(quick_match))
        .route("/v1/matches/quick/{code}", delete(cancel_quick_match))
        .route("/v1/matches/queue", get(queue_counts))
        .route("/v1/matches/queue/ws", get(queue_counts_websocket))
        .route(
            "/v1/profiles/{anonymous_id}",
            get(load_profile).put(save_profile),
        )
        .fallback(not_found)
        .with_state(state)
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
                // Deliberately omit the query string because the WebSocket URI
                // carries a reconnect token.
                tracing::info_span!(
                    "http_request",
                    method = %request.method(),
                    path = %request.uri().path()
                )
            }),
        )
        .layer(RequestBodyLimitLayer::new(128 * 1024))
        .layer(ConcurrencyLimitLayer::new(config.http_concurrency_limit))
        .layer(cors)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

async fn live() -> Json<Health> {
    Json(Health { status: "ok" })
}

async fn ready(State(state): State<AppState>) -> Response {
    if state.is_ready() {
        (StatusCode::OK, Json(Health { status: "ready" })).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Health {
                status: "not_ready",
            }),
        )
            .into_response()
    }
}

async fn create_room(
    State(state): State<AppState>,
    Json(request): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<SessionResponse>), AppError> {
    state.admit_session_request().await?;
    let response = state
        .create_friend_room(
            request.identity_id,
            request.visibility,
            request.max_players,
            request.best_of,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn join_room(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Json(request): Json<JoinRoomRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    state.admit_session_request().await?;
    let response = state.join_room(&code, request.identity_id).await?;
    Ok(Json(response))
}

async fn quick_match(
    State(state): State<AppState>,
    Json(request): Json<QuickMatchRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    state.admit_session_request().await?;
    let response = state
        .quick_match(
            request.identity_id,
            request.visibility,
            request.best_of,
            request.party_size,
        )
        .await?;
    Ok(Json(response))
}

async fn queue_counts(State(state): State<AppState>) -> Json<QueueCounts> {
    Json(state.queue_counts())
}

async fn load_profile(
    State(state): State<AppState>,
    Path(anonymous_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ProfileState>, AppError> {
    validate_anonymous_id(&anonymous_id)?;
    let sync_token = profile_sync_token(&headers)?;
    let profile = state.load_profile(&anonymous_id, sync_token).await?;
    Ok(Json(profile))
}

async fn save_profile(
    State(state): State<AppState>,
    Path(anonymous_id): Path<String>,
    headers: HeaderMap,
    Json(profile): Json<ProfileState>,
) -> Result<Json<ProfileState>, AppError> {
    validate_anonymous_id(&anonymous_id)?;
    if profile.anonymous_id != anonymous_id {
        return Err(AppError::BadRequest(
            "profile path and payload IDs do not match".to_owned(),
        ));
    }
    let sync_token = profile_sync_token(&headers)?;
    let stored = state.save_profile(profile, sync_token).await?;
    Ok(Json(stored))
}

fn profile_sync_token(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("x-profile-token")
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)
}

async fn queue_counts_websocket(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let config = state.config().clone();
    if let Some(origin) = headers.get(ORIGIN)
        && !config
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
    {
        return Err(AppError::Unauthorized);
    }
    let receiver = state.subscribe_queue_counts();
    let permit = state.acquire_websocket()?;
    Ok(ws
        .max_message_size(1024)
        .max_frame_size(1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            serve_queue_counts(socket, receiver).await;
        }))
}

async fn serve_queue_counts(mut socket: WebSocket, mut receiver: watch::Receiver<QueueCounts>) {
    let initial_counts = *receiver.borrow_and_update();
    if send_queue_counts(&mut socket, initial_counts)
        .await
        .is_err()
    {
        return;
    }
    let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(15));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            changed = receiver.changed() => {
                if changed.is_err() {
                    break;
                }
                let counts = *receiver.borrow_and_update();
                if send_queue_counts(&mut socket, counts).await.is_err() {
                    break;
                }
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                if socket.send(Message::Ping(Bytes::new())).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn send_queue_counts(socket: &mut WebSocket, counts: QueueCounts) -> Result<(), axum::Error> {
    let message = serde_json::json!({
        "type": "queue_counts",
        "counts": counts,
    });
    socket.send(Message::Text(message.to_string().into())).await
}

#[derive(Deserialize)]
struct WebSocketQuery {
    session_token: String,
}

async fn cancel_quick_match(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<WebSocketQuery>,
) -> Result<StatusCode, AppError> {
    state.admit_session_request().await?;
    state.cancel_quick_match(&code, query.session_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn websocket(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<WebSocketQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    validate_room_code(&code)?;
    if query.session_token.len() > 128 {
        return Err(AppError::Unauthorized);
    }
    let config = state.config().clone();
    if let Some(origin) = headers.get(ORIGIN)
        && !config
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
    {
        return Err(AppError::Unauthorized);
    }
    let room = state.room(&code).await?;
    let permit = state.acquire_websocket()?;

    Ok(ws
        .max_message_size(8 * 1024)
        .max_frame_size(8 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            if let Err(error) = serve_socket(socket, room, query.session_token, config).await {
                debug!(%error, "websocket session ended");
            }
        }))
}

async fn serve_socket(
    socket: WebSocket,
    room: crate::room::RoomHandle,
    session_token: String,
    config: crate::Config,
) -> Result<(), AppError> {
    let (mut socket_tx, mut socket_rx) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::channel(config.ws_queue_capacity);
    let (player_id, connection_id) = room.connect(session_token, outbound_tx).await?;
    let mut heartbeat = tokio::time::interval(config.heartbeat_interval);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut last_client_activity = Instant::now();
    let mut rate_limit = TokenBucket::new(20.0, 10.0);

    loop {
        tokio::select! {
            event = outbound_rx.recv() => {
                let Some(event) = event else { break };
                let encoded =
                    serde_json::to_string(event.as_ref()).map_err(|_| AppError::Internal)?;
                if socket_tx.send(Message::Text(encoded.into())).await.is_err() {
                    break;
                }
            }
            inbound = socket_rx.next() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        last_client_activity = Instant::now();
                        if !rate_limit.take() {
                            warn!(%player_id, "websocket message rate exceeded");
                            let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                                code: 1008,
                                reason: "message rate exceeded".into(),
                            }))).await;
                            break;
                        }
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(message) => room.client_message(player_id, connection_id, message).await?,
                            Err(_) => {
                                room.protocol_error(player_id, connection_id).await;
                            }
                        }
                    }
                    Some(Ok(Message::Pong(_))) => last_client_activity = Instant::now(),
                    Some(Ok(Message::Ping(payload))) => {
                        last_client_activity = Instant::now();
                        if socket_tx.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Binary(_))) => {
                        let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                            code: 1003,
                            reason: "JSON text messages required".into(),
                        }))).await;
                        break;
                    }
                    Some(Err(_)) => break,
                }
            }
            _ = heartbeat.tick() => {
                if last_client_activity.elapsed() >= config.client_timeout {
                    let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                        code: 1001,
                        reason: "heartbeat timeout".into(),
                    }))).await;
                    break;
                }
                if socket_tx.send(Message::Ping(Bytes::new())).await.is_err() {
                    break;
                }
            }
        }
    }

    room.disconnect(player_id, connection_id).await;
    Ok(())
}

struct TokenBucket {
    tokens: f64,
    capacity: f64,
    refill_per_second: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, refill_per_second: f64) -> Self {
        Self {
            tokens: capacity,
            capacity,
            refill_per_second,
            last_refill: Instant::now(),
        }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens
            + now.duration_since(self.last_refill).as_secs_f64() * self.refill_per_second)
            .min(self.capacity);
        self.last_refill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "code": "not_found",
            "message": "route not found"
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, header},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_and_room_flow_work() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);

        let live = service
            .clone()
            .oneshot(Request::get("/health/live").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(live.status(), StatusCode::OK);

        let create = service
            .clone()
            .oneshot(json_request(
                "/v1/rooms",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "max_players": 4
                }),
            ))
            .await
            .unwrap();
        assert_eq!(create.status(), StatusCode::CREATED);
        let create_body: Value =
            serde_json::from_slice(&create.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let room_code = create_body["room_code"].as_str().unwrap();
        assert_eq!(create_body["snapshot"]["phase"], "waiting");
        assert!(create_body["snapshot"].get("mystery_id").is_none());

        let join = service
            .oneshot(json_request(
                &format!("/v1/rooms/{room_code}/join"),
                json!({"identity_id": "1nvisiblee"}),
            ))
            .await
            .unwrap();
        assert_eq!(join.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn quick_match_pairs_two_requests() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "best_of": 5
                }),
            ))
            .await
            .unwrap();
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let second = service
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "visibility": "hidden",
                    "best_of": 5
                }),
            ))
            .await
            .unwrap();
        let second: Value =
            serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        assert_eq!(first["room_code"], second["room_code"]);
        assert_eq!(second["snapshot"]["phase"], "waiting");
        assert_eq!(second["snapshot"]["best_of"], 5);
        assert!(second["snapshot"].get("deadline_unix_ms").is_none());
    }

    #[tokio::test]
    async fn quick_match_only_pairs_identical_rules_and_can_cancel() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "best_of": 1
                }),
            ))
            .await
            .unwrap();
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let second = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "visibility": "hidden",
                    "best_of": 3
                }),
            ))
            .await
            .unwrap();
        let second: Value =
            serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_ne!(first["room_code"], second["room_code"]);

        let cancel_uri = format!(
            "/v1/matches/quick/{}?session_token={}",
            first["room_code"].as_str().unwrap(),
            first["session_token"].as_str().unwrap()
        );
        let cancelled = service
            .clone()
            .oneshot(Request::delete(cancel_uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(cancelled.status(), StatusCode::NO_CONTENT);

        let missing = service
            .oneshot(json_request(
                &format!("/v1/rooms/{}/join", first["room_code"].as_str().unwrap()),
                json!({"identity_id": "2high"}),
            ))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cancelling_one_group_ticket_keeps_the_other_players_queued() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "best_of": 3,
                    "party_size": 4
                }),
            ))
            .await
            .unwrap();
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let second = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "visibility": "hidden",
                    "best_of": 3,
                    "party_size": 4
                }),
            ))
            .await
            .unwrap();
        let second: Value =
            serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        let cancel_uri = format!(
            "/v1/matches/quick/{}?session_token={}",
            first["room_code"].as_str().unwrap(),
            first["session_token"].as_str().unwrap()
        );
        let cancelled = service
            .clone()
            .oneshot(Request::delete(cancel_uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(cancelled.status(), StatusCode::NO_CONTENT);

        let replacement = service
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "2high",
                    "visibility": "hidden",
                    "best_of": 3,
                    "party_size": 4
                }),
            ))
            .await
            .unwrap();
        let replacement: Value =
            serde_json::from_slice(&replacement.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(second["room_code"], replacement["room_code"]);
    }

    #[tokio::test]
    async fn arbitrary_custom_identity_is_rejected() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let response = app(state)
            .oneshot(json_request(
                "/v1/rooms",
                json!({
                    "identity_id": "custom-name",
                    "visibility": "hidden",
                    "max_players": 2
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn queue_counts_follow_waiting_players() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);

        let initial = service
            .clone()
            .oneshot(
                Request::get("/v1/matches/queue")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let initial: Value =
            serde_json::from_slice(&initial.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(
            initial,
            json!({
                "bo1": 0,
                "bo3": 0,
                "bo5": 0,
                "bo1_hidden": 0,
                "bo1_open": 0,
                "bo3_hidden": 0,
                "bo3_open": 0,
                "bo5_hidden": 0,
                "bo5_open": 0,
                "total": 0,
                "group_bo1": 0,
                "group_bo3": 0,
                "group_bo5": 0,
                "group_bo1_hidden": 0,
                "group_bo1_open": 0,
                "group_bo3_hidden": 0,
                "group_bo3_open": 0,
                "group_bo5_hidden": 0,
                "group_bo5_open": 0,
                "group_total": 0
            })
        );

        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "best_of": 5
                }),
            ))
            .await
            .unwrap();
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();

        let waiting = service
            .clone()
            .oneshot(
                Request::get("/v1/matches/queue")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let waiting: Value =
            serde_json::from_slice(&waiting.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(
            waiting,
            json!({
                "bo1": 0,
                "bo3": 0,
                "bo5": 1,
                "bo1_hidden": 0,
                "bo1_open": 0,
                "bo3_hidden": 0,
                "bo3_open": 0,
                "bo5_hidden": 1,
                "bo5_open": 0,
                "total": 1,
                "group_bo1": 0,
                "group_bo3": 0,
                "group_bo5": 0,
                "group_bo1_hidden": 0,
                "group_bo1_open": 0,
                "group_bo3_hidden": 0,
                "group_bo3_open": 0,
                "group_bo5_hidden": 0,
                "group_bo5_open": 0,
                "group_total": 0
            })
        );

        let paired = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "visibility": "hidden",
                    "best_of": 5
                }),
            ))
            .await
            .unwrap();
        assert_eq!(paired.status(), StatusCode::OK);

        let empty = service
            .oneshot(
                Request::get("/v1/matches/queue")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let empty: Value =
            serde_json::from_slice(&empty.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(
            empty,
            json!({
                "bo1": 0,
                "bo3": 0,
                "bo5": 0,
                "bo1_hidden": 0,
                "bo1_open": 0,
                "bo3_hidden": 0,
                "bo3_open": 0,
                "bo5_hidden": 0,
                "bo5_open": 0,
                "total": 0,
                "group_bo1": 0,
                "group_bo3": 0,
                "group_bo5": 0,
                "group_bo1_hidden": 0,
                "group_bo1_open": 0,
                "group_bo3_hidden": 0,
                "group_bo3_open": 0,
                "group_bo5_hidden": 0,
                "group_bo5_open": 0,
                "group_total": 0
            })
        );
        assert!(first["session_token"].is_string());
    }

    fn json_request(uri: &str, body: Value) -> Request<Body> {
        Request::post(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }
}
