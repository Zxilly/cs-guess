use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode,
        header::{CACHE_CONTROL, ORIGIN},
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use socketioxide::{
    ParserConfig, SocketIo,
    extract::{AckSender, Data, SocketRef, State as SocketState},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tower::{ServiceExt as _, limit::ConcurrencyLimitLayer};
use tower_http::{
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::warn;

use crate::{
    AppState,
    error::AppError,
    profile::{ProfileState, validate_anonymous_id},
    protocol::{
        ClientMessage, CreateRoomRequest, JoinRoomRequest, QueueCounts, QuickMatchRequest,
        SessionResponse, Snapshot,
    },
    state::validate_room_code,
};

pub fn app(state: AppState) -> Router {
    let config = state.config().clone();
    let (socket_layer, io) = SocketIo::builder()
        .with_state(state.clone())
        .with_parser(ParserConfig::msgpack())
        .ping_interval(config.heartbeat_interval)
        .ping_timeout(config.client_timeout)
        .max_buffer_size(config.ws_queue_capacity)
        .max_payload(8 * 1024)
        .build_layer();
    io.ns("/room", room_socket_connected);
    io.ns("/queue", queue_socket_connected);
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
        .route("/v1/rooms/{code}", delete(leave_friend_room))
        .route("/v1/matches/quick", post(quick_match))
        .route(
            "/v1/matches/quick/request/{client_request_id}",
            delete(cancel_quick_match_by_request_id),
        )
        .route("/v1/matches/quick/{code}", delete(cancel_quick_match))
        .route("/v1/matches/queue", get(queue_counts))
        .route("/v1/daily-challenges/current", get(current_daily_challenge))
        .route(
            "/v1/profiles/{anonymous_id}",
            get(load_profile).put(save_profile),
        )
        .fallback(frontend_or_not_found)
        .with_state(state)
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
                // Deliberately omit the query string because it can carry
                // Socket.IO transport negotiation data and must not reach logs.
                tracing::info_span!(
                    "http_request",
                    method = %request.method(),
                    path = %request.uri().path()
                )
            }),
        )
        .layer(RequestBodyLimitLayer::new(128 * 1024))
        .layer(ConcurrencyLimitLayer::new(config.http_concurrency_limit))
        .layer(socket_layer)
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
            request.difficulty,
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

async fn leave_friend_room(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<SessionTokenQuery>,
) -> Result<StatusCode, AppError> {
    state.admit_session_request().await?;
    state.leave_friend_room(&code, query.session_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn quick_match(
    State(state): State<AppState>,
    Json(request): Json<QuickMatchRequest>,
) -> Result<Json<SessionResponse>, AppError> {
    state.admit_session_request().await?;
    let response = state
        .quick_match(
            request.identity_id,
            request.client_request_id,
            request.visibility,
            request.best_of,
            request.party_size,
            request.difficulty,
        )
        .await?;
    Ok(Json(response))
}

async fn queue_counts(State(state): State<AppState>) -> Json<QueueCounts> {
    Json(state.queue_counts())
}

async fn current_daily_challenge(
    State(state): State<AppState>,
) -> Result<Json<crate::daily::DailyChallenge>, AppError> {
    Ok(Json(state.current_daily_challenge().await?))
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

#[derive(Deserialize)]
struct SessionTokenQuery {
    session_token: String,
}

async fn cancel_quick_match(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<SessionTokenQuery>,
) -> Result<StatusCode, AppError> {
    state.admit_session_request().await?;
    state.cancel_quick_match(&code, query.session_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn cancel_quick_match_by_request_id(
    State(state): State<AppState>,
    Path(client_request_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.admit_session_request().await?;
    state
        .cancel_quick_match_by_request_id(&client_request_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RoomSocketAuth {
    room_code: String,
    session_token: String,
}

#[derive(Serialize)]
struct CommandAck {
    accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

#[derive(Serialize)]
struct SyncAck {
    accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<Snapshot>,
}

async fn room_socket_connected(
    socket: SocketRef,
    Data(auth): Data<RoomSocketAuth>,
    SocketState(state): SocketState<AppState>,
) {
    let origin_allowed = socket.req_parts().headers.get(ORIGIN).is_none_or(|origin| {
        state
            .config()
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
    });
    if !origin_allowed
        || validate_room_code(&auth.room_code).is_err()
        || auth.session_token.len() > 128
    {
        let _ = socket.disconnect();
        return;
    }
    let Ok(room) = state.room(&auth.room_code).await else {
        let _ = socket.disconnect();
        return;
    };
    let Ok(permit) = state.acquire_websocket() else {
        let _ = socket.disconnect();
        return;
    };
    let (outbound_tx, mut outbound_rx) = mpsc::channel(state.config().ws_queue_capacity);
    let Ok((player_id, connection_id)) = room.connect(auth.session_token, outbound_tx).await else {
        let _ = socket.disconnect();
        return;
    };
    let lease = Arc::new(permit);
    let outbound_socket = socket.clone();
    tokio::spawn(async move {
        let _lease = lease;
        while let Some(event) = outbound_rx.recv().await {
            if outbound_socket.emit("message", event.as_ref()).is_err() {
                let _ = outbound_socket.disconnect();
                break;
            }
        }
    });
    let rate_limit = Arc::new(Mutex::new(TokenBucket::new(20.0, 10.0)));
    let message_room = room.clone();
    socket.on(
        "command",
        move |Data::<ClientMessage>(message), ack: AckSender| {
            let room = message_room.clone();
            let rate_limit = Arc::clone(&rate_limit);
            async move {
                let allowed = rate_limit
                    .lock()
                    .map(|mut bucket| bucket.take())
                    .unwrap_or(false);
                let accepted = if allowed {
                    room.client_message(player_id, connection_id, message)
                        .await
                        .is_ok()
                } else {
                    warn!(%player_id, "socket.io message rate exceeded");
                    false
                };
                if !accepted {
                    room.protocol_error(player_id, connection_id).await;
                }
                let _ = ack.send(&CommandAck {
                    accepted,
                    error: (!accepted).then_some(if allowed {
                        "invalid_command"
                    } else {
                        "rate_limited"
                    }),
                });
            }
        },
    );
    let sync_room = room.clone();
    socket.on("sync", move |ack: AckSender| {
        let room = sync_room.clone();
        async move {
            let response = match room.snapshot(player_id).await {
                Ok(snapshot) => SyncAck {
                    accepted: true,
                    error: None,
                    snapshot: Some(snapshot),
                },
                Err(_) => SyncAck {
                    accepted: false,
                    error: Some("snapshot_unavailable"),
                    snapshot: None,
                },
            };
            let _ = ack.send(&response);
        }
    });
    socket.on_disconnect(move |_: SocketRef| {
        let room = room.clone();
        async move {
            room.disconnect(player_id, connection_id).await;
        }
    });
}

async fn queue_socket_connected(socket: SocketRef, SocketState(state): SocketState<AppState>) {
    let origin_allowed = socket.req_parts().headers.get(ORIGIN).is_none_or(|origin| {
        state
            .config()
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
    });
    let Ok(permit) = state.acquire_websocket() else {
        let _ = socket.disconnect();
        return;
    };
    if !origin_allowed {
        let _ = socket.disconnect();
        return;
    }
    let mut receiver = state.subscribe_queue_counts();
    let interval = state.config().queue_broadcast_interval;
    let cancelled = CancellationToken::new();
    let on_disconnect = cancelled.clone();
    socket.on_disconnect(move |_: SocketRef| {
        let cancelled = on_disconnect.clone();
        async move { cancelled.cancel() }
    });
    tokio::spawn(async move {
        let _permit = permit;
        let mut last_sent = receiver.borrow_and_update().clone();
        if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&last_sent)
            && let Some(counts) = payload.get("counts")
        {
            let _ = socket.emit("queue_counts", counts);
        }
        loop {
            tokio::select! {
                _ = cancelled.cancelled() => break,
                changed = receiver.changed() => if changed.is_err() { break; },
            }
            let payload = receiver.borrow_and_update().clone();
            if payload == last_sent {
                continue;
            }
            last_sent = payload;
            tokio::select! {
                _ = cancelled.cancelled() => break,
                _ = tokio::time::sleep(interval) => {},
            }
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&last_sent)
                && let Some(counts) = payload.get("counts")
                && socket.emit("queue_counts", counts).is_err()
            {
                break;
            }
        }
    });
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

async fn frontend_or_not_found(State(state): State<AppState>, request: Request<Body>) -> Response {
    let path = request.uri().path().to_owned();
    if path == "/v1"
        || path.starts_with("/v1/")
        || path.starts_with("/health/")
        || path.starts_with("/socket.io")
    {
        return not_found().await.into_response();
    }

    let static_dir = &state.config().static_dir;
    let is_static_file = path != "/"
        && std::path::Path::new(path.trim_start_matches('/'))
            .extension()
            .is_some();

    if is_static_file {
        return match ServeDir::new(static_dir).oneshot(request).await {
            Ok(response) => {
                let mut response = response.map(Body::new);
                let cache_policy = if path.starts_with("/assets/") {
                    HeaderValue::from_static("public, max-age=31536000, immutable")
                } else {
                    HeaderValue::from_static("public, max-age=3600")
                };
                response.headers_mut().insert(CACHE_CONTROL, cache_policy);
                response
            }
            Err(error) => match error {},
        };
    }

    match ServeFile::new(static_dir.join("index.html"))
        .oneshot(request)
        .await
    {
        Ok(response) => {
            let mut response = response.map(Body::new);
            response
                .headers_mut()
                .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            response
        }
        Err(error) => match error {},
    }
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
    use std::fs;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[tokio::test]
    async fn frontend_files_are_served_with_spa_fallback() {
        let static_dir = std::env::temp_dir().join(format!("cs-guess-static-{}", Uuid::new_v4()));
        fs::create_dir_all(static_dir.join("assets")).unwrap();
        fs::write(
            static_dir.join("index.html"),
            "<!doctype html><title>CS Guess</title>",
        )
        .unwrap();
        fs::write(static_dir.join("assets/app.js"), "window.CS_GUESS = true;").unwrap();

        let mut config = crate::Config::for_test();
        config.static_dir = static_dir.clone();
        let service = app(AppState::new(config));

        for uri in ["/", "/room"] {
            let response = service
                .clone()
                .oneshot(Request::get(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert!(
                response.headers()[header::CONTENT_TYPE]
                    .to_str()
                    .unwrap()
                    .starts_with("text/html")
            );
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
            let body = response.into_body().collect().await.unwrap().to_bytes();
            assert!(body.windows(8).any(|value| value == b"CS Guess"));
        }

        let asset = service
            .clone()
            .oneshot(Request::get("/assets/app.js").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(asset.status(), StatusCode::OK);
        assert!(
            asset.headers()[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("text/javascript")
        );
        assert_eq!(
            asset.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );

        let api_miss = service
            .oneshot(
                Request::get("/v1/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(api_miss.status(), StatusCode::NOT_FOUND);
        assert_eq!(api_miss.headers()[header::CONTENT_TYPE], "application/json");

        fs::remove_dir_all(static_dir).unwrap();
    }

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
        assert_eq!(create_body["snapshot"]["max_guesses"], 8);
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
    async fn friend_room_leave_is_authorized_and_cleans_up_members_and_room() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state.clone());

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
        let host: Value =
            serde_json::from_slice(&create.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let room_code = host["room_code"].as_str().unwrap();
        let host_token = host["session_token"].as_str().unwrap();

        let join = service
            .clone()
            .oneshot(json_request(
                &format!("/v1/rooms/{room_code}/join"),
                json!({"identity_id": "1nvisiblee"}),
            ))
            .await
            .unwrap();
        let guest: Value =
            serde_json::from_slice(&join.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let guest_token = guest["session_token"].as_str().unwrap();
        let room = state.room(room_code).await.unwrap();
        let (guest_tx, _guest_rx) = mpsc::channel(8);
        room.connect(guest_token.to_owned(), guest_tx)
            .await
            .unwrap();

        let wrong_token = service
            .clone()
            .oneshot(
                Request::delete(format!("/v1/rooms/{room_code}?session_token=wrong-token"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong_token.status(), StatusCode::UNAUTHORIZED);

        let missing = service
            .clone()
            .oneshot(
                Request::delete("/v1/rooms/CS-999999?session_token=missing")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let host_leave = service
            .clone()
            .oneshot(
                Request::delete(format!("/v1/rooms/{room_code}?session_token={host_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(host_leave.status(), StatusCode::NO_CONTENT);

        // The room remains usable after its host leaves; ownership transfers
        // to the earliest remaining participant.
        let third = service
            .clone()
            .oneshot(json_request(
                &format!("/v1/rooms/{room_code}/join"),
                json!({"identity_id": "1962"}),
            ))
            .await
            .unwrap();
        assert_eq!(third.status(), StatusCode::OK);
        let third: Value =
            serde_json::from_slice(&third.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let third_token = third["session_token"].as_str().unwrap();
        let (third_tx, _third_rx) = mpsc::channel(8);
        room.connect(third_token.to_owned(), third_tx)
            .await
            .unwrap();
        assert_eq!(third["snapshot"]["host_player_id"], guest["player_id"],);

        for token in [guest_token, third_token] {
            let leave = service
                .clone()
                .oneshot(
                    Request::delete(format!("/v1/rooms/{room_code}?session_token={token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(leave.status(), StatusCode::NO_CONTENT);
        }

        let join_closed = service
            .oneshot(json_request(
                &format!("/v1/rooms/{room_code}/join"),
                json!({"identity_id": "1mpala"}),
            ))
            .await
            .unwrap();
        assert_eq!(join_closed.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn friend_room_leave_endpoint_never_deletes_a_quick_room() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let quick = service
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
        let quick: Value =
            serde_json::from_slice(&quick.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let room_code = quick["room_code"].as_str().unwrap();
        let token = quick["session_token"].as_str().unwrap();

        let wrong_endpoint = service
            .clone()
            .oneshot(
                Request::delete(format!("/v1/rooms/{room_code}?session_token={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong_endpoint.status(), StatusCode::BAD_REQUEST);

        let quick_cancel = service
            .oneshot(
                Request::delete(format!(
                    "/v1/matches/quick/{room_code}?session_token={token}"
                ))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(quick_cancel.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn friend_room_uses_the_requested_difficulty_and_player_limit() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let response = app(state)
            .oneshot(json_request(
                "/v1/rooms",
                json!({
                    "identity_id": "0samas",
                    "visibility": "open",
                    "max_players": 4,
                    "best_of": 5,
                    "difficulty": "full"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["snapshot"]["difficulty"], "full");
        assert_eq!(body["snapshot"]["max_players"], 4);
        assert_eq!(body["snapshot"]["best_of"], 5);
        assert_eq!(body["snapshot"]["visibility"], "open");
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
    async fn quick_match_client_request_id_is_idempotent_under_concurrency() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state.clone());
        let body = json!({
            "identity_id": "0samas",
            "visibility": "hidden",
            "best_of": 3,
            "client_request_id": "quick-attempt-123"
        });

        let (first, second) = tokio::join!(
            service
                .clone()
                .oneshot(json_request("/v1/matches/quick", body.clone())),
            service.oneshot(json_request("/v1/matches/quick", body))
        );
        let first: Value = serde_json::from_slice(
            &first
                .unwrap()
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let second: Value = serde_json::from_slice(
            &second
                .unwrap()
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();

        assert_eq!(first["room_code"], second["room_code"]);
        assert_eq!(first["player_id"], second["player_id"]);
        assert_eq!(first["session_token"], second["session_token"]);
        assert_eq!(state.queue_counts().total, 1);
    }

    #[tokio::test]
    async fn quick_match_rejects_request_id_reuse_with_a_different_fingerprint() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "best_of": 1,
                    "client_request_id": "fingerprint-1"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        let conflict = service
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "best_of": 5,
                    "client_request_id": "fingerprint-1"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let conflict: Value =
            serde_json::from_slice(&conflict.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(conflict["code"], "idempotency_conflict");
        assert!(conflict.get("session_token").is_none());
    }

    #[tokio::test]
    async fn quick_match_can_be_cancelled_by_client_request_id() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state.clone());
        let created = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "client_request_id": "cancel-request-1"
                }),
            ))
            .await
            .unwrap();
        let created: Value =
            serde_json::from_slice(&created.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        let cancelled = service
            .oneshot(
                Request::delete("/v1/matches/quick/request/cancel-request-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(cancelled.status(), StatusCode::NO_CONTENT);
        assert_eq!(state.queue_counts().total, 0);
        assert!(
            state
                .room(created["room_code"].as_str().unwrap())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn quick_request_cache_expires_is_bounded_and_failed_locks_are_removed() {
        let mut config = crate::Config::for_test();
        config.quick_request_ttl = std::time::Duration::from_millis(1);
        config.max_quick_request_results = 1;
        let state = AppState::new(config);
        state.set_ready(true);
        let service = app(state.clone());
        let first = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "best_of": 1,
                    "client_request_id": "bounded-1"
                }),
            ))
            .await
            .unwrap();
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let retried = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "best_of": 1,
                    "client_request_id": "bounded-1"
                }),
            ))
            .await
            .unwrap();
        let retried: Value =
            serde_json::from_slice(&retried.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_ne!(first["player_id"], retried["player_id"]);

        let _ = service
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "best_of": 5,
                    "client_request_id": "bounded-2"
                }),
            ))
            .await
            .unwrap();
        assert!(state.quick_request_result_count() <= 1);
        assert_eq!(state.quick_request_lock_count(), 0);

        let mut failing_config = crate::Config::for_test();
        failing_config.max_rooms = 0;
        let failing_state = AppState::new(failing_config);
        failing_state.set_ready(true);
        let failed = app(failing_state.clone())
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "client_request_id": "failed-request"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(failed.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(failing_state.quick_request_lock_count(), 0);
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
    async fn leaving_a_playing_quick_duel_forfeits_and_stops_active_telemetry() {
        let state = AppState::new(crate::Config::for_test());
        let first = state
            .quick_match(
                "0samas".to_owned(),
                Some("leave-playing-1".to_owned()),
                crate::protocol::Visibility::Hidden,
                3,
                2,
                crate::protocol::Difficulty::Easy,
            )
            .await
            .unwrap();
        let second = state
            .quick_match(
                "1nvisiblee".to_owned(),
                Some("leave-playing-2".to_owned()),
                crate::protocol::Visibility::Hidden,
                3,
                2,
                crate::protocol::Difficulty::Easy,
            )
            .await
            .unwrap();
        let room = state.room(&first.room_code).await.unwrap();
        let (first_tx, _first_rx) = tokio::sync::mpsc::channel(8);
        let (second_tx, _second_rx) = tokio::sync::mpsc::channel(8);
        room.connect(first.session_token.clone(), first_tx)
            .await
            .unwrap();
        room.connect(second.session_token.clone(), second_tx)
            .await
            .unwrap();
        room.start_if_ready().await.unwrap();
        assert_eq!(state.queue_counts().easy.playing_bo3_hidden, 2);

        state
            .cancel_quick_match(&first.room_code, first.session_token)
            .await
            .unwrap();
        let snapshot = room.snapshot(second.player_id).await.unwrap();

        assert_eq!(snapshot.phase, crate::protocol::Phase::Finished);
        assert_eq!(snapshot.series_winner_player_id, Some(second.player_id));
        assert_eq!(
            snapshot.finish_reason,
            Some(crate::protocol::FinishReason::DisconnectForfeit)
        );
        assert_eq!(state.queue_counts().playing_total, 0);
        assert_eq!(state.queue_counts().easy.playing_bo3_hidden, 0);
    }

    #[tokio::test]
    async fn quick_match_only_pairs_players_on_the_same_difficulty() {
        let state = AppState::new(crate::Config::for_test());
        state.set_ready(true);
        let service = app(state);
        let easy = service
            .clone()
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "0samas",
                    "visibility": "hidden",
                    "best_of": 3,
                    "difficulty": "easy"
                }),
            ))
            .await
            .unwrap();
        let easy: Value =
            serde_json::from_slice(&easy.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let hard = service
            .oneshot(json_request(
                "/v1/matches/quick",
                json!({
                    "identity_id": "1nvisiblee",
                    "visibility": "hidden",
                    "best_of": 3,
                    "difficulty": "hard"
                }),
            ))
            .await
            .unwrap();
        let hard: Value =
            serde_json::from_slice(&hard.into_body().collect().await.unwrap().to_bytes()).unwrap();

        assert_ne!(easy["room_code"], hard["room_code"]);
        assert_eq!(easy["snapshot"]["difficulty"], "easy");
        assert_eq!(hard["snapshot"]["difficulty"], "hard");
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
        assert_eq!(initial["total"], 0);
        assert_eq!(initial["easy"]["total"], 0);
        assert_eq!(initial["full"]["total"], 0);
        assert_eq!(initial["hard"]["total"], 0);

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
        assert_eq!(waiting["total"], 1);
        assert_eq!(waiting["bo5_hidden"], 1);
        assert_eq!(waiting["easy"]["bo5_hidden"], 1);
        assert_eq!(waiting["full"]["bo5_hidden"], 0);
        assert_eq!(waiting["hard"]["bo5_hidden"], 0);

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
        assert_eq!(empty["total"], 0);
        assert_eq!(empty["easy"]["total"], 0);
        assert!(first["session_token"].is_string());
    }

    fn json_request(uri: &str, body: Value) -> Request<Body> {
        Request::post(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }
}
