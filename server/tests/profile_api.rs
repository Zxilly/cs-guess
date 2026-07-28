use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use cs_guess_server::{AppState, Config, app};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn profile_api_persists_and_authenticates_anonymous_state() {
    let state = AppState::new(Config::for_test());
    state.initialize().await.unwrap();
    let service = app(state);
    let anonymous_id = "anonymous-api-profile-0001";
    let sync_token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
    let payload = json!({
        "anonymousId": anonymous_id,
        "playerId": "donk",
        "identityConfirmed": true,
        "stats": {
            "wins": 1,
            "losses": 0,
            "draws": 0,
            "currentStreak": 1,
            "bestStreak": 1
        },
        "drawCredits": 1,
        "lossesTowardCredit": 0,
        "recordedRounds": [],
        "matchHistory": [],
        "pendingDraw": null,
        "updatedAt": 100
    });

    let saved = service
        .clone()
        .oneshot(
            Request::put(format!("/v1/profiles/{anonymous_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", sync_token)
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);

    let loaded = service
        .clone()
        .oneshot(
            Request::get(format!("/v1/profiles/{anonymous_id}"))
                .header("x-profile-token", sync_token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(loaded.status(), StatusCode::OK);

    let unauthorized = service
        .oneshot(
            Request::get(format!("/v1/profiles/{anonymous_id}"))
                .header(
                    "x-profile-token",
                    "different_profile_sync_token_abcdefghijkl",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
}
