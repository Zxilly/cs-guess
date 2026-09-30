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

#[tokio::test]
async fn completion_uses_the_owned_attempt_date_and_replays_its_receipt_after_expiry() {
    use cs_guess_server::{
        daily::{CompleteDailyChallengeRequest, catalog_players},
        profile::CreateProfileRequest,
    };
    let path = std::env::temp_dir().join(format!(
        "cs-guess-daily-completion-{}.sqlite",
        Uuid::new_v4()
    ));
    let mut config = Config::for_test();
    config.database_path = path.clone();
    let state = AppState::new(config);
    state.initialize().await.unwrap();
    let anonymous_id = "anonymous-cross-midnight-test";
    let token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
    let player = catalog_players()
        .iter()
        .find(|player| (1..=4).contains(&player.major_appearances) && player.major_wins == 0)
        .unwrap();
    state
        .create_profile(
            CreateProfileRequest {
                anonymous_id: anonymous_id.to_owned(),
                initial_player_id: player.id.clone(),
            },
            token,
        )
        .await
        .unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path))
        .await
        .unwrap();
    // This stored date deliberately differs from the server's current date.
    // The deadline remains active so receipt is a legitimate cross-date win.
    sqlx::query(
        "INSERT INTO daily_challenges VALUES ('2000-01-01', 1, ?, ?, 'original-catalog', 0)",
    )
    .bind(&player.id)
    .bind(serde_json::to_string(player).unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let request = || CompleteDailyChallengeRequest {
        anonymous_id: anonymous_id.to_owned(),
        date: "2000-01-01".to_owned(),
        guess_ids: vec![player.id.clone()],
        timed_out: false,
    };
    // Even a correct trace cannot settle another date without an owned attempt.
    assert!(
        state
            .complete_daily_challenge(token, request())
            .await
            .is_err()
    );
    let deadline = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        + 180_000;
    sqlx::query("INSERT INTO daily_attempts VALUES (?, '2000-01-01', ?, 0)")
        .bind(anonymous_id)
        .bind(deadline)
        .execute(&pool)
        .await
        .unwrap();
    let first = state
        .complete_daily_challenge(token, request())
        .await
        .unwrap();
    assert_eq!(first.profile.stats.wins, 1);
    assert_eq!(first.history_entry.as_ref().unwrap().id, "daily:2000-01-01");
    assert_eq!(
        first.history_entry.as_ref().unwrap().answer_id.as_deref(),
        Some(player.id.as_str())
    );
    sqlx::query("UPDATE daily_attempts SET deadline_unix_ms = 1")
        .execute(&pool)
        .await
        .unwrap();
    let mut retry = request();
    retry.timed_out = true;
    let replay = state.complete_daily_challenge(token, retry).await.unwrap();
    assert_eq!(replay, first);
    assert!(
        state
            .complete_daily_challenge("wrong_profile_token_abcdefghijklmnop", request())
            .await
            .is_err()
    );
    let unexpected: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM daily_challenges WHERE challenge_date != '2000-01-01'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        unexpected, 0,
        "completion must not issue tomorrow's challenge"
    );
    pool.close().await;
    drop(state);
    let _ = std::fs::remove_file(path);
}
