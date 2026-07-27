use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("room not found")]
    RoomNotFound,
    #[error("room is full")]
    RoomFull,
    #[error("room capacity reached")]
    Capacity,
    #[error("session is invalid or expired")]
    Unauthorized,
    #[error("profile not found")]
    ProfileNotFound,
    #[error("service is unavailable")]
    Unavailable,
    #[error("too many requests")]
    RateLimited,
    #[error("{0}")]
    Config(String),
    #[error("internal service error")]
    Internal,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::RoomNotFound => (StatusCode::NOT_FOUND, "room_not_found"),
            Self::RoomFull => (StatusCode::CONFLICT, "room_full"),
            Self::Capacity => (StatusCode::SERVICE_UNAVAILABLE, "capacity_reached"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::ProfileNotFound => (StatusCode::NOT_FOUND, "profile_not_found"),
            Self::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
            Self::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            Self::Config(_) | Self::Internal => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        };

        (
            status,
            Json(ErrorBody {
                code,
                message: self.to_string(),
            }),
        )
            .into_response()
    }
}
