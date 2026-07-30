use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use cs_guess_server::{AppState, Config, app, daily::catalog_players, profile::ProfileState};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

const ANONYMOUS_ID: &str = "anonymous-solo-profile-0001";
const SYNC_TOKEN: &str = "solo_profile_sync_token_abcdefghijklmnopqrstuvwxyz";

async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("response body")
            .to_bytes(),
    )
    .expect("JSON response")
}

#[tokio::test]
async fn solo_round_is_issued_and_settled_by_the_server() {
    let state = AppState::new(Config::for_test());
    state.initialize().await.unwrap();
    let service = app(state);
    let initial_player_id = &catalog_players()
        .iter()
        .find(|player| (1..=4).contains(&player.major_appearances) && player.major_wins == 0)
        .unwrap()
        .id;

    let created_profile = service
        .clone()
        .oneshot(
            Request::post("/v1/profiles")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "initialPlayerId": initial_player_id,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created_profile.status(), StatusCode::CREATED);

    let round_response = service
        .clone()
        .oneshot(
            Request::post("/v1/solo-rounds")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "difficulty": "easy",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(round_response.status(), StatusCode::CREATED);
    let round = json_body(round_response).await;
    let round_id = round["roundId"].as_str().unwrap();
    let mystery_player_id = round["mysteryPlayer"]["id"].as_str().unwrap();
    assert_eq!(round["maxGuesses"], 8);

    let loaded_round = service
        .clone()
        .oneshot(
            Request::get(format!(
                "/v1/solo-rounds/{round_id}?anonymousId={ANONYMOUS_ID}"
            ))
            .header("x-profile-token", SYNC_TOKEN)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(loaded_round.status(), StatusCode::OK);
    assert_eq!(
        json_body(loaded_round).await["mysteryPlayer"]["id"],
        mystery_player_id
    );

    let completion = service
        .clone()
        .oneshot(
            Request::post(format!("/v1/solo-rounds/{round_id}/completions"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "guessIds": [mystery_player_id],
                        "timedOut": false,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(completion.status(), StatusCode::OK);
    let profile: ProfileState =
        serde_json::from_value(json_body(completion).await).expect("profile state");
    assert_eq!(profile.stats.wins, 1);
    assert_eq!(profile.match_history[0].mode, "solo");
    assert_eq!(profile.match_history[0].id, round_id);

    let forged_completion = service
        .oneshot(
            Request::post("/v1/solo-rounds/solo:easy:forged/completions")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-profile-token", SYNC_TOKEN)
                .body(Body::from(
                    json!({
                        "anonymousId": ANONYMOUS_ID,
                        "guessIds": [mystery_player_id],
                        "timedOut": false,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forged_completion.status(), StatusCode::NOT_FOUND);
}
