use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cs_guess_server::{AppState, Config, app};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn current_daily_challenge_survives_a_server_restart() {
    let database_path =
        std::env::temp_dir().join(format!("cs-guess-daily-{}.sqlite", Uuid::new_v4()));
    let mut config = Config::for_test();
    config.database_path = database_path.clone();
    config.database_max_connections = 4;

    let first_state = AppState::new(config.clone());
    first_state.initialize().await.unwrap();
    let first_response = app(first_state)
        .oneshot(
            Request::get("/v1/daily-challenges/current")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_response.status(), StatusCode::OK);
    assert_eq!(
        first_response.headers()[axum::http::header::CACHE_CONTROL],
        "public, max-age=60, stale-while-revalidate=300"
    );
    let first: Value = serde_json::from_slice(
        &first_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes(),
    )
    .unwrap();

    let restarted_state = AppState::new(config);
    restarted_state.initialize().await.unwrap();
    let restarted_response = app(restarted_state)
        .oneshot(
            Request::get("/v1/daily-challenges/current")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restarted_response.status(), StatusCode::OK);
    let restarted: Value = serde_json::from_slice(
        &restarted_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes(),
    )
    .unwrap();

    assert_eq!(restarted, first);
    assert!(first["date"].as_str().is_some_and(|date| date.len() == 10));
    assert!(first["roundNumber"].as_u64().is_some_and(|round| round > 0));
    assert!(first.get("mysteryPlayer").is_none());

    let _ = std::fs::remove_file(&database_path);
    let _ = std::fs::remove_file(database_path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(database_path.with_extension("sqlite-shm"));
}
