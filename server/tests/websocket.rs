use std::time::Duration;

use futures_util::{SinkExt, Stream, StreamExt};
use serde_json::{Value, json};
use tokio::{net::TcpListener, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use cs_guess_server::{AppState, Config, app};

#[tokio::test]
async fn queue_counts_are_broadcast_when_players_join_and_cancel() {
    let mut config = Config::for_test();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    config.public_base_url = format!("http://{address}");
    let state = AppState::new(config);
    state.set_ready(true);

    let server = tokio::spawn(async move {
        axum::serve(listener, app(state)).await.unwrap();
    });

    let (mut queue_ws, _) = connect_async(format!("ws://{address}/v1/matches/queue/ws"))
        .await
        .unwrap();
    let initial = read_until(&mut queue_ws, "queue_counts").await;
    assert_eq!(initial["counts"]["total"], 0);

    let client = reqwest::Client::new();
    let waiting: Value = client
        .post(format!("http://{address}/v1/matches/quick"))
        .json(&json!({
            "identity_id": "0samas",
            "visibility": "hidden",
            "best_of": 3
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let joined = read_until(&mut queue_ws, "queue_counts").await;
    assert_eq!(joined["counts"]["bo3"], 1);
    assert_eq!(joined["counts"]["total"], 1);

    let response = client
        .delete(format!(
            "http://{address}/v1/matches/quick/{}?session_token={}",
            waiting["room_code"].as_str().unwrap(),
            waiting["session_token"].as_str().unwrap()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);
    let cancelled = read_until(&mut queue_ws, "queue_counts").await;
    assert_eq!(cancelled["counts"]["bo3"], 0);
    assert_eq!(cancelled["counts"]["total"], 0);

    server.abort();
}

#[tokio::test]
async fn four_player_queue_broadcasts_waiting_players_and_clears_when_full() {
    let mut config = Config::for_test();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    config.public_base_url = format!("http://{address}");
    let state = AppState::new(config);
    state.set_ready(true);

    let server = tokio::spawn(async move {
        axum::serve(listener, app(state)).await.unwrap();
    });
    let (mut queue_ws, _) = connect_async(format!("ws://{address}/v1/matches/queue/ws"))
        .await
        .unwrap();
    let _ = read_until(&mut queue_ws, "queue_counts").await;
    let client = reqwest::Client::new();

    for index in 1..=3 {
        client
            .post(format!("http://{address}/v1/matches/quick"))
            .json(&json!({
                "identity_id": if index % 2 == 0 { "0samas" } else { "1nvisiblee" },
                "visibility": "hidden",
                "best_of": 5,
                "party_size": 4
            }))
            .send()
            .await
            .unwrap();
        let counts = read_until(&mut queue_ws, "queue_counts").await;
        assert_eq!(counts["counts"]["group_bo5"], index);
        assert_eq!(counts["counts"]["group_total"], index);
    }

    client
        .post(format!("http://{address}/v1/matches/quick"))
        .json(&json!({
            "identity_id": "2high",
            "visibility": "hidden",
            "best_of": 5,
            "party_size": 4
        }))
        .send()
        .await
        .unwrap();
    let full = read_until(&mut queue_ws, "queue_counts").await;
    assert_eq!(full["counts"]["group_bo5"], 0);
    assert_eq!(full["counts"]["group_total"], 0);

    server.abort();
}

#[tokio::test]
async fn quick_match_redacts_hidden_progress_and_restores_history_on_reconnect() {
    let mut config = Config::for_test();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    config.public_base_url = format!("http://{address}");
    let state = AppState::new(config);
    state.set_ready(true);

    let server = tokio::spawn(async move {
        axum::serve(listener, app(state)).await.unwrap();
    });

    let client = reqwest::Client::new();
    let first: Value = client
        .post(format!("http://{address}/v1/matches/quick"))
        .json(&json!({"identity_id": "0samas", "visibility": "hidden"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let second: Value = client
        .post(format!("http://{address}/v1/matches/quick"))
        .json(&json!({"identity_id": "1nvisiblee", "visibility": "hidden"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let room_code = first["room_code"].as_str().unwrap();
    assert_eq!(second["room_code"], room_code);
    let first_url = websocket_url(address, room_code, first["session_token"].as_str().unwrap());
    let second_url = websocket_url(
        address,
        room_code,
        second["session_token"].as_str().unwrap(),
    );
    let (mut first_ws, _) = connect_async(&first_url).await.unwrap();
    let (mut second_ws, _) = connect_async(&second_url).await.unwrap();

    let _ = read_until(&mut first_ws, "round_started").await;
    let _ = read_until(&mut second_ws, "round_started").await;
    second_ws
        .send(Message::Text(
            json!({
                "type": "guess",
                "request_id": uuid::Uuid::new_v4(),
                "player_id": "donk"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let accepted = read_until(&mut second_ws, "guess_accepted").await;
    assert_eq!(accepted["player_id"], "donk");
    let progress = read_until(&mut first_ws, "opponent_progress").await;
    assert!(progress["guessed_player_id"].is_null());

    second_ws.close(None).await.unwrap();
    let (mut resumed_ws, _) = connect_async(&second_url).await.unwrap();
    let resumed = read_until(&mut resumed_ws, "snapshot").await;
    assert_eq!(resumed["snapshot"]["own_guesses"][0]["player_id"], "donk");
    assert!(resumed["snapshot"]["mystery_id"].is_null());

    server.abort();
}

fn websocket_url(address: std::net::SocketAddr, room_code: &str, token: &str) -> String {
    format!("ws://{address}/v1/rooms/{room_code}/ws?session_token={token}")
}

async fn read_until<S>(socket: &mut S, event_type: &str) -> Value
where
    S: Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    timeout(Duration::from_secs(3), async {
        while let Some(message) = socket.next().await {
            let message = message.unwrap();
            if let Message::Text(text) = message {
                let event: Value = serde_json::from_str(&text).unwrap();
                if event["type"] == event_type {
                    return event;
                }
            }
        }
        panic!("socket closed before {event_type}");
    })
    .await
    .expect("event arrives before timeout")
}
