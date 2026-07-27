use std::{collections::HashSet, time::Instant};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use cs_guess_server::{AppState, Config, app};
use futures_util::future::join_all;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

const REQUESTS: usize = 256;

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn creates_many_rooms_concurrently_without_code_collisions() {
    let state = AppState::new(Config::for_test());
    state.set_ready(true);
    let service = app(state);
    let started = Instant::now();

    let responses = join_all((0..REQUESTS).map(|index| {
        let service = service.clone();
        async move {
            service
                .oneshot(
                    Request::post("/v1/rooms")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            json!({
                                "identity_id": if index % 2 == 0 { "0samas" } else { "1nvisiblee" },
                                "visibility": "hidden",
                                "max_players": 2,
                                "best_of": 3
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap()
        }
    }))
    .await;

    let elapsed = started.elapsed();
    let mut codes = HashSet::with_capacity(REQUESTS);
    for response in responses {
        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let room_code = payload["room_code"].as_str().unwrap();
        assert!(room_code.starts_with("CS-"));
        assert_eq!(room_code.len(), 9);
        assert!(codes.insert(room_code.to_owned()), "duplicate room code");
    }

    let rate = REQUESTS as f64 / elapsed.as_secs_f64();
    println!(
        "created {REQUESTS} isolated room actors in {:.3}s ({rate:.0} rooms/s)",
        elapsed.as_secs_f64()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn pairs_a_concurrent_quick_match_burst_without_orphaning_tickets() {
    let state = AppState::new(Config::for_test());
    state.set_ready(true);
    let service = app(state);
    let responses = join_all((0..128).map(|index| {
        let service = service.clone();
        async move {
            service
                .oneshot(
                    Request::post("/v1/matches/quick")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            json!({
                                "identity_id": if index % 2 == 0 { "0samas" } else { "1nvisiblee" },
                                "visibility": "hidden",
                                "best_of": 5
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap()
        }
    }))
    .await;

    let mut codes = Vec::with_capacity(128);
    for response in responses {
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        codes.push(payload["room_code"].as_str().unwrap().to_owned());
    }
    codes.sort_unstable();

    let groups: Vec<_> = codes
        .chunk_by(|left, right| left == right)
        .map(|group| group.len())
        .collect();
    assert_eq!(groups.len(), 64);
    assert!(groups.iter().all(|size| *size == 2));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn groups_a_concurrent_four_player_burst_without_splitting_parties() {
    let state = AppState::new(Config::for_test());
    state.set_ready(true);
    let service = app(state);
    let responses = join_all((0..128).map(|index| {
        let service = service.clone();
        async move {
            service
                .oneshot(
                    Request::post("/v1/matches/quick")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            json!({
                                "identity_id": if index % 2 == 0 { "0samas" } else { "1nvisiblee" },
                                "visibility": "open",
                                "best_of": 3,
                                "party_size": 4
                            })
                            .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap()
        }
    }))
    .await;

    let mut codes = Vec::with_capacity(128);
    for response in responses {
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        codes.push(payload["room_code"].as_str().unwrap().to_owned());
    }
    codes.sort_unstable();

    let groups: Vec<_> = codes
        .chunk_by(|left, right| left == right)
        .map(|group| group.len())
        .collect();
    assert_eq!(groups.len(), 32);
    assert!(groups.iter().all(|size| *size == 4));
}
