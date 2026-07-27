use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use cs_guess_server::{AppState, Config, app};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn public_api_rejects_invalid_input_and_reports_readiness() {
    let state = AppState::new(Config::for_test());
    let service = app(state.clone());

    let before_ready = service
        .clone()
        .oneshot(Request::get("/health/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(before_ready.status(), StatusCode::SERVICE_UNAVAILABLE);

    state.set_ready(true);
    let invalid = service
        .oneshot(
            Request::post("/v1/rooms")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "identity_id": "",
                        "visibility": "hidden",
                        "max_players": 9
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
}
