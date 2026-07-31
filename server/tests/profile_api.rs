use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use cs_guess_server::{
    AppState, Config, app,
    daily::catalog_players,
    profile::{ProfileCompletionResponse, ProfileHistoryPage, ProfileSummary},
};
use http_body_util::BodyExt;
use serde::de::DeserializeOwned;
use serde_json::json;
use tower::ServiceExt;

const ANONYMOUS_ID: &str = "anonymous-api-profile-0001";
const SYNC_TOKEN: &str = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";

fn initial_player_id() -> &'static str {
    &catalog_players()
        .iter()
        .find(|player| (1..=4).contains(&player.major_appearances) && player.major_wins == 0)
        .expect("catalog has a common identity")
        .id
}

async fn response_json<T: DeserializeOwned>(response: axum::response::Response) -> T {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("profile response body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("valid JSON response")
}

#[tokio::test]
async fn profile_api_uses_authenticated_domain_operations() {
    let state = AppState::new(Config::for_test());
    state.initialize().await.unwrap();
    let service = app(state);

    let created = service
        .clone()
        .oneshot(
            Request::post("/v1/profiles")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "initialPlayerId": initial_player_id(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created: ProfileSummary = response_json(created).await;
    assert!(!created.identity_confirmed);
    assert_eq!(created.draw_credits, 1);

    let existing = service
        .clone()
        .oneshot(
            Request::post("/v1/profiles")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "initialPlayerId": initial_player_id(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(existing.status(), StatusCode::OK);

    let request_id = "52de8707-292b-4a83-82d5-c1776ed54a01";
    let drawn = service
        .clone()
        .oneshot(
            Request::post(format!("/v1/profiles/{ANONYMOUS_ID}/identity-draws"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "requestId": request_id,
                        "poolId": "common",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(drawn.status(), StatusCode::OK);
    let drawn: ProfileSummary = response_json(drawn).await;
    let pending = drawn.pending_draw.expect("server generated pending draw");
    assert_eq!(drawn.draw_credits, 0);
    assert!(
        serde_json::to_value(&pending)
            .unwrap()
            .get("requestId")
            .is_none()
    );
    assert_eq!(pending.item_ids.len(), 29);
    assert_eq!(pending.item_ids[pending.winner_index], pending.winner_id);
    assert_ne!(pending.winner_id, initial_player_id());

    let replayed = service
        .clone()
        .oneshot(
            Request::post(format!("/v1/profiles/{ANONYMOUS_ID}/identity-draws"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "requestId": request_id,
                        "poolId": "common",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replayed.status(), StatusCode::OK);
    let replayed: ProfileSummary = response_json(replayed).await;
    assert_eq!(replayed.draw_credits, 0);

    let winner_id = pending.winner_id;
    let adopted = service
        .clone()
        .oneshot(
            Request::post(format!(
                "/v1/profiles/{ANONYMOUS_ID}/identity-draws/{winner_id}/adopt"
            ))
            .header("x-profile-token", SYNC_TOKEN)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(adopted.status(), StatusCode::OK);
    let adopted: ProfileSummary = response_json(adopted).await;
    assert!(adopted.identity_confirmed);
    assert_eq!(adopted.player_id, winner_id);
    assert!(adopted.pending_draw.is_none());

    let challenge = service
        .clone()
        .oneshot(
            Request::post("/v1/daily-challenges/current/attempts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({ "anonymousId": ANONYMOUS_ID }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(challenge.status(), StatusCode::CREATED);
    let challenge: serde_json::Value =
        serde_json::from_slice(&challenge.into_body().collect().await.unwrap().to_bytes()).unwrap();

    let resumed = service
        .clone()
        .oneshot(
            Request::post("/v1/daily-challenges/current/attempts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({ "anonymousId": ANONYMOUS_ID }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resumed.status(), StatusCode::OK);
    let resumed: serde_json::Value =
        serde_json::from_slice(&resumed.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(resumed["deadlineUnixMs"], challenge["deadlineUnixMs"]);
    assert_eq!(
        resumed["mysteryPlayer"]["id"],
        challenge["mysteryPlayer"]["id"]
    );

    let challenge_date = challenge["date"].as_str().unwrap().to_owned();
    let mystery_player_id = challenge["mysteryPlayer"]["id"].as_str().unwrap();
    let completion_payload = json!({
        "anonymousId": ANONYMOUS_ID,
        "guessIds": [mystery_player_id],
        "timedOut": false,
    });
    let recorded = service
        .clone()
        .oneshot(
            Request::post("/v1/daily-challenges/current/completions")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(completion_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(recorded.status(), StatusCode::OK);
    let recorded: ProfileCompletionResponse = response_json(recorded).await;
    assert_eq!(recorded.profile.stats.wins, 1);
    assert_eq!(recorded.profile.draw_credits, 1);
    assert_eq!(
        recorded.history_entry.as_ref().unwrap().id,
        format!("daily:{challenge_date}")
    );

    let replayed_round = service
        .clone()
        .oneshot(
            Request::post("/v1/daily-challenges/current/completions")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(completion_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let replayed_round: ProfileCompletionResponse = response_json(replayed_round).await;
    assert_eq!(replayed_round.profile.stats.wins, 1);
    assert_eq!(replayed_round.history_entry, recorded.history_entry);

    let history = service
        .clone()
        .oneshot(
            Request::get(format!("/v1/profiles/{ANONYMOUS_ID}/history?limit=1"))
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(history.status(), StatusCode::OK);
    assert_eq!(
        history.headers()[header::CACHE_CONTROL],
        "private, no-store"
    );
    let history: ProfileHistoryPage = response_json(history).await;
    assert_eq!(history.items, vec![recorded.history_entry.clone().unwrap()]);
    assert!(history.next_cursor.is_none());

    let summary = service
        .clone()
        .oneshot(
            Request::get(format!("/v1/profiles/{ANONYMOUS_ID}"))
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let summary: serde_json::Value = response_json(summary).await;
    assert!(summary.get("matchHistory").is_none());
    assert!(summary.get("recordedRounds").is_none());

    let generic_round_write = service
        .clone()
        .oneshot(
            Request::post(format!("/v1/profiles/{ANONYMOUS_ID}/rounds"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({ "roundId": "forged", "result": "win" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(generic_round_write.status(), StatusCode::NOT_FOUND);

    let second_draw = service
        .clone()
        .oneshot(
            Request::post(format!("/v1/profiles/{ANONYMOUS_ID}/identity-draws"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "requestId": "aec42781-3c4f-423e-858e-f39b5a2de16f",
                        "poolId": "common",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let second_draw: ProfileSummary = response_json(second_draw).await;
    let second_winner_id = second_draw
        .pending_draw
        .expect("second pending draw")
        .winner_id;
    let discarded = service
        .clone()
        .oneshot(
            Request::delete(format!(
                "/v1/profiles/{ANONYMOUS_ID}/identity-draws/{second_winner_id}"
            ))
            .header("x-profile-token", SYNC_TOKEN)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(discarded.status(), StatusCode::OK);
    let discarded: ProfileSummary = response_json(discarded).await;
    assert!(discarded.pending_draw.is_none());
    assert_eq!(discarded.player_id, winner_id);

    let whole_profile_put = service
        .clone()
        .oneshot(
            Request::put(format!("/v1/profiles/{ANONYMOUS_ID}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(serde_json::to_string(&replayed_round).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(whole_profile_put.status(), StatusCode::METHOD_NOT_ALLOWED);

    let unauthorized = service
        .oneshot(
            Request::get(format!("/v1/profiles/{ANONYMOUS_ID}"))
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
