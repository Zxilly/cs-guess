use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::{
    sync::{mpsc, oneshot},
    time::{MissedTickBehavior, interval},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    config::Config,
    error::AppError,
    protocol::{
        ClientMessage, GuessView, MAX_GUESSES, OpponentProgressView, Phase, PlayerView, RoomKind,
        ScoreView, ServerMessage, Snapshot, Visibility,
    },
};

pub type OutboundMessage = Arc<ServerMessage>;

#[derive(Clone, Debug)]
pub struct NewPlayer {
    pub player_id: Uuid,
    pub session_token: String,
    display_name: String,
}

impl NewPlayer {
    pub fn new(identity_id: String) -> Result<Self, AppError> {
        let display_name = player_by_id(identity_id.trim())
            .map(|player| player.nickname.clone())
            .ok_or_else(|| {
                AppError::BadRequest("identity_id is not in the player catalog".into())
            })?;
        let mut token = [0_u8; 32];
        rand::rng().fill_bytes(&mut token);
        Ok(Self {
            player_id: Uuid::new_v4(),
            session_token: URL_SAFE_NO_PAD.encode(token),
            display_name,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CancelledMatch {
    pub remaining_players: u32,
    pub visibility: Visibility,
    pub best_of: u8,
    pub party_size: u8,
    pub closed: bool,
}

#[derive(Clone)]
pub struct RoomHandle {
    tx: mpsc::Sender<RoomCommand>,
}

impl RoomHandle {
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }

    pub async fn reserve_player(&self, identity_id: String) -> Result<NewPlayer, AppError> {
        self.reserve_player_with_status(identity_id)
            .await
            .map(|(player, _)| player)
    }

    pub async fn reserve_player_with_status(
        &self,
        identity_id: String,
    ) -> Result<(NewPlayer, bool), AppError> {
        let player = NewPlayer::new(identity_id)?;
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::Reserve {
                player: player.clone(),
                reply: reply_tx,
            })
            .await
            .map_err(|_| AppError::Unavailable)?;
        let ready = reply_rx.await.map_err(|_| AppError::Unavailable)??;
        Ok((player, ready))
    }

    pub async fn snapshot(&self, player_id: Uuid) -> Result<Snapshot, AppError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::Snapshot {
                player_id,
                reply: reply_tx,
            })
            .await
            .map_err(|_| AppError::Unavailable)?;
        reply_rx.await.map_err(|_| AppError::Unavailable)?
    }

    pub async fn connect(
        &self,
        session_token: String,
        outbound: mpsc::Sender<OutboundMessage>,
    ) -> Result<(Uuid, Uuid), AppError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::Connect {
                session_token,
                outbound,
                reply: reply_tx,
            })
            .await
            .map_err(|_| AppError::Unavailable)?;
        reply_rx.await.map_err(|_| AppError::Unavailable)?
    }

    pub async fn disconnect(&self, player_id: Uuid, connection_id: Uuid) {
        let _ = self
            .tx
            .send(RoomCommand::Disconnect {
                player_id,
                connection_id,
            })
            .await;
    }

    pub async fn client_message(
        &self,
        player_id: Uuid,
        connection_id: Uuid,
        message: ClientMessage,
    ) -> Result<(), AppError> {
        self.tx
            .send(RoomCommand::Client {
                player_id,
                connection_id,
                message,
            })
            .await
            .map_err(|_| AppError::Unavailable)
    }

    pub async fn protocol_error(&self, player_id: Uuid, connection_id: Uuid) {
        let _ = self
            .tx
            .send(RoomCommand::ProtocolError {
                player_id,
                connection_id,
            })
            .await;
    }

    pub async fn start_if_ready(&self) -> Result<(), AppError> {
        self.tx
            .send(RoomCommand::StartIfReady)
            .await
            .map_err(|_| AppError::Unavailable)
    }

    pub async fn cancel_match(&self, session_token: String) -> Result<CancelledMatch, AppError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::CancelMatch {
                session_token,
                reply: reply_tx,
            })
            .await
            .map_err(|_| AppError::Unavailable)?;
        reply_rx.await.map_err(|_| AppError::Unavailable)?
    }

    #[cfg(test)]
    async fn target_id(&self) -> &'static str {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::Target { reply: reply_tx })
            .await
            .expect("test room is open");
        reply_rx.await.expect("test room returns target")
    }
}

enum RoomCommand {
    Reserve {
        player: NewPlayer,
        reply: oneshot::Sender<Result<bool, AppError>>,
    },
    Snapshot {
        player_id: Uuid,
        reply: oneshot::Sender<Result<Snapshot, AppError>>,
    },
    Connect {
        session_token: String,
        outbound: mpsc::Sender<OutboundMessage>,
        reply: oneshot::Sender<Result<(Uuid, Uuid), AppError>>,
    },
    Disconnect {
        player_id: Uuid,
        connection_id: Uuid,
    },
    Client {
        player_id: Uuid,
        connection_id: Uuid,
        message: ClientMessage,
    },
    ProtocolError {
        player_id: Uuid,
        connection_id: Uuid,
    },
    CancelMatch {
        session_token: String,
        reply: oneshot::Sender<Result<CancelledMatch, AppError>>,
    },
    StartIfReady,
    #[cfg(test)]
    Target {
        reply: oneshot::Sender<&'static str>,
    },
}

struct Participant {
    player_id: Uuid,
    display_name: String,
    token_hash: [u8; 32],
    outbound: Option<mpsc::Sender<OutboundMessage>>,
    connection_id: Option<Uuid>,
    score: u8,
    guesses: Vec<String>,
    cached_guesses: HashMap<Uuid, CachedGuess>,
    seen_requests: HashSet<Uuid>,
    disconnected_at: Option<Instant>,
    forfeited_round: bool,
}

#[derive(Clone)]
struct CachedGuess {
    player_id: String,
    guess_number: usize,
    matched_fields: Vec<&'static str>,
    country_relation: &'static str,
    country_distance_km: Option<u32>,
    correct: bool,
}

struct RoomActor {
    room_code: String,
    kind: RoomKind,
    visibility: Visibility,
    phase: Phase,
    max_players: u8,
    best_of: u8,
    round_number: u8,
    host_player_id: Uuid,
    players: HashMap<Uuid, Participant>,
    target_id: &'static str,
    winner_player_id: Option<Uuid>,
    series_winner_player_id: Option<Uuid>,
    deadline: Option<Instant>,
    deadline_unix_ms: Option<u64>,
    next_round_at: Option<Instant>,
    next_round_unix_ms: Option<u64>,
    closed: bool,
    seq: u64,
    last_activity: Instant,
    config: Config,
}

pub struct RoomSpec {
    pub room_code: String,
    pub kind: RoomKind,
    pub visibility: Visibility,
    pub max_players: u8,
    pub best_of: u8,
    pub host: NewPlayer,
}

pub fn spawn_room(spec: RoomSpec, config: Config, shutdown: CancellationToken) -> RoomHandle {
    let RoomSpec {
        room_code,
        kind,
        visibility,
        max_players,
        best_of,
        host,
    } = spec;
    let (tx, rx) = mpsc::channel(config.room_queue_capacity);
    let target_index = Uuid::new_v4().as_u128() as usize % PLAYERS.len();
    let host_player_id = host.player_id;
    let mut players = HashMap::new();
    players.insert(host.player_id, participant_from(host));

    let actor = RoomActor {
        room_code,
        kind,
        visibility,
        phase: Phase::Waiting,
        max_players,
        best_of,
        round_number: 0,
        host_player_id,
        players,
        target_id: PLAYERS[target_index].id.as_str(),
        winner_player_id: None,
        series_winner_player_id: None,
        deadline: None,
        deadline_unix_ms: None,
        next_round_at: None,
        next_round_unix_ms: None,
        closed: false,
        seq: 0,
        last_activity: Instant::now(),
        config,
    };
    tokio::spawn(actor.run(rx, shutdown));
    RoomHandle { tx }
}

impl RoomActor {
    async fn run(mut self, mut rx: mpsc::Receiver<RoomCommand>, shutdown: CancellationToken) {
        let mut maintenance = interval(Duration::from_secs(1));
        maintenance.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                command = rx.recv() => {
                    let Some(command) = command else { break };
                    self.last_activity = Instant::now();
                    self.handle(command);
                    if self.closed {
                        break;
                    }
                }
                _ = maintenance.tick() => {
                    self.maintain();
                    if self.players.values().all(|player| player.outbound.is_none())
                        && self.last_activity.elapsed() >= self.config.room_idle_timeout
                    {
                        break;
                    }
                }
            }
        }
    }

    fn handle(&mut self, command: RoomCommand) {
        match command {
            RoomCommand::Reserve { player, reply } => {
                let result = self.reserve(player);
                let _ = reply.send(result);
            }
            RoomCommand::Snapshot { player_id, reply } => {
                let result = self
                    .players
                    .contains_key(&player_id)
                    .then(|| self.snapshot_for(player_id))
                    .ok_or(AppError::Unauthorized);
                let _ = reply.send(result);
            }
            RoomCommand::Connect {
                session_token,
                outbound,
                reply,
            } => {
                let result = self.connect(&session_token, outbound);
                let _ = reply.send(result);
            }
            RoomCommand::Disconnect {
                player_id,
                connection_id,
            } => self.disconnect(player_id, connection_id),
            RoomCommand::Client {
                player_id,
                connection_id,
                message,
            } => {
                if self.is_active_connection(player_id, connection_id) {
                    self.handle_client(player_id, message);
                }
            }
            RoomCommand::ProtocolError {
                player_id,
                connection_id,
            } => {
                if self.is_active_connection(player_id, connection_id) {
                    self.error(
                        player_id,
                        None,
                        "invalid_message",
                        "message does not match the protocol",
                    );
                }
            }
            RoomCommand::CancelMatch {
                session_token,
                reply,
            } => {
                let result = self.cancel_match(&session_token);
                let _ = reply.send(result);
            }
            RoomCommand::StartIfReady => {
                if self.kind == RoomKind::Quick
                    && self
                        .players
                        .values()
                        .filter(|player| player.outbound.is_some())
                        .count()
                        == usize::from(self.max_players)
                {
                    self.start_round();
                }
            }
            #[cfg(test)]
            RoomCommand::Target { reply } => {
                let _ = reply.send(self.target_id);
            }
        }
    }

    fn reserve(&mut self, player: NewPlayer) -> Result<bool, AppError> {
        if self.phase != Phase::Waiting || self.players.len() >= usize::from(self.max_players) {
            return Err(AppError::RoomFull);
        }
        let view = PlayerView {
            player_id: player.player_id,
            display_name: player.display_name.clone(),
            connected: false,
            guess_count: 0,
            score: 0,
        };
        self.players
            .insert(player.player_id, participant_from(player));
        let seq = self.next_seq();
        self.broadcast(ServerMessage::PlayerJoined { seq, player: view });
        Ok(self.players.len() >= usize::from(self.max_players))
    }

    fn cancel_match(&mut self, session_token: &str) -> Result<CancelledMatch, AppError> {
        if self.kind != RoomKind::Quick || self.phase != Phase::Waiting {
            return Err(AppError::BadRequest(
                "only a waiting quick match can be cancelled".to_owned(),
            ));
        }
        let token_hash = hash_token(session_token);
        let player_id = self
            .players
            .values()
            .find(|player| bool::from(player.token_hash.ct_eq(&token_hash)))
            .map(|player| player.player_id)
            .ok_or(AppError::Unauthorized)?;
        self.players.remove(&player_id);
        if self.host_player_id == player_id
            && let Some(next_host) = self.players.keys().next().copied()
        {
            self.host_player_id = next_host;
        }
        let remaining_players = self.players.len() as u32;
        self.closed = remaining_players == 0;
        Ok(CancelledMatch {
            remaining_players,
            visibility: self.visibility,
            best_of: self.best_of,
            party_size: self.max_players,
            closed: self.closed,
        })
    }

    fn connect(
        &mut self,
        session_token: &str,
        outbound: mpsc::Sender<OutboundMessage>,
    ) -> Result<(Uuid, Uuid), AppError> {
        let token_hash = hash_token(session_token);
        let player_id = self
            .players
            .values()
            .find(|player| bool::from(player.token_hash.ct_eq(&token_hash)))
            .map(|player| player.player_id)
            .ok_or(AppError::Unauthorized)?;

        let connection_id = Uuid::new_v4();
        if let Some(player) = self.players.get_mut(&player_id) {
            player.outbound = Some(outbound);
            player.connection_id = Some(connection_id);
            player.disconnected_at = None;
        }

        let seq = self.next_seq();
        let snapshot = self.snapshot_for(player_id);
        self.send_to(player_id, ServerMessage::Snapshot { seq, snapshot });
        let seq = self.next_seq();
        self.broadcast_except(
            player_id,
            ServerMessage::PlayerConnection {
                seq,
                player_id,
                connected: true,
            },
        );
        if self.kind == RoomKind::Quick
            && self.phase == Phase::Waiting
            && self
                .players
                .values()
                .filter(|player| player.outbound.is_some())
                .count()
                == usize::from(self.max_players)
        {
            self.start_round();
        }
        Ok((player_id, connection_id))
    }

    fn disconnect(&mut self, player_id: Uuid, connection_id: Uuid) {
        let changed = if let Some(player) = self.players.get_mut(&player_id) {
            if player.connection_id != Some(connection_id) {
                return;
            }
            let changed = player.outbound.take().is_some();
            player.connection_id = None;
            player.disconnected_at = Some(Instant::now());
            changed
        } else {
            false
        };
        if changed {
            let seq = self.next_seq();
            self.broadcast_except(
                player_id,
                ServerMessage::PlayerConnection {
                    seq,
                    player_id,
                    connected: false,
                },
            );
        }
    }

    fn handle_client(&mut self, player_id: Uuid, message: ClientMessage) {
        if !self.players.contains_key(&player_id) {
            return;
        }
        match message {
            ClientMessage::StartRound { request_id } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                if player_id != self.host_player_id || self.kind != RoomKind::Friend {
                    self.error(
                        player_id,
                        Some(request_id),
                        "forbidden",
                        "only the friend-room host may start the round",
                    );
                } else if self
                    .players
                    .values()
                    .filter(|player| player.outbound.is_some())
                    .count()
                    < 2
                {
                    self.error(
                        player_id,
                        Some(request_id),
                        "not_ready",
                        "at least two connected players are required",
                    );
                } else {
                    self.mark_seen(player_id, request_id);
                    self.start_round();
                    self.ack(player_id, request_id);
                }
            }
            ClientMessage::SetVisibility {
                request_id,
                visibility,
            } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                if player_id != self.host_player_id || self.phase != Phase::Waiting {
                    self.error(
                        player_id,
                        Some(request_id),
                        "forbidden",
                        "only the host may change visibility before the round",
                    );
                } else {
                    self.mark_seen(player_id, request_id);
                    self.visibility = visibility;
                    let seq = self.next_seq();
                    self.broadcast(ServerMessage::VisibilityChanged {
                        seq,
                        request_id,
                        visibility,
                    });
                }
            }
            ClientMessage::Guess {
                request_id,
                player_id: guessed_player_id,
            } => self.guess(player_id, request_id, guessed_player_id),
        }
    }

    fn guess(&mut self, actor_id: Uuid, request_id: Uuid, guessed_player_id: String) {
        if let Some(cached) = self
            .players
            .get(&actor_id)
            .and_then(|player| player.cached_guesses.get(&request_id))
            .cloned()
        {
            self.send_guess_ack(actor_id, request_id, &cached);
            return;
        }
        if self.phase != Phase::Playing {
            self.error(
                actor_id,
                Some(request_id),
                "round_not_playing",
                "the round is not accepting guesses",
            );
            return;
        }
        let Some(guess_player) = player_by_id(&guessed_player_id) else {
            self.error(
                actor_id,
                Some(request_id),
                "unknown_player",
                "player_id is not in the current catalog",
            );
            return;
        };
        let Some(target) = player_by_id(self.target_id) else {
            self.error(actor_id, Some(request_id), "internal", "target unavailable");
            return;
        };
        if self
            .players
            .get(&actor_id)
            .is_some_and(|participant| participant.forfeited_round)
        {
            self.error(
                actor_id,
                Some(request_id),
                "round_forfeited",
                "the reconnect window expired for this round",
            );
            return;
        }
        let Some(participant) = self.players.get_mut(&actor_id) else {
            return;
        };
        if participant.guesses.len() >= MAX_GUESSES {
            self.error(
                actor_id,
                Some(request_id),
                "guess_limit",
                "no guesses remain",
            );
            return;
        }
        if participant
            .guesses
            .iter()
            .any(|value| value == &guessed_player_id)
        {
            self.error(
                actor_id,
                Some(request_id),
                "duplicate_guess",
                "that player was already guessed",
            );
            return;
        }

        let matched_fields = matched_fields(guess_player, target);
        let country = country_hint(guess_player, target);
        let correct = guess_player.id == target.id;
        participant.guesses.push(guessed_player_id.clone());
        let cached = CachedGuess {
            player_id: guessed_player_id,
            guess_number: participant.guesses.len(),
            matched_fields,
            country_relation: country.relation,
            country_distance_km: country.distance_km,
            correct,
        };
        participant
            .cached_guesses
            .insert(request_id, cached.clone());
        self.send_guess_ack(actor_id, request_id, &cached);

        let seq = self.next_seq();
        let visibility = self.visibility;
        self.broadcast_except(
            actor_id,
            ServerMessage::OpponentProgress {
                seq,
                player_id: actor_id,
                guess_number: cached.guess_number,
                guessed_player_id: (visibility == Visibility::Open)
                    .then(|| cached.player_id.clone()),
                matched_fields: cached.matched_fields.clone(),
                country_relation: cached.country_relation,
                country_distance_km: (visibility == Visibility::Open)
                    .then_some(cached.country_distance_km)
                    .flatten(),
                correct: cached.correct,
            },
        );

        if correct {
            self.finish_round(Some(actor_id));
        } else if self
            .players
            .values()
            .all(|player| player.forfeited_round || player.guesses.len() >= MAX_GUESSES)
        {
            self.finish_round(None);
        }
    }

    fn start_round(&mut self) {
        if self.phase == Phase::Playing || self.series_winner_player_id.is_some() {
            return;
        }
        if self.phase == Phase::Finished {
            let old_target = self.target_id;
            let mut target_index = Uuid::new_v4().as_u128() as usize % PLAYERS.len();
            if PLAYERS.len() > 1 && PLAYERS[target_index].id == old_target {
                target_index = (target_index + 1) % PLAYERS.len();
            }
            self.target_id = PLAYERS[target_index].id.as_str();
            self.winner_player_id = None;
            self.next_round_at = None;
            self.next_round_unix_ms = None;
            for player in self.players.values_mut() {
                player.guesses.clear();
                player.cached_guesses.clear();
                player.forfeited_round = false;
            }
        }
        self.phase = Phase::Playing;
        self.round_number = self.round_number.saturating_add(1);
        let duration = Duration::from_secs(180);
        self.deadline = Some(Instant::now() + duration);
        let deadline_unix_ms = unix_ms() + duration.as_millis() as u64;
        self.deadline_unix_ms = Some(deadline_unix_ms);
        let seq = self.next_seq();
        self.broadcast(ServerMessage::RoundStarted {
            seq,
            round_number: self.round_number,
            deadline_unix_ms,
        });
    }

    fn finish_round(&mut self, winner_player_id: Option<Uuid>) {
        if self.phase == Phase::Finished {
            return;
        }
        self.phase = Phase::Finished;
        self.winner_player_id = winner_player_id;
        if let Some(winner) = winner_player_id
            && let Some(player) = self.players.get_mut(&winner)
        {
            player.score = player.score.saturating_add(1);
            let wins_needed = self.best_of / 2 + 1;
            if player.score >= wins_needed {
                self.series_winner_player_id = Some(winner);
            }
        }
        self.deadline = None;
        self.deadline_unix_ms = None;
        if self.kind == RoomKind::Quick && self.series_winner_player_id.is_none() {
            let transition = Duration::from_secs(5);
            self.next_round_at = Some(Instant::now() + transition);
            self.next_round_unix_ms = Some(unix_ms() + transition.as_millis() as u64);
        }
        let seq = self.next_seq();
        let mystery_id = self.target_id.to_owned();
        let scores = self
            .players
            .values()
            .map(|player| ScoreView {
                player_id: player.player_id,
                score: player.score,
            })
            .collect();
        self.broadcast(ServerMessage::RoundFinished {
            seq,
            round_number: self.round_number,
            winner_player_id,
            series_winner_player_id: self.series_winner_player_id,
            scores,
            next_round_unix_ms: self.next_round_unix_ms,
            mystery_id,
        });
    }

    fn maintain(&mut self) {
        if self.phase == Phase::Playing {
            let forfeit_after = self.config.disconnect_forfeit;
            for player in self.players.values_mut() {
                if !player.forfeited_round
                    && player
                        .disconnected_at
                        .is_some_and(|instant| instant.elapsed() >= forfeit_after)
                {
                    player.forfeited_round = true;
                }
            }

            let active_players = self
                .players
                .values()
                .filter(|player| !player.forfeited_round)
                .map(|player| player.player_id)
                .collect::<Vec<_>>();
            let forfeited_count = self
                .players
                .values()
                .filter(|player| player.forfeited_round)
                .count();
            if forfeited_count > 0 && active_players.len() <= 1 {
                self.finish_round(active_players.first().copied());
            }
        }
        if self.phase == Phase::Playing
            && self
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.finish_round(None);
        }
        if self.phase == Phase::Finished
            && self
                .next_round_at
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.start_round();
        }

        if self.phase == Phase::Waiting && self.kind == RoomKind::Friend {
            let grace = self.config.reconnect_grace;
            let host_id = self.host_player_id;
            self.players.retain(|id, player| {
                *id == host_id
                    || player
                        .disconnected_at
                        .is_none_or(|instant| instant.elapsed() < grace)
            });
        }
    }

    fn snapshot_for(&self, self_player_id: Uuid) -> Snapshot {
        let reveal = self.phase == Phase::Finished;
        let target = player_by_id(self.target_id);
        let own_guesses = self
            .players
            .get(&self_player_id)
            .into_iter()
            .flat_map(|player| player.guesses.iter())
            .enumerate()
            .filter_map(|(index, guessed_id)| {
                let guessed = player_by_id(guessed_id)?;
                let target = target?;
                let country = country_hint(guessed, target);
                Some(GuessView {
                    player_id: guessed_id.clone(),
                    guess_number: index + 1,
                    matched_fields: matched_fields(guessed, target),
                    country_relation: country.relation,
                    country_distance_km: country.distance_km,
                    correct: guessed.id == target.id,
                })
            })
            .collect();
        let opponent_progress = self
            .players
            .values()
            .filter(|player| player.player_id != self_player_id)
            .flat_map(|player| {
                player
                    .guesses
                    .iter()
                    .enumerate()
                    .filter_map(move |(index, guessed_id)| {
                        let guessed = player_by_id(guessed_id)?;
                        let target = target?;
                        let country = country_hint(guessed, target);
                        Some(OpponentProgressView {
                            player_id: player.player_id,
                            guess_number: index + 1,
                            guessed_player_id: (self.visibility == Visibility::Open)
                                .then(|| guessed_id.clone()),
                            matched_fields: matched_fields(guessed, target),
                            country_relation: country.relation,
                            country_distance_km: (self.visibility == Visibility::Open)
                                .then_some(country.distance_km)
                                .flatten(),
                            correct: guessed.id == target.id,
                        })
                    })
            })
            .collect();
        Snapshot {
            seq: self.seq,
            room_code: self.room_code.clone(),
            kind: self.kind,
            visibility: self.visibility,
            phase: self.phase,
            self_player_id,
            host_player_id: self.host_player_id,
            max_players: self.max_players,
            max_guesses: MAX_GUESSES,
            best_of: self.best_of,
            round_number: self.round_number,
            deadline_unix_ms: self.deadline_unix_ms,
            next_round_unix_ms: self.next_round_unix_ms,
            players: self
                .players
                .values()
                .map(|player| PlayerView {
                    player_id: player.player_id,
                    display_name: player.display_name.clone(),
                    connected: player.outbound.is_some(),
                    guess_count: player.guesses.len(),
                    score: player.score,
                })
                .collect(),
            own_guesses,
            opponent_progress,
            winner_player_id: self.winner_player_id,
            series_winner_player_id: self.series_winner_player_id,
            mystery_id: reveal.then(|| self.target_id.to_owned()),
        }
    }

    fn send_guess_ack(&mut self, actor_id: Uuid, request_id: Uuid, cached: &CachedGuess) {
        let seq = self.next_seq();
        self.send_to(
            actor_id,
            ServerMessage::GuessAccepted {
                seq,
                request_id,
                player_id: cached.player_id.clone(),
                guess_number: cached.guess_number,
                matched_fields: cached.matched_fields.clone(),
                country_relation: cached.country_relation,
                country_distance_km: cached.country_distance_km,
                correct: cached.correct,
            },
        );
    }

    fn ack(&mut self, player_id: Uuid, request_id: Uuid) {
        let seq = self.next_seq();
        self.send_to(player_id, ServerMessage::Ack { seq, request_id });
    }

    fn error(
        &mut self,
        player_id: Uuid,
        request_id: Option<Uuid>,
        code: &'static str,
        message: &'static str,
    ) {
        let seq = self.next_seq();
        self.send_to(
            player_id,
            ServerMessage::Error {
                seq,
                request_id,
                code,
                message: message.to_owned(),
            },
        );
    }

    fn is_duplicate(&self, player_id: Uuid, request_id: Uuid) -> bool {
        self.players
            .get(&player_id)
            .is_some_and(|player| player.seen_requests.contains(&request_id))
    }

    fn is_active_connection(&self, player_id: Uuid, connection_id: Uuid) -> bool {
        self.players
            .get(&player_id)
            .is_some_and(|player| player.connection_id == Some(connection_id))
    }

    fn mark_seen(&mut self, player_id: Uuid, request_id: Uuid) {
        if let Some(player) = self.players.get_mut(&player_id) {
            player.seen_requests.insert(request_id);
        }
    }

    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    fn send_to(&mut self, player_id: Uuid, message: ServerMessage) {
        self.send_shared(player_id, Arc::new(message));
    }

    fn send_shared(&mut self, player_id: Uuid, message: OutboundMessage) {
        let mut detached = Vec::new();
        if let Some(player) = self.players.get_mut(&player_id)
            && let Some(outbound) = &player.outbound
            && outbound.try_send(message).is_err()
        {
            player.outbound = None;
            player.connection_id = None;
            player.disconnected_at = Some(Instant::now());
            detached.push(player_id);
        }
        self.broadcast_detached(detached);
    }

    fn broadcast(&mut self, message: ServerMessage) {
        let message = Arc::new(message);
        let mut detached = Vec::new();
        for player in self.players.values_mut() {
            if let Some(outbound) = &player.outbound
                && outbound.try_send(Arc::clone(&message)).is_err()
            {
                player.outbound = None;
                player.connection_id = None;
                player.disconnected_at = Some(Instant::now());
                detached.push(player.player_id);
            }
        }
        self.broadcast_detached(detached);
    }

    fn broadcast_except(&mut self, excluded: Uuid, message: ServerMessage) {
        let message = Arc::new(message);
        let mut detached = Vec::new();
        for player in self
            .players
            .values_mut()
            .filter(|player| player.player_id != excluded)
        {
            if let Some(outbound) = &player.outbound
                && outbound.try_send(Arc::clone(&message)).is_err()
            {
                player.outbound = None;
                player.connection_id = None;
                player.disconnected_at = Some(Instant::now());
                detached.push(player.player_id);
            }
        }
        self.broadcast_detached(detached);
    }

    fn broadcast_detached(&mut self, detached: Vec<Uuid>) {
        let mut pending = detached;
        let mut announced = HashSet::new();
        while let Some(player_id) = pending.pop() {
            if !announced.insert(player_id) {
                continue;
            }
            let message = Arc::new(ServerMessage::PlayerConnection {
                seq: self.next_seq(),
                player_id,
                connected: false,
            });
            for player in self
                .players
                .values_mut()
                .filter(|player| player.player_id != player_id)
            {
                if let Some(outbound) = &player.outbound
                    && outbound.try_send(Arc::clone(&message)).is_err()
                {
                    player.outbound = None;
                    player.connection_id = None;
                    player.disconnected_at = Some(Instant::now());
                    pending.push(player.player_id);
                }
            }
        }
    }
}

fn participant_from(player: NewPlayer) -> Participant {
    Participant {
        player_id: player.player_id,
        display_name: player.display_name,
        token_hash: hash_token(&player.session_token),
        outbound: None,
        connection_id: None,
        score: 0,
        guesses: Vec::new(),
        cached_guesses: HashMap::new(),
        seen_requests: HashSet::new(),
        disconnected_at: Some(Instant::now()),
        forfeited_round: false,
    }
}

fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogPlayer {
    id: String,
    nickname: String,
    team: String,
    #[serde(rename = "countryCode")]
    country_code: String,
    age: u8,
    role: String,
    #[serde(rename = "majorAppearances")]
    majors: u16,
}

static PLAYERS: LazyLock<Vec<CatalogPlayer>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/data/players.generated.json"))
        .expect("generated player catalog must be valid JSON")
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CountryMetadata {
    code: String,
    continent: String,
    capital: Option<[f64; 2]>,
}

#[derive(Clone, Copy)]
struct CountryHint {
    relation: &'static str,
    distance_km: Option<u32>,
}

static COUNTRIES: LazyLock<HashMap<String, CountryMetadata>> = LazyLock::new(|| {
    serde_json::from_str::<Vec<CountryMetadata>>(include_str!(
        "../../src/data/countries.generated.json"
    ))
    .expect("generated country metadata must be valid JSON")
    .into_iter()
    .map(|country| (country.code.clone(), country))
    .collect()
});

fn player_by_id(id: &str) -> Option<&'static CatalogPlayer> {
    PLAYERS.iter().find(|player| player.id == id)
}

fn matched_fields(guess: &CatalogPlayer, target: &CatalogPlayer) -> Vec<&'static str> {
    let mut result = Vec::with_capacity(6);
    if guess.team == target.team {
        result.push("team");
    }
    if normalize_country_code(&guess.country_code) == normalize_country_code(&target.country_code) {
        result.push("nationality");
    }
    if guess.age == target.age {
        result.push("age");
    }
    if guess.role == target.role {
        result.push("role");
    }
    if guess.majors == target.majors {
        result.push("major_appearances");
    }
    result
}

fn country_hint(guess: &CatalogPlayer, target: &CatalogPlayer) -> CountryHint {
    let guess_code = normalize_country_code(&guess.country_code);
    let target_code = normalize_country_code(&target.country_code);
    if guess_code == target_code {
        return CountryHint {
            relation: "match",
            distance_km: Some(0),
        };
    }

    let guess_country = COUNTRIES.get(guess_code);
    let target_country = COUNTRIES.get(target_code);
    let relation = if guess_country
        .zip(target_country)
        .is_some_and(|(guess, target)| guess.continent == target.continent)
    {
        "near"
    } else {
        "miss"
    };
    CountryHint {
        relation,
        distance_km: guess_country
            .and_then(|country| country.capital)
            .zip(target_country.and_then(|country| country.capital))
            .map(|(from, to)| capital_distance_km(from, to)),
    }
}

fn normalize_country_code(country_code: &str) -> &str {
    match country_code {
        "HK" | "MO" | "TW" => "CN",
        "XK" => "RS",
        _ => country_code,
    }
}

fn capital_distance_km(from: [f64; 2], to: [f64; 2]) -> u32 {
    let [from_latitude, from_longitude] = from.map(f64::to_radians);
    let [to_latitude, to_longitude] = to.map(f64::to_radians);
    let latitude_delta = to_latitude - from_latitude;
    let longitude_delta = to_longitude - from_longitude;
    let haversine = (latitude_delta / 2.0).sin().powi(2)
        + from_latitude.cos() * to_latitude.cos() * (longitude_delta / 2.0).sin().powi(2);

    (6_371.008_8 * 2.0 * haversine.sqrt().asin()).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;

    #[test]
    fn comparison_only_returns_exact_fields() {
        let guess = CatalogPlayer {
            id: "guess".to_owned(),
            nickname: "Guess".to_owned(),
            team: "Shared Team".to_owned(),
            country_code: "FR".to_owned(),
            age: 20,
            role: "AWPer".to_owned(),
            majors: 1,
        };
        let target = CatalogPlayer {
            id: "target".to_owned(),
            nickname: "Target".to_owned(),
            team: "Shared Team".to_owned(),
            country_code: "DK".to_owned(),
            age: 21,
            role: "Rifler".to_owned(),
            majors: 2,
        };

        let result = matched_fields(&guess, &target);
        assert_eq!(result, vec!["team"]);
    }

    #[test]
    fn country_hint_uses_normalized_codes_continents_and_capital_distance() {
        let guess = CatalogPlayer {
            id: "guess".to_owned(),
            nickname: "Guess".to_owned(),
            team: "A".to_owned(),
            country_code: "FR".to_owned(),
            age: 20,
            role: "Rifler".to_owned(),
            majors: 1,
        };
        let target = CatalogPlayer {
            id: "target".to_owned(),
            nickname: "Target".to_owned(),
            team: "B".to_owned(),
            country_code: "DE".to_owned(),
            age: 21,
            role: "AWPer".to_owned(),
            majors: 2,
        };

        let hint = country_hint(&guess, &target);
        assert_eq!(hint.relation, "near");
        assert!(
            hint.distance_km
                .is_some_and(|distance| (850..900).contains(&distance))
        );

        let china = CatalogPlayer {
            country_code: "CN".to_owned(),
            ..target
        };
        let taiwan = CatalogPlayer {
            country_code: "TW".to_owned(),
            ..guess
        };
        let normalized_hint = country_hint(&taiwan, &china);
        assert_eq!(normalized_hint.relation, "match");
        assert_eq!(normalized_hint.distance_km, Some(0));
    }

    #[test]
    fn session_tokens_are_unique_and_not_stored_in_plaintext() {
        let first = NewPlayer::new("0samas".to_owned()).unwrap();
        let second = NewPlayer::new("1nvisiblee".to_owned()).unwrap();
        assert_ne!(first.session_token, second.session_token);
        let participant = participant_from(first.clone());
        assert!(bool::from(
            participant
                .token_hash
                .ct_eq(&hash_token(&first.session_token))
        ));
    }

    #[tokio::test]
    async fn hidden_progress_is_redacted_and_guess_is_idempotent() {
        let config = Config::for_test();
        let shutdown = CancellationToken::new();
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-207207".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
            },
            config,
            shutdown,
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, mut host_rx) = mpsc::channel(16);
        let (guest_tx, _guest_rx) = mpsc::channel(16);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, guest_connection) = room
            .connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();

        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        let guess_request_id = Uuid::new_v4();
        let guess = ClientMessage::Guess {
            request_id: guess_request_id,
            player_id: "donk".to_owned(),
        };
        room.client_message(guest.player_id, guest_connection, guess.clone())
            .await
            .unwrap();
        room.client_message(guest.player_id, guest_connection, guess)
            .await
            .unwrap();

        let progress = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::OpponentProgress {
                        guessed_player_id, ..
                    } = message.as_ref()
                {
                    break guessed_player_id.clone();
                }
            }
        })
        .await
        .expect("host receives progress");
        assert_eq!(progress, None);

        let snapshot = room.snapshot(guest.player_id).await.unwrap();
        let guest_view = snapshot
            .players
            .iter()
            .find(|player| player.player_id == guest.player_id)
            .unwrap();
        assert_eq!(guest_view.guess_count, 1);
        assert_eq!(snapshot.own_guesses.len(), 1);
        assert_eq!(snapshot.own_guesses[0].player_id, "donk");
        let host_snapshot = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(host_snapshot.opponent_progress.len(), 1);
        assert_eq!(
            host_snapshot.opponent_progress[0].player_id,
            guest.player_id
        );
        assert_eq!(host_snapshot.opponent_progress[0].guessed_player_id, None);
        if snapshot.phase != Phase::Finished {
            assert!(snapshot.mystery_id.is_none());
        }
    }

    #[tokio::test]
    async fn best_of_three_tracks_scores_and_declares_series_winner() {
        let config = Config::for_test();
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-303303".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                max_players: 2,
                best_of: 3,
                host: host.clone(),
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(64);
        let (guest_tx, _guest_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, guest_connection) = room
            .connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();

        for expected_score in 1..=2 {
            room.client_message(
                host.player_id,
                host_connection,
                ClientMessage::StartRound {
                    request_id: Uuid::new_v4(),
                },
            )
            .await
            .unwrap();
            let target = room.target_id().await;
            room.client_message(
                guest.player_id,
                guest_connection,
                ClientMessage::Guess {
                    request_id: Uuid::new_v4(),
                    player_id: target.to_owned(),
                },
            )
            .await
            .unwrap();

            let snapshot = room.snapshot(guest.player_id).await.unwrap();
            let score = snapshot
                .players
                .iter()
                .find(|player| player.player_id == guest.player_id)
                .unwrap()
                .score;
            assert_eq!(score, expected_score);
            assert_eq!(snapshot.round_number, expected_score);
            if expected_score == 1 {
                assert_eq!(snapshot.series_winner_player_id, None);
            } else {
                assert_eq!(snapshot.series_winner_player_id, Some(guest.player_id));
            }
        }
    }

    #[tokio::test]
    async fn disconnected_player_forfeits_after_grace_period() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-404404".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(16);
        let (guest_tx, _guest_rx) = mpsc::channel(16);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, guest_connection) = room
            .connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();

        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        room.disconnect(guest.player_id, guest_connection).await;

        let finished = timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = room.snapshot(host.player_id).await.unwrap();
                if snapshot.phase == Phase::Finished {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("room resolves the disconnect forfeit");

        assert_eq!(finished.winner_player_id, Some(host.player_id));
        assert_eq!(finished.series_winner_player_id, Some(host.player_id));
    }
}
