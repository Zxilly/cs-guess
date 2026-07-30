# CS Guess realtime server

Rust realtime backend for the CS Guess friend-room and 1v1 modes. It uses
Axum 0.8 on Tokio, with one bounded actor task per room. Every room command is
serialized through that actor, so simultaneous correct guesses have a
deterministic winner and room state never needs a shared mutex.

## Run

```bash
cd server
cp .env.example .env
cargo run
```

The defaults listen on `127.0.0.1:8080`, allow the Vite development origins,
and persist anonymous profiles to `data/cs-guess.sqlite` inside this server
directory.

```bash
curl http://127.0.0.1:8080/health/live
curl http://127.0.0.1:8080/health/ready
```

`/health/live` only proves the process event loop is responsive.
`/health/ready` becomes unavailable before graceful shutdown starts, so a load
balancer can drain the instance.

## HTTP API

All JSON request bodies are limited to 128 KiB. Display names must contain 1–24
printable characters. Room codes use the collision-resistant `CS-000000` format.

### Profile persistence

Anonymous identity, progression, draw credits, and match history are persisted
to SQLite through authenticated profile operations. Requests require the
per-profile `X-Profile-Token`; only its SHA-256 hash is stored.

```http
POST   /v1/profiles
GET    /v1/profiles/{anonymous_id}
POST   /v1/profiles/{anonymous_id}/identity-draws
POST   /v1/profiles/{anonymous_id}/identity-draws/{winner_id}/adopt
DELETE /v1/profiles/{anonymous_id}/identity-draws/{winner_id}
```

The server creates the initial counters, generates identity draw results,
deducts draw credits, and applies or discards pending identities. Clients
cannot replace an entire profile representation or submit arbitrary match
results. Daily challenge, solo-round, and realtime room state machines derive
the result and write the Profile aggregate directly. Identity draw requests
carry a UUID so retrying the same request never charges twice; authoritative
settlements are deduplicated by their server-owned round ID.

SQLite uses a bounded async connection pool, WAL journaling, `synchronous =
NORMAL`, foreign keys, and a 5-second busy timeout. Profile domain mutations
are serialized inside the single server process before their updated aggregate
is persisted. Override the database location and pool size with
`CS_GUESS_DATABASE_PATH` and `CS_GUESS_DATABASE_MAX_CONNECTIONS`.

### Daily challenge persistence

```http
GET /v1/daily-challenges/current
POST /v1/daily-challenges/current/attempts
POST /v1/daily-challenges/current/completions
```

The server derives the current date in `Asia/Shanghai`, selects a player from
the versioned catalog, and inserts the challenge once using the date as the
SQLite primary key. Later requests and process restarts return the stored player
snapshot, so catalog refreshes cannot change an already published challenge.
The authenticated attempt endpoint persists a per-Profile deadline. The
completion endpoint accepts only the guess trace and derives the win/loss
before writing Profile; timeout losses are rejected until that deadline.

### Solo rounds

```http
POST /v1/solo-rounds
GET  /v1/solo-rounds/{round_id}?anonymousId={anonymous_id}
POST /v1/solo-rounds/{round_id}/completions
```

Solo answers, difficulty, round number, ownership, and deadline are issued and
persisted by the server. Completion accepts the guess trace and derives the
result from that stored round. Unknown or cross-Profile round IDs cannot be
settled.

### Create a friend room

```http
POST /v1/rooms
Content-Type: application/json

{
  "identity_id": "0samas",
  "anonymous_id": "profile-anonymous-id",
  "visibility": "hidden",
  "max_players": 4,
  "best_of": 3
}
```

When `anonymous_id` is present, send its `X-Profile-Token`. The server verifies
that the room identity matches the bound Profile. The room actor then writes
each authoritative round result directly to every bound participant's Profile.
The same optional binding applies to join and quick-match requests.

`visibility` is `hidden` or `open`; `max_players` is 2 or 4; `best_of` is 1, 3,
or 5.

### Join a friend room

```http
POST /v1/rooms/CS-207207/join
Content-Type: application/json

{ "identity_id": "1nvisiblee" }
```

### Enter quick matchmaking

```http
POST /v1/matches/quick
Content-Type: application/json

{
  "identity_id": "0samas",
  "visibility": "hidden",
  "best_of": 5,
  "party_size": 4
}
```

`party_size` accepts `2` (the default) or `4`. Players only share a queue when
`party_size`, `best_of`, and `visibility` all match. A room is removed from the
public queue as soon as every seat is reserved, and its first round starts after
all reserved players connect by WebSocket.

Cancel a waiting quick-match ticket with:

```http
DELETE /v1/matches/quick/CS-207207?session_token={session_token}
```

Read the current public queue totals with:

```http
GET /v1/matches/queue
```

Subscribe to the same BO1/BO3/BO5 totals in real time with:

```text
Socket.IO namespace `/queue` on `/socket.io`
```

The queue namespace sends `queue_counts` events with the counts payload.
Counts include `bo1`, `bo3`, and `bo5` for 1v1 plus `group_bo1`,
`group_bo3`, `group_bo5`, and `group_total` for four-player matches. It updates
immediately and whenever a player joins, pairs, or cancels. It carries only
aggregate public counts and does not expose session credentials.

Room creation, room join, and quick matching return the same session shape:

```json
{
  "room_code": "CS-207207",
  "player_id": "a3827574-2b32-43cc-a19a-2398ab0ad54f",
  "session_token": "keep-this-secret",
  "socket_io_url": "http://127.0.0.1:8080/socket.io",
  "snapshot": {
    "seq": 0,
    "room_code": "CS-207207",
    "kind": "friend",
    "visibility": "hidden",
    "phase": "waiting",
    "self_player_id": "a3827574-2b32-43cc-a19a-2398ab0ad54f",
    "host_player_id": "a3827574-2b32-43cc-a19a-2398ab0ad54f",
    "max_players": 4,
    "max_guesses": 6,
    "best_of": 3,
    "round_number": 0,
    "players": [
      {
        "player_id": "a3827574-2b32-43cc-a19a-2398ab0ad54f",
        "display_name": "0SAMAS",
        "connected": false,
        "guess_count": 0,
        "score": 0
      }
    ],
    "own_guesses": [],
    "opponent_progress": []
  }
}
```

`deadline_unix_ms` is present while playing. `round_finished` carries the
updated `scores`, `series_winner_player_id`, and (for quick matches)
`next_round_unix_ms`. The mystery is never included before the round finishes.

`own_guesses` and `opponent_progress` make reconnect snapshots complete.
Opponent history follows the same visibility redaction as live events, so a
refresh cannot reveal hidden guesses.

## Socket.IO protocol

Connect to:

```text
GET /v1/rooms/{room_code}/ws?session_token={session_token}
```

Use `wss://` in production. Session tokens are 256-bit random values and are
stored in memory only as SHA-256 hashes. A new connection with the same token
atomically supersedes the previous socket, which makes reconnect safe even
when a stale TCP connection has not noticed the network loss.

Client messages are JSON text. Every mutation carries a stable UUID
`request_id`:

```json
{"type":"start_round","request_id":"b56c6e7c-d5d4-46fa-878b-bb84484d59af"}
{"type":"guess","request_id":"b2d17e51-e3e7-4b37-a242-50d936f88443","player_id":"donk"}
{"type":"set_visibility","request_id":"b91b2e28-e5e4-45cb-a56a-69b9db50a563","visibility":"open"}
```

`start_round` and `set_visibility` are host-only friend-room commands.
Quick rooms start automatically when paired. Repeating a guess with the same
`request_id` returns the cached logical result without consuming another
attempt.

Server events are tagged JSON objects and contain a room-global increasing
`seq`:

- `snapshot`
- `player_joined`
- `player_connection`
- `round_started`
- `guess_accepted`
- `opponent_progress`
- `visibility_changed`
- `round_finished`
- `ack`
- `error`

In hidden mode, `opponent_progress.guessed_player_id` is `null`; clients only
receive the opponent's attempt number and `matched_fields`. In open mode, the
guessed player ID is included. `round_finished` is the first event that reveals
the mystery.

## Reliability model

- A single room actor is the authoritative state machine and ordering point.
- The registry is a concurrent `DashMap`; matchmaking releases its queue lock
  before any actor await.
- Public matchmaking counts use a Tokio `watch` channel and share one
  pre-serialized snapshot across all queue WebSocket subscribers. Bursts are
  coalesced and each client receives at most one update per configured
  broadcast interval.
- All actor and socket queues are bounded. A client that cannot drain its
  outbound queue is detached rather than blocking the room.
- Broadcast payloads are serialized from shared `Arc<ServerMessage>` values,
  so fan-out clones references rather than every event body.
- WebSocket frames are capped at 8 KiB.
- Browser WebSocket origins are checked against the configured allow-list.
- Each socket has a token bucket of 20 messages, refilled at 10 messages/sec.
- Ping runs every 15 seconds by default; clients silent for 45 seconds are
  disconnected.
- Reserved players can reconnect with the same token. Waiting-room guest
  reservations expire after the configured grace period.
- A player disconnected during a round has a separate 30-second recovery
  window. After it expires the player forfeits that round; the last eligible
  player wins, or the round is drawn if nobody remains.
- Rooms with no connections expire after the idle timeout.
- HTTP work has a global concurrency ceiling and request IDs are propagated as
  `x-request-id`.
- SIGINT/SIGTERM marks readiness false, drains HTTP, and cancels room actors.
- JSON `tracing` logs are suitable for log aggregation.

This implementation deliberately keeps matchmaking and room state in one
process for low latency. Before running multiple replicas, add a shared
matchmaking/room-directory service (for example Redis) and route each room code
to its owning instance via a gateway or consistent hash. Do not put two
independent actors in charge of one room.

## Configuration

See [`.env.example`](.env.example). Important settings:

| Variable | Purpose |
| --- | --- |
| `CS_GUESS_BIND_ADDR` | Listen address |
| `CS_GUESS_PUBLIC_BASE_URL` | Base used in returned Socket.IO URLs |
| `CS_GUESS_ALLOWED_ORIGINS` | Comma-separated exact CORS origins |
| `CS_GUESS_MAX_ROOMS` | Per-process active room ceiling |
| `CS_GUESS_ROOM_IDLE_SECS` | Empty-connection room lifetime |
| `CS_GUESS_RECONNECT_SECS` | Waiting guest reservation grace |
| `CS_GUESS_DISCONNECT_FORFEIT_SECS` | In-round disconnect recovery window |
| `CS_GUESS_HEARTBEAT_SECS` | Server ping interval |
| `CS_GUESS_CLIENT_TIMEOUT_SECS` | Silent client timeout |
| `CS_GUESS_QUEUE_BROADCAST_MS` | Minimum interval between public queue updates (default 1000 ms) |
| `CS_GUESS_WS_QUEUE_CAPACITY` | Per-connection outbound buffer |
| `CS_GUESS_ROOM_QUEUE_CAPACITY` | Per-room command buffer |
| `CS_GUESS_HTTP_CONCURRENCY_LIMIT` | In-flight HTTP request ceiling |
| `CS_GUESS_MAX_WEBSOCKET_CONNECTIONS` | Process-wide Socket.IO connection ceiling |
| `CS_GUESS_SESSION_RATE_CAPACITY` | Session endpoint token-bucket burst |
| `CS_GUESS_SESSION_RATE_REFILL_PER_SECOND` | Session endpoint token refill rate |

## Verification

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build --release
```

The tests cover validation, HTTP create/join/cancel, rule-aware matchmaking,
BO3 scoring, token handling, hidden-mode redaction, reconnect, idempotent
guesses, and concurrent room creation.
