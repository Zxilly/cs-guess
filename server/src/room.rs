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
use tracing::warn;
use uuid::Uuid;

use crate::{
    config::Config,
    database::DatabaseStore,
    error::AppError,
    profile::{AuthoritativeRoundSettlement, RoundRecordDetails},
    protocol::{
        ClientMessage, Difficulty, FinishReason, GuessView, OpponentProgressView, Phase,
        PlayerView, RematchDecision, RematchResponseView, RematchStatus, RematchView, RoomKind,
        RoundResultView, RoundStandingView, ScoreView, SeriesFinishReason, SeriesStandingView,
        SeriesStatus, ServerMessage, Snapshot, Visibility,
    },
    state::QueueTelemetry,
};

pub type OutboundMessage = Arc<ServerMessage>;

#[derive(Clone, Debug)]
pub struct NewPlayer {
    pub player_id: Uuid,
    pub session_token: String,
    display_name: String,
    profile_id: Option<String>,
}

impl NewPlayer {
    pub fn new(identity_id: String) -> Result<Self, AppError> {
        Self::new_with_profile(identity_id, None)
    }

    pub fn new_with_profile(
        identity_id: String,
        profile_id: Option<String>,
    ) -> Result<Self, AppError> {
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
            profile_id,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CancelledMatch {
    pub remaining_players: u32,
    pub visibility: Visibility,
    pub best_of: u8,
    pub party_size: u8,
    pub difficulty: Difficulty,
    pub closed: bool,
    pub requeue: bool,
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
        self.reserve_player_with_profile(identity_id, None).await
    }

    pub async fn reserve_player_with_profile(
        &self,
        identity_id: String,
        profile_id: Option<String>,
    ) -> Result<(NewPlayer, bool), AppError> {
        let player = NewPlayer::new_with_profile(identity_id, profile_id)?;
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

    pub async fn leave_friend_room(
        &self,
        session_token: String,
    ) -> Result<CancelledMatch, AppError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RoomCommand::LeaveFriendRoom {
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
    LeaveFriendRoom {
        session_token: String,
        reply: oneshot::Sender<Result<CancelledMatch, AppError>>,
    },
    StartIfReady,
    FinalizeRematch {
        invitation_id: Uuid,
    },
    #[cfg(test)]
    Target {
        reply: oneshot::Sender<&'static str>,
    },
}

struct Participant {
    player_id: Uuid,
    seat_index: u8,
    display_name: String,
    profile_id: Option<String>,
    token_hash: [u8; 32],
    outbound: Option<mpsc::Sender<OutboundMessage>>,
    connection_id: Option<Uuid>,
    score: u8,
    guesses: Vec<String>,
    cached_guesses: HashMap<Uuid, CachedGuess>,
    seen_requests: HashSet<Uuid>,
    disconnected_at: Option<Instant>,
    disconnect_deadline_unix_ms: Option<u64>,
    forfeited_round: bool,
}

#[derive(Clone)]
struct CachedGuess {
    seq: u64,
    player_id: String,
    guess_number: usize,
    matched_fields: Vec<&'static str>,
    team_relation: &'static str,
    country_relation: &'static str,
    country_distance_km: Option<u32>,
    correct: bool,
}

struct RematchInvitation {
    invitation_id: Uuid,
    requester_player_id: Uuid,
    status: RematchStatus,
    expires_at: Instant,
    expires_at_unix_ms: u64,
    responses: HashMap<Uuid, RematchDecision>,
    transition_at: Option<Instant>,
    clear_at: Option<Instant>,
}

struct RoomActor {
    room_code: String,
    kind: RoomKind,
    visibility: Visibility,
    difficulty: Difficulty,
    phase: Phase,
    max_players: u8,
    best_of: u8,
    round_number: u8,
    series_id: Uuid,
    host_player_id: Uuid,
    players: HashMap<Uuid, Participant>,
    target_id: &'static str,
    winner_player_id: Option<Uuid>,
    series_winner_player_id: Option<Uuid>,
    series_status: SeriesStatus,
    series_finish_reason: Option<SeriesFinishReason>,
    series_final_standings: Option<Vec<SeriesStandingView>>,
    round_results: Vec<RoundResultView>,
    finish_reason: Option<FinishReason>,
    deadline: Option<Instant>,
    deadline_unix_ms: Option<u64>,
    next_round_at: Option<Instant>,
    next_round_unix_ms: Option<u64>,
    closed: bool,
    seq: u64,
    last_activity: Instant,
    config: Config,
    queue_telemetry: Arc<QueueTelemetry>,
    telemetry_active: bool,
    rematch: Option<RematchInvitation>,
    command_tx: mpsc::Sender<RoomCommand>,
    database: Option<DatabaseStore>,
}

pub struct RoomSpec {
    pub room_code: String,
    pub kind: RoomKind,
    pub visibility: Visibility,
    pub difficulty: Difficulty,
    pub max_players: u8,
    pub best_of: u8,
    pub host: NewPlayer,
    pub(crate) queue_telemetry: Arc<QueueTelemetry>,
    pub(crate) database: Option<DatabaseStore>,
}

pub fn spawn_room(spec: RoomSpec, config: Config, shutdown: CancellationToken) -> RoomHandle {
    let RoomSpec {
        room_code,
        kind,
        visibility,
        difficulty,
        max_players,
        best_of,
        host,
        queue_telemetry,
        database,
    } = spec;
    let (tx, rx) = mpsc::channel(config.room_queue_capacity);
    let mystery_pool = PLAYERS
        .iter()
        .filter(|player| match difficulty {
            Difficulty::Easy => player.major_wins > 0 || player.majors >= 5,
            Difficulty::Full => player.majors > 0,
            Difficulty::Hard => true,
        })
        .collect::<Vec<_>>();
    let target_index = Uuid::new_v4().as_u128() as usize % mystery_pool.len();
    let host_player_id = host.player_id;
    let mut players = HashMap::new();
    players.insert(host.player_id, participant_from(host, 0));

    let actor = RoomActor {
        room_code,
        kind,
        visibility,
        difficulty,
        phase: Phase::Waiting,
        max_players,
        best_of,
        round_number: 0,
        series_id: Uuid::new_v4(),
        host_player_id,
        players,
        target_id: mystery_pool[target_index].id.as_str(),
        winner_player_id: None,
        series_winner_player_id: None,
        series_status: SeriesStatus::Active,
        series_finish_reason: None,
        series_final_standings: None,
        round_results: Vec::new(),
        finish_reason: None,
        deadline: None,
        deadline_unix_ms: None,
        next_round_at: None,
        next_round_unix_ms: None,
        closed: false,
        seq: 0,
        last_activity: Instant::now(),
        config,
        queue_telemetry,
        telemetry_active: false,
        rematch: None,
        command_tx: tx.clone(),
        database,
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
                    if self.closed {
                        break;
                    }
                    if self.players.values().all(|player| player.outbound.is_none())
                        && self.last_activity.elapsed() >= self.config.room_idle_timeout
                    {
                        break;
                    }
                }
            }
        }
        self.set_telemetry_active(false);
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
            RoomCommand::LeaveFriendRoom {
                session_token,
                reply,
            } => {
                let result = self.leave_friend_room(&session_token);
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
            RoomCommand::FinalizeRematch { invitation_id } => {
                self.finalize_rematch(invitation_id);
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
        let seat_index = (0..self.max_players)
            .find(|seat| {
                self.players
                    .values()
                    .all(|participant| participant.seat_index != *seat)
            })
            .ok_or(AppError::RoomFull)?;
        let view = PlayerView {
            player_id: player.player_id,
            seat_index,
            display_name: player.display_name.clone(),
            connected: false,
            disconnect_deadline_unix_ms: None,
            forfeited_this_round: false,
            guess_count: 0,
            score: 0,
        };
        self.players
            .insert(player.player_id, participant_from(player, seat_index));
        let seq = self.next_seq();
        self.broadcast(ServerMessage::PlayerJoined { seq, player: view });
        Ok(self.players.len() >= usize::from(self.max_players))
    }

    fn cancel_match(&mut self, session_token: &str) -> Result<CancelledMatch, AppError> {
        if self.kind != RoomKind::Quick {
            return Err(AppError::BadRequest(
                "only a quick match can be left".to_owned(),
            ));
        }
        self.leave_player(session_token, true)
    }

    fn leave_friend_room(&mut self, session_token: &str) -> Result<CancelledMatch, AppError> {
        if self.kind != RoomKind::Friend {
            return Err(AppError::BadRequest(
                "only a friend room can be left".to_owned(),
            ));
        }
        self.leave_player(session_token, false)
    }

    fn leave_player(
        &mut self,
        session_token: &str,
        allow_requeue: bool,
    ) -> Result<CancelledMatch, AppError> {
        let token_hash = hash_token(session_token);
        let player_id = self
            .players
            .values()
            .find(|player| bool::from(player.token_hash.ct_eq(&token_hash)))
            .map(|player| player.player_id)
            .ok_or(AppError::Unauthorized)?;
        self.fail_rematch_for_disconnect(player_id);
        let was_waiting = self.phase == Phase::Waiting;
        let was_playing = self.phase == Phase::Playing;
        let mut final_standings = (!was_waiting).then(|| {
            let mut standings = self
                .players
                .values()
                .map(|player| SeriesStandingView {
                    player_id: player.player_id,
                    display_name: player.display_name.clone(),
                    seat_index: player.seat_index,
                    score: player.score,
                    left_series: player.player_id == player_id,
                })
                .collect::<Vec<_>>();
            standings.sort_by_key(|player| player.seat_index);
            standings
        });
        let seq = self.next_seq();
        self.broadcast_except(
            player_id,
            ServerMessage::PlayerConnection {
                seq,
                player_id,
                connected: false,
                disconnect_deadline_unix_ms: None,
            },
        );
        let departed_player = self.players.remove(&player_id);
        if self.host_player_id == player_id {
            let next_host = if self.kind == RoomKind::Friend {
                self.active_replacement_host()
            } else {
                self.players
                    .values()
                    .min_by_key(|player| player.seat_index)
                    .map(|player| player.player_id)
            };
            if let Some(next_host) = next_host {
                self.host_player_id = next_host;
            } else {
                self.players.clear();
                self.closed = true;
            }
        }
        let remaining_players = self.players.len() as u32;
        self.closed = self.closed || remaining_players == 0;
        if !was_waiting && !self.closed && self.series_status == SeriesStatus::Active {
            self.phase = Phase::Finished;
            self.finish_reason = Some(if allow_requeue {
                FinishReason::DisconnectForfeit
            } else {
                FinishReason::MemberLeft
            });
            self.deadline = None;
            self.deadline_unix_ms = None;
            self.next_round_at = None;
            self.next_round_unix_ms = None;
            let wins_needed = self.best_of / 2 + 1;
            if self.max_players == 2
                && remaining_players == 1
                && let Some(winner) = self.players.keys().next().copied()
            {
                self.winner_player_id = Some(winner);
                self.series_winner_player_id = Some(winner);
                self.series_status = SeriesStatus::Completed;
                self.series_finish_reason = Some(SeriesFinishReason::MemberLeftForfeit);
                if let Some(player) = self.players.get_mut(&winner) {
                    player.score = wins_needed;
                }
                if let Some(standings) = final_standings.as_mut()
                    && let Some(entry) =
                        standings.iter_mut().find(|entry| entry.player_id == winner)
                {
                    entry.score = wins_needed;
                }
            } else {
                self.winner_player_id = None;
                self.series_winner_player_id = None;
                self.series_status = SeriesStatus::Abandoned;
                self.series_finish_reason = Some(SeriesFinishReason::MemberLeftAbandoned);
            }
            self.series_final_standings = final_standings;
            if was_playing {
                self.record_departure_round_result();
                self.settle_round_profiles(departed_player.as_ref());
            }
            self.set_telemetry_active(false);
            self.broadcast_round_finished();
        }
        if !self.closed {
            self.broadcast_snapshots();
        }
        Ok(CancelledMatch {
            remaining_players,
            visibility: self.visibility,
            difficulty: self.difficulty,
            best_of: self.best_of,
            party_size: self.max_players,
            closed: self.closed,
            requeue: allow_requeue && was_waiting && !self.closed,
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
            player.disconnect_deadline_unix_ms = None;
        }

        let seq = self.next_seq();
        let snapshot = self.snapshot_for(player_id);
        self.send_to(
            player_id,
            ServerMessage::Snapshot {
                seq,
                snapshot: Box::new(snapshot),
            },
        );
        let seq = self.next_seq();
        self.broadcast_except(
            player_id,
            ServerMessage::PlayerConnection {
                seq,
                player_id,
                connected: true,
                disconnect_deadline_unix_ms: None,
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
            player.disconnect_deadline_unix_ms =
                Some(unix_ms() + self.config.disconnect_forfeit.as_millis() as u64);
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
                    disconnect_deadline_unix_ms: self
                        .players
                        .get(&player_id)
                        .and_then(|player| player.disconnect_deadline_unix_ms),
                },
            );
            if self.fail_rematch_for_disconnect(player_id) {
                self.broadcast_snapshots();
            }
        }
    }

    fn fail_rematch_for_disconnect(&mut self, player_id: Uuid) -> bool {
        let should_fail = self.rematch.as_ref().is_some_and(|invitation| {
            matches!(
                invitation.status,
                RematchStatus::Pending | RematchStatus::Starting
            ) && invitation.responses.contains_key(&player_id)
        });
        if !should_fail {
            return false;
        }
        if let Some(invitation) = self.rematch.as_mut() {
            invitation.status = RematchStatus::OpponentOffline;
            invitation.transition_at = None;
            invitation.clear_at = Some(Instant::now() + self.config.rematch_terminal_retention);
        }
        true
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
                if player_id != self.host_player_id
                    || self.kind != RoomKind::Friend
                    || self.phase != Phase::Waiting
                {
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
                    < usize::from(self.max_players)
                {
                    self.error(
                        player_id,
                        Some(request_id),
                        "not_ready",
                        "all room seats must be connected before starting",
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
            ClientMessage::RestartSeries { request_id } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                if self.kind != RoomKind::Friend || player_id != self.host_player_id {
                    self.error(
                        player_id,
                        Some(request_id),
                        "forbidden",
                        "only the friend-room host may restart the series",
                    );
                } else if self.phase != Phase::Finished
                    || self.series_status == SeriesStatus::Active
                {
                    self.error(
                        player_id,
                        Some(request_id),
                        "series_not_finished",
                        "the series is not ready to restart",
                    );
                } else {
                    self.mark_seen(player_id, request_id);
                    self.restart_series();
                    self.ack(player_id, request_id);
                }
            }
            ClientMessage::RequestRematch { request_id } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                self.request_rematch(player_id, request_id);
            }
            ClientMessage::RespondRematch {
                request_id,
                invitation_id,
                accept,
            } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                self.respond_rematch(player_id, request_id, invitation_id, accept);
            }
            ClientMessage::CancelRematch {
                request_id,
                invitation_id,
            } => {
                if self.is_duplicate(player_id, request_id) {
                    self.ack(player_id, request_id);
                    return;
                }
                self.cancel_rematch(player_id, request_id, invitation_id);
            }
            ClientMessage::Guess {
                request_id,
                player_id: guessed_player_id,
            } => self.guess(player_id, request_id, guessed_player_id),
        }
    }

    fn request_rematch(&mut self, player_id: Uuid, request_id: Uuid) {
        if self.kind != RoomKind::Quick {
            self.error(
                player_id,
                Some(request_id),
                "forbidden",
                "rematch invitations are only available in quick matches",
            );
            return;
        }
        if self.phase != Phase::Finished || self.series_status == SeriesStatus::Active {
            self.error(
                player_id,
                Some(request_id),
                "series_not_finished",
                "the series is not ready for a rematch",
            );
            return;
        }
        if self.rematch.is_some() {
            self.error(
                player_id,
                Some(request_id),
                "rematch_pending",
                "a rematch invitation is already active",
            );
            return;
        }

        self.mark_seen(player_id, request_id);
        let now = Instant::now();
        let expires_at = now + self.config.rematch_invite_timeout;
        let expires_at_unix_ms = unix_ms() + self.config.rematch_invite_timeout.as_millis() as u64;
        let all_opponents_connected = self.players.len() == usize::from(self.max_players)
            && self.players.values().all(|player| {
                player.player_id == player_id
                    || (player.outbound.is_some() && player.disconnected_at.is_none())
            });
        let responses = self
            .players
            .keys()
            .map(|candidate| {
                (
                    *candidate,
                    if *candidate == player_id {
                        RematchDecision::Accepted
                    } else {
                        RematchDecision::Pending
                    },
                )
            })
            .collect();
        self.rematch = Some(RematchInvitation {
            invitation_id: Uuid::new_v4(),
            requester_player_id: player_id,
            status: if all_opponents_connected {
                RematchStatus::Pending
            } else {
                RematchStatus::OpponentOffline
            },
            expires_at,
            expires_at_unix_ms,
            responses,
            transition_at: None,
            clear_at: (!all_opponents_connected)
                .then(|| now + self.config.rematch_terminal_retention),
        });
        self.broadcast_snapshots();
        self.ack(player_id, request_id);
    }

    fn respond_rematch(
        &mut self,
        player_id: Uuid,
        request_id: Uuid,
        invitation_id: Uuid,
        accept: bool,
    ) {
        let valid = self.rematch.as_ref().is_some_and(|invitation| {
            invitation.invitation_id == invitation_id
                && invitation.status == RematchStatus::Pending
                && invitation.requester_player_id != player_id
                && invitation.responses.contains_key(&player_id)
        });
        if !valid {
            self.error(
                player_id,
                Some(request_id),
                "rematch_not_pending",
                "the rematch invitation is no longer awaiting this response",
            );
            return;
        }

        self.mark_seen(player_id, request_id);
        let now = Instant::now();
        if let Some(invitation) = self.rematch.as_mut() {
            invitation.responses.insert(
                player_id,
                if accept {
                    RematchDecision::Accepted
                } else {
                    RematchDecision::Declined
                },
            );
            if !accept {
                invitation.status = RematchStatus::Declined;
                invitation.clear_at = Some(now + self.config.rematch_terminal_retention);
            } else if invitation
                .responses
                .values()
                .all(|decision| *decision == RematchDecision::Accepted)
            {
                invitation.status = RematchStatus::Starting;
                invitation.transition_at = Some(now + self.config.rematch_start_transition);
            }
        }
        let start = self.rematch.as_ref().and_then(|invitation| {
            (invitation.status == RematchStatus::Starting).then_some(invitation.invitation_id)
        });
        if let Some(invitation_id) = start {
            let command_tx = self.command_tx.clone();
            let delay = self.config.rematch_start_transition;
            tokio::spawn(async move {
                tokio::time::sleep(delay).await;
                let _ = command_tx
                    .send(RoomCommand::FinalizeRematch { invitation_id })
                    .await;
            });
        }
        self.broadcast_snapshots();
        self.ack(player_id, request_id);
    }

    fn finalize_rematch(&mut self, invitation_id: Uuid) {
        let valid = self.rematch.as_ref().is_some_and(|invitation| {
            invitation.invitation_id == invitation_id
                && invitation.status == RematchStatus::Starting
        });
        if !valid {
            return;
        }
        let ready = self.players.len() == usize::from(self.max_players)
            && self
                .players
                .values()
                .all(|player| player.outbound.is_some() && player.disconnected_at.is_none());
        if ready {
            self.rematch = None;
            self.restart_series();
            self.start_round();
        } else {
            if let Some(invitation) = self.rematch.as_mut() {
                invitation.status = RematchStatus::OpponentOffline;
                invitation.transition_at = None;
                invitation.clear_at = Some(Instant::now() + self.config.rematch_terminal_retention);
            }
            self.broadcast_snapshots();
        }
    }

    fn cancel_rematch(&mut self, player_id: Uuid, request_id: Uuid, invitation_id: Uuid) {
        let valid = self.rematch.as_ref().is_some_and(|invitation| {
            invitation.invitation_id == invitation_id
                && invitation.requester_player_id == player_id
                && invitation.status == RematchStatus::Pending
        });
        if !valid {
            self.error(
                player_id,
                Some(request_id),
                "rematch_not_pending",
                "the rematch invitation can no longer be cancelled",
            );
            return;
        }

        self.mark_seen(player_id, request_id);
        if let Some(invitation) = self.rematch.as_mut() {
            invitation.status = RematchStatus::Cancelled;
            invitation.clear_at = Some(Instant::now() + self.config.rematch_terminal_retention);
        }
        self.broadcast_snapshots();
        self.ack(player_id, request_id);
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
        let max_guesses = self.difficulty.max_guesses();
        if participant.guesses.len() >= max_guesses {
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
        let team_relation_value = team_relation(guess_player, target);
        let country = country_hint(guess_player, target);
        let correct = guess_player.id == target.id;
        participant.guesses.push(guessed_player_id.clone());
        let guess_number = participant.guesses.len();
        let seq = self.next_seq();
        let cached = CachedGuess {
            seq,
            player_id: guessed_player_id,
            guess_number,
            matched_fields,
            team_relation: team_relation_value,
            country_relation: country.relation,
            country_distance_km: country.distance_km,
            correct,
        };
        self.players
            .get_mut(&actor_id)
            .expect("the participant was validated above")
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
                team_relation: cached.team_relation,
                country_relation: cached.country_relation,
                country_distance_km: (visibility == Visibility::Open)
                    .then_some(cached.country_distance_km)
                    .flatten(),
                correct: cached.correct,
            },
        );

        if correct {
            self.finish_round(Some(actor_id), FinishReason::Solved);
        } else if self
            .players
            .values()
            .all(|player| player.forfeited_round || player.guesses.len() >= max_guesses)
        {
            self.finish_round(None, FinishReason::MaxGuesses);
        }
    }

    fn start_round(&mut self) {
        if self.phase == Phase::Playing || self.series_status != SeriesStatus::Active {
            return;
        }
        if self.phase == Phase::Finished {
            self.rotate_target();
            self.winner_player_id = None;
            self.finish_reason = None;
            self.series_final_standings = None;
            self.next_round_at = None;
            self.next_round_unix_ms = None;
            for player in self.players.values_mut() {
                player.guesses.clear();
                player.cached_guesses.clear();
                player.forfeited_round = false;
            }
        }
        self.phase = Phase::Playing;
        if self.kind == RoomKind::Quick {
            self.set_telemetry_active(true);
        }
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

    fn finish_round(&mut self, winner_player_id: Option<Uuid>, finish_reason: FinishReason) {
        if self.phase == Phase::Finished {
            return;
        }
        self.phase = Phase::Finished;
        self.winner_player_id = winner_player_id;
        self.finish_reason = Some(finish_reason);
        if let Some(winner) = winner_player_id
            && let Some(player) = self.players.get_mut(&winner)
        {
            player.score = player.score.saturating_add(1);
            let wins_needed = self.best_of / 2 + 1;
            if player.score >= wins_needed {
                self.series_winner_player_id = Some(winner);
                self.series_status = SeriesStatus::Completed;
                self.series_finish_reason = Some(SeriesFinishReason::ScoreLimit);
            }
        }
        self.record_round_result(finish_reason);
        self.settle_round_profiles(None);
        let terminal_friend_room =
            self.kind == RoomKind::Friend && self.series_status != SeriesStatus::Active;
        if terminal_friend_room {
            self.ensure_terminal_standings();
            self.evict_expired_friend_members(None);
        }
        self.deadline = None;
        self.deadline_unix_ms = None;
        if self.series_status == SeriesStatus::Active {
            let transition = self.config.round_transition;
            self.next_round_at = Some(Instant::now() + transition);
            self.next_round_unix_ms = Some(unix_ms() + transition.as_millis() as u64);
        } else {
            self.set_telemetry_active(false);
        }
        if !self.closed {
            self.broadcast_round_finished();
            if terminal_friend_room {
                self.broadcast_snapshots();
            }
        }
    }

    fn record_round_result(&mut self, finish_reason: FinishReason) {
        if self
            .round_results
            .last()
            .is_some_and(|result| result.round_number == self.round_number)
        {
            return;
        }
        let scores = self
            .players
            .values()
            .map(|player| player.score)
            .collect::<Vec<_>>();
        let mut standings = self
            .players
            .values()
            .map(|player| RoundStandingView {
                player_id: player.player_id,
                display_name: player.display_name.clone(),
                seat_index: player.seat_index,
                score: player.score,
                rank: 1 + scores.iter().filter(|score| **score > player.score).count() as u8,
                guess_count: player.guesses.len().min(usize::from(u8::MAX)) as u8,
            })
            .collect::<Vec<_>>();
        standings.sort_by_key(|player| player.seat_index);
        self.round_results.push(RoundResultView {
            round_number: self.round_number,
            mystery_id: self.target_id.to_owned(),
            finish_reason,
            winner_player_id: self.winner_player_id,
            standings,
        });
    }

    fn record_departure_round_result(&mut self) {
        if self
            .round_results
            .last()
            .is_some_and(|result| result.round_number == self.round_number)
        {
            return;
        }
        let Some(final_standings) = self.series_final_standings.as_ref() else {
            return;
        };
        let standings = final_standings
            .iter()
            .map(|player| RoundStandingView {
                player_id: player.player_id,
                display_name: player.display_name.clone(),
                seat_index: player.seat_index,
                score: player.score,
                rank: 1 + final_standings
                    .iter()
                    .filter(|other| other.score > player.score)
                    .count() as u8,
                guess_count: self
                    .players
                    .get(&player.player_id)
                    .map_or(0, |participant| {
                        participant.guesses.len().min(usize::from(u8::MAX)) as u8
                    }),
            })
            .collect();
        self.round_results.push(RoundResultView {
            round_number: self.round_number,
            mystery_id: self.target_id.to_owned(),
            finish_reason: FinishReason::MemberLeft,
            winner_player_id: self.winner_player_id,
            standings,
        });
    }

    fn settle_round_profiles(&self, departed_player: Option<&Participant>) {
        if self.round_number == 0 {
            return;
        }
        let mut participants = self.players.values().collect::<Vec<_>>();
        if let Some(departed_player) = departed_player {
            participants.push(departed_player);
        }
        for participant in &participants {
            let Some(profile_id) = participant.profile_id.clone() else {
                continue;
            };
            let result = match self.winner_player_id {
                Some(winner) if winner == participant.player_id => "win",
                Some(_) => "loss",
                None => "draw",
            };
            let opponent_names = participants
                .iter()
                .filter(|opponent| opponent.player_id != participant.player_id)
                .map(|opponent| opponent.display_name.clone())
                .collect();
            let opponent_score = participants
                .iter()
                .filter(|opponent| opponent.player_id != participant.player_id)
                .map(|opponent| opponent.score)
                .max()
                .unwrap_or(0);
            let settlement = AuthoritativeRoundSettlement {
                round_id: format!(
                    "{}:{}:R{}",
                    self.room_code, self.series_id, self.round_number
                ),
                result: result.to_owned(),
                details: Some(RoundRecordDetails {
                    mode: match self.kind {
                        RoomKind::Friend => "room",
                        RoomKind::Quick => "quick",
                    }
                    .to_owned(),
                    room_code: Some(self.room_code.clone()),
                    round_number: u32::from(self.round_number),
                    best_of: self.best_of,
                    answer_id: Some(self.target_id.to_owned()),
                    guess_ids: participant.guesses.clone(),
                    opponent_names,
                    self_score: u32::from(participant.score),
                    opponent_score: u32::from(opponent_score),
                }),
            };
            let Some(database) = self.database.clone() else {
                continue;
            };
            tokio::spawn(async move {
                if let Err(error) = database.settle_profile_round(&profile_id, settlement).await {
                    warn!(%error, %profile_id, "failed to settle realtime round profile");
                }
            });
        }
    }

    fn restart_series(&mut self) {
        // A terminal four-player series may still contain an expired disconnected
        // participant. Drop those seats so a replacement can join the waiting room.
        self.players.retain(|_, player| player.outbound.is_some());
        if !self.players.contains_key(&self.host_player_id)
            && let Some(next_host) = self
                .players
                .values()
                .min_by_key(|player| player.seat_index)
                .map(|player| player.player_id)
        {
            self.host_player_id = next_host;
        }
        self.phase = Phase::Waiting;
        self.round_number = 0;
        self.series_id = Uuid::new_v4();
        self.winner_player_id = None;
        self.series_winner_player_id = None;
        self.series_status = SeriesStatus::Active;
        self.series_finish_reason = None;
        self.series_final_standings = None;
        self.finish_reason = None;
        self.round_results.clear();
        self.deadline = None;
        self.deadline_unix_ms = None;
        self.next_round_at = None;
        self.next_round_unix_ms = None;
        self.rematch = None;
        self.rotate_target();
        for player in self.players.values_mut() {
            player.score = 0;
            player.guesses.clear();
            player.cached_guesses.clear();
            player.forfeited_round = false;
            player.disconnected_at = None;
            player.disconnect_deadline_unix_ms = None;
        }
        self.set_telemetry_active(false);

        let recipients = self.players.keys().copied().collect::<Vec<_>>();
        for player_id in recipients {
            let seq = self.next_seq();
            let snapshot = self.snapshot_for(player_id);
            self.send_to(
                player_id,
                ServerMessage::Snapshot {
                    seq,
                    snapshot: Box::new(snapshot),
                },
            );
        }
    }

    fn active_replacement_host(&self) -> Option<Uuid> {
        self.players
            .values()
            .filter(|player| {
                player.outbound.is_some()
                    && player.disconnected_at.is_none()
                    && !player.forfeited_round
            })
            .min_by_key(|player| player.seat_index)
            .map(|player| player.player_id)
    }

    fn ensure_terminal_standings(&mut self) {
        if self.series_final_standings.is_some() {
            return;
        }
        let mut standings = self
            .players
            .values()
            .map(|player| SeriesStandingView {
                player_id: player.player_id,
                display_name: player.display_name.clone(),
                seat_index: player.seat_index,
                score: player.score,
                left_series: player.forfeited_round,
            })
            .collect::<Vec<_>>();
        standings.sort_by_key(|player| player.seat_index);
        self.series_final_standings = Some(standings);
    }

    fn evict_expired_friend_members(&mut self, additionally_expired: Option<Uuid>) {
        if self.kind != RoomKind::Friend {
            return;
        }
        let mut expired = self
            .players
            .values()
            .filter(|player| player.forfeited_round)
            .map(|player| player.player_id)
            .collect::<HashSet<_>>();
        if let Some(player_id) = additionally_expired {
            expired.insert(player_id);
        }
        if expired.is_empty() {
            return;
        }
        if let Some(standings) = self.series_final_standings.as_mut() {
            for standing in standings {
                if expired.contains(&standing.player_id) {
                    standing.left_series = true;
                }
            }
        }
        self.players
            .retain(|player_id, _| !expired.contains(player_id));
        let next_host = self.active_replacement_host();
        if next_host.is_none() {
            self.players.clear();
            self.closed = true;
            return;
        }
        if !self.players.contains_key(&self.host_player_id)
            || expired.contains(&self.host_player_id)
        {
            self.host_player_id = next_host.expect("replacement host was checked");
        }
    }

    fn broadcast_snapshots(&mut self) {
        let recipients = self.players.keys().copied().collect::<Vec<_>>();
        for player_id in recipients {
            let seq = self.next_seq();
            let snapshot = self.snapshot_for(player_id);
            self.send_to(
                player_id,
                ServerMessage::Snapshot {
                    seq,
                    snapshot: Box::new(snapshot),
                },
            );
        }
    }

    fn rotate_target(&mut self) {
        let candidates = PLAYERS
            .iter()
            .filter(|player| match self.difficulty {
                Difficulty::Easy => player.major_wins > 0 || player.majors >= 5,
                Difficulty::Full => player.majors > 0,
                Difficulty::Hard => true,
            })
            .collect::<Vec<_>>();
        let old_target = self.target_id;
        let mut target_index = Uuid::new_v4().as_u128() as usize % candidates.len();
        if candidates.len() > 1 && candidates[target_index].id == old_target {
            target_index = (target_index + 1) % candidates.len();
        }
        self.target_id = candidates[target_index].id.as_str();
    }

    fn broadcast_round_finished(&mut self) {
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
            host_player_id: self.host_player_id,
            winner_player_id: self.winner_player_id,
            series_winner_player_id: self.series_winner_player_id,
            series_status: self.series_status,
            series_finish_reason: self.series_finish_reason,
            series_final_standings: self.series_final_standings.clone(),
            round_results: self.round_results.clone(),
            finish_reason: self.finish_reason.unwrap_or(FinishReason::MaxGuesses),
            scores,
            next_round_unix_ms: self.next_round_unix_ms,
            mystery_id,
        });
    }

    fn finish_series_after_disconnect(&mut self, missing_player_id: Uuid) {
        if self.series_status != SeriesStatus::Active {
            return;
        }
        let mut standings = self
            .players
            .values()
            .map(|player| SeriesStandingView {
                player_id: player.player_id,
                display_name: player.display_name.clone(),
                seat_index: player.seat_index,
                score: player.score,
                left_series: player.player_id == missing_player_id,
            })
            .collect::<Vec<_>>();
        standings.sort_by_key(|player| player.seat_index);

        self.next_round_at = None;
        self.next_round_unix_ms = None;
        self.finish_reason = Some(FinishReason::DisconnectForfeit);
        if self.max_players == 2
            && let Some(winner) = self
                .players
                .values()
                .find(|player| {
                    player.player_id != missing_player_id
                        && player.outbound.is_some()
                        && player.disconnected_at.is_none()
                        && !player.forfeited_round
                })
                .map(|player| player.player_id)
        {
            let wins_needed = self.best_of / 2 + 1;
            self.winner_player_id = Some(winner);
            self.series_winner_player_id = Some(winner);
            self.series_status = SeriesStatus::Completed;
            self.series_finish_reason = Some(SeriesFinishReason::MemberLeftForfeit);
            if let Some(player) = self.players.get_mut(&winner) {
                player.score = wins_needed;
            }
            if let Some(entry) = standings.iter_mut().find(|entry| entry.player_id == winner) {
                entry.score = wins_needed;
            }
        } else {
            self.winner_player_id = None;
            self.series_winner_player_id = None;
            self.series_status = SeriesStatus::Abandoned;
            self.series_finish_reason = Some(SeriesFinishReason::MemberLeftAbandoned);
        }
        self.series_final_standings = Some(standings);
        self.settle_round_profiles(None);
        self.evict_expired_friend_members(Some(missing_player_id));
        self.set_telemetry_active(false);
        if !self.closed {
            self.broadcast_round_finished();
            self.broadcast_snapshots();
        }
    }

    fn set_telemetry_active(&mut self, active: bool) {
        if self.telemetry_active == active {
            return;
        }
        self.telemetry_active = active;
        self.queue_telemetry.set_room_active(
            self.max_players,
            self.best_of,
            self.difficulty,
            self.visibility,
            active,
        );
    }

    fn maintain(&mut self) {
        let now = Instant::now();
        let rematch_action = self.rematch.as_ref().and_then(|invitation| {
            if invitation.status == RematchStatus::Pending && now >= invitation.expires_at {
                Some("expire")
            } else if invitation.status == RematchStatus::Starting
                && invitation
                    .transition_at
                    .is_some_and(|deadline| now >= deadline)
            {
                Some("start")
            } else if invitation.clear_at.is_some_and(|deadline| now >= deadline) {
                Some("clear")
            } else {
                None
            }
        });
        match rematch_action {
            Some("expire") => {
                if let Some(invitation) = self.rematch.as_mut() {
                    invitation.status = RematchStatus::Expired;
                    invitation.clear_at = Some(now + self.config.rematch_terminal_retention);
                }
                self.broadcast_snapshots();
            }
            Some("start") => {
                let ready = self.players.len() == usize::from(self.max_players)
                    && self.players.values().all(|player| {
                        player.outbound.is_some() && player.disconnected_at.is_none()
                    });
                if ready {
                    self.rematch = None;
                    self.restart_series();
                    self.start_round();
                } else {
                    if let Some(invitation) = self.rematch.as_mut() {
                        invitation.status = RematchStatus::OpponentOffline;
                        invitation.transition_at = None;
                        invitation.clear_at = Some(now + self.config.rematch_terminal_retention);
                    }
                    self.broadcast_snapshots();
                }
            }
            Some("clear") => {
                self.rematch = None;
                self.broadcast_snapshots();
            }
            _ => {}
        }

        if self.phase == Phase::Playing {
            let forfeit_after = self.config.disconnect_forfeit;
            let mut newly_forfeited = Vec::new();
            for player in self.players.values_mut() {
                if !player.forfeited_round
                    && player
                        .disconnected_at
                        .is_some_and(|instant| instant.elapsed() >= forfeit_after)
                {
                    player.forfeited_round = true;
                    player.disconnect_deadline_unix_ms = None;
                    newly_forfeited.push(player.player_id);
                }
            }
            for player_id in newly_forfeited {
                let seq = self.next_seq();
                self.broadcast(ServerMessage::PlayerRoundForfeited {
                    seq,
                    player_id,
                    round_number: self.round_number,
                });
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
                self.finish_round(
                    active_players.first().copied(),
                    FinishReason::DisconnectForfeit,
                );
            }
        }
        if self.phase == Phase::Playing
            && self
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.finish_round(None, FinishReason::Timeout);
        }
        if self.phase == Phase::Finished
            && self
                .next_round_at
                .is_some_and(|deadline| Instant::now() >= deadline)
            && self.players.len() == usize::from(self.max_players)
            && self
                .players
                .values()
                .all(|player| player.outbound.is_some() && player.disconnected_at.is_none())
        {
            self.start_round();
        }
        if self.phase == Phase::Finished && self.series_status == SeriesStatus::Active {
            let forfeit_after = self.config.disconnect_forfeit;
            if let Some(missing_player_id) = self.players.values().find_map(|player| {
                player
                    .disconnected_at
                    .is_some_and(|instant| instant.elapsed() >= forfeit_after)
                    .then_some(player.player_id)
            }) {
                self.finish_series_after_disconnect(missing_player_id);
            }
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
                    team_relation: team_relation(guessed, target),
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
                            team_relation: team_relation(guessed, target),
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
            difficulty: self.difficulty,
            phase: self.phase,
            self_player_id,
            host_player_id: self.host_player_id,
            max_players: self.max_players,
            max_guesses: self.difficulty.max_guesses(),
            best_of: self.best_of,
            round_number: self.round_number,
            deadline_unix_ms: self.deadline_unix_ms,
            next_round_unix_ms: self.next_round_unix_ms,
            players: {
                let mut players = self
                    .players
                    .values()
                    .map(|player| PlayerView {
                        player_id: player.player_id,
                        seat_index: player.seat_index,
                        display_name: player.display_name.clone(),
                        connected: player.outbound.is_some(),
                        disconnect_deadline_unix_ms: player.disconnect_deadline_unix_ms,
                        forfeited_this_round: player.forfeited_round,
                        guess_count: player.guesses.len(),
                        score: player.score,
                    })
                    .collect::<Vec<_>>();
                players.sort_by_key(|player| player.seat_index);
                players
            },
            own_guesses,
            opponent_progress,
            winner_player_id: self.winner_player_id,
            series_winner_player_id: self.series_winner_player_id,
            series_status: self.series_status,
            series_finish_reason: self.series_finish_reason,
            series_final_standings: self.series_final_standings.clone(),
            round_results: self.round_results.clone(),
            finish_reason: self.finish_reason,
            mystery_id: reveal.then(|| self.target_id.to_owned()),
            rematch: self.rematch_view(),
        }
    }

    fn rematch_view(&self) -> Option<RematchView> {
        let invitation = self.rematch.as_ref()?;
        let mut responses = self
            .players
            .values()
            .filter_map(|player| {
                invitation
                    .responses
                    .get(&player.player_id)
                    .copied()
                    .map(|decision| RematchResponseView {
                        player_id: player.player_id,
                        display_name: player.display_name.clone(),
                        decision,
                    })
            })
            .collect::<Vec<_>>();
        responses.sort_by_key(|response| {
            self.players
                .get(&response.player_id)
                .map(|player| player.seat_index)
                .unwrap_or(u8::MAX)
        });
        Some(RematchView {
            invitation_id: invitation.invitation_id,
            requester_player_id: invitation.requester_player_id,
            status: invitation.status,
            expires_at_unix_ms: invitation.expires_at_unix_ms,
            responses,
        })
    }

    fn send_guess_ack(&mut self, actor_id: Uuid, request_id: Uuid, cached: &CachedGuess) {
        self.send_to(
            actor_id,
            ServerMessage::GuessAccepted {
                // A Socket.IO acknowledgement can be lost after the command
                // has committed. Replaying the exact application event lets
                // the client recover without turning a transport retry into
                // a second room transition or a new event identity.
                seq: cached.seq,
                request_id,
                player_id: cached.player_id.clone(),
                guess_number: cached.guess_number,
                matched_fields: cached.matched_fields.clone(),
                team_relation: cached.team_relation,
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
        let disconnect_deadline = unix_ms() + self.config.disconnect_forfeit.as_millis() as u64;
        if let Some(player) = self.players.get_mut(&player_id)
            && let Some(outbound) = &player.outbound
            && outbound.try_send(message).is_err()
        {
            player.outbound = None;
            player.connection_id = None;
            player.disconnected_at = Some(Instant::now());
            player.disconnect_deadline_unix_ms = Some(disconnect_deadline);
            detached.push(player_id);
        }
        self.broadcast_detached(detached);
    }

    fn broadcast(&mut self, message: ServerMessage) {
        let message = Arc::new(message);
        let mut detached = Vec::new();
        let disconnect_deadline = unix_ms() + self.config.disconnect_forfeit.as_millis() as u64;
        for player in self.players.values_mut() {
            if let Some(outbound) = &player.outbound
                && outbound.try_send(Arc::clone(&message)).is_err()
            {
                player.outbound = None;
                player.connection_id = None;
                player.disconnected_at = Some(Instant::now());
                player.disconnect_deadline_unix_ms = Some(disconnect_deadline);
                detached.push(player.player_id);
            }
        }
        self.broadcast_detached(detached);
    }

    fn broadcast_except(&mut self, excluded: Uuid, message: ServerMessage) {
        let message = Arc::new(message);
        let mut detached = Vec::new();
        let disconnect_deadline = unix_ms() + self.config.disconnect_forfeit.as_millis() as u64;
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
                player.disconnect_deadline_unix_ms = Some(disconnect_deadline);
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
                disconnect_deadline_unix_ms: self
                    .players
                    .get(&player_id)
                    .and_then(|player| player.disconnect_deadline_unix_ms),
            });
            let disconnect_deadline = unix_ms() + self.config.disconnect_forfeit.as_millis() as u64;
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
                    player.disconnect_deadline_unix_ms = Some(disconnect_deadline);
                    pending.push(player.player_id);
                }
            }
        }
    }
}

fn participant_from(player: NewPlayer, seat_index: u8) -> Participant {
    Participant {
        player_id: player.player_id,
        seat_index,
        display_name: player.display_name,
        profile_id: player.profile_id,
        token_hash: hash_token(&player.session_token),
        outbound: None,
        connection_id: None,
        score: 0,
        guesses: Vec::new(),
        cached_guesses: HashMap::new(),
        seen_requests: HashSet::new(),
        disconnected_at: Some(Instant::now()),
        disconnect_deadline_unix_ms: None,
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
    #[serde(default)]
    historical_teams: Vec<String>,
    #[serde(rename = "countryCode")]
    country_code: String,
    age: u8,
    role: String,
    #[serde(rename = "majorAppearances")]
    majors: u16,
    #[serde(rename = "majorWins")]
    major_wins: u16,
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
    if guess.major_wins == target.major_wins {
        result.push("major_wins");
    }
    result
}

fn team_relation(guess: &CatalogPlayer, target: &CatalogPlayer) -> &'static str {
    if guess.team == target.team {
        return "match";
    }

    let guess_current = normalize_team_name(&guess.team);
    let target_current = normalize_team_name(&target.team);
    let guess_history = guess
        .historical_teams
        .iter()
        .filter_map(|team| normalize_team_name(team))
        .collect::<HashSet<_>>();
    let target_history = target
        .historical_teams
        .iter()
        .filter_map(|team| normalize_team_name(team))
        .collect::<HashSet<_>>();

    if guess_current
        .as_ref()
        .is_some_and(|team| target_history.contains(team))
    {
        return "target_history";
    }
    if target_current
        .as_ref()
        .is_some_and(|team| guess_history.contains(team))
    {
        return "guess_history";
    }
    if !guess_history.is_disjoint(&target_history) {
        return "shared_history";
    }
    "miss"
}

fn normalize_team_name(team: &str) -> Option<String> {
    let normalized = team.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized = normalized.to_lowercase();
    if matches!(
        normalized.as_str(),
        "" | "无队伍" | "undefined" | "null" | "none" | "n/a"
    ) {
        None
    } else {
        Some(normalized)
    }
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

    struct CompletedQuickRoom {
        room: RoomHandle,
        host: NewPlayer,
        guest: NewPlayer,
        host_connection: Uuid,
        guest_connection: Uuid,
        _host_rx: mpsc::Receiver<OutboundMessage>,
        _guest_rx: mpsc::Receiver<OutboundMessage>,
    }

    async fn completed_quick_room(room_code: &str, mut config: Config) -> CompletedQuickRoom {
        config.rematch_invite_timeout = Duration::from_secs(1);
        config.rematch_terminal_retention = Duration::from_secs(1);
        config.rematch_start_transition = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: room_code.to_owned(),
                kind: RoomKind::Quick,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, host_rx) = mpsc::channel(64);
        let (guest_tx, guest_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, guest_connection) = room
            .connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();
        timeout(Duration::from_secs(1), async {
            loop {
                if room.snapshot(host.player_id).await.unwrap().phase == Phase::Playing {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("quick room starts");
        let target_id = room.target_id().await.to_owned();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::Guess {
                request_id: Uuid::new_v4(),
                player_id: target_id,
            },
        )
        .await
        .unwrap();
        timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = room.snapshot(host.player_id).await.unwrap();
                if snapshot.phase == Phase::Finished
                    && snapshot.series_status == SeriesStatus::Completed
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("quick series completes");
        CompletedQuickRoom {
            room,
            host,
            guest,
            host_connection,
            guest_connection,
            _host_rx: host_rx,
            _guest_rx: guest_rx,
        }
    }

    #[test]
    fn comparison_only_returns_exact_fields() {
        let guess = CatalogPlayer {
            id: "guess".to_owned(),
            nickname: "Guess".to_owned(),
            team: "Shared Team".to_owned(),
            historical_teams: Vec::new(),
            country_code: "FR".to_owned(),
            age: 20,
            role: "AWPer".to_owned(),
            majors: 1,
            major_wins: 0,
        };
        let target = CatalogPlayer {
            id: "target".to_owned(),
            nickname: "Target".to_owned(),
            team: "Shared Team".to_owned(),
            historical_teams: Vec::new(),
            country_code: "DK".to_owned(),
            age: 21,
            role: "Rifler".to_owned(),
            majors: 2,
            major_wins: 0,
        };

        let result = matched_fields(&guess, &target);
        assert_eq!(result, vec!["team", "major_wins"]);
    }

    #[test]
    fn historical_team_relations_preserve_direction_and_exact_match_semantics() {
        let guess = CatalogPlayer {
            id: "guess".to_owned(),
            nickname: "Guess".to_owned(),
            team: "Falcons".to_owned(),
            historical_teams: vec!["Vitality".to_owned()],
            country_code: "FR".to_owned(),
            age: 20,
            role: "AWPer".to_owned(),
            majors: 1,
            major_wins: 0,
        };
        let target = CatalogPlayer {
            id: "target".to_owned(),
            nickname: "Target".to_owned(),
            team: "MOUZ".to_owned(),
            historical_teams: vec!["Vitality".to_owned()],
            country_code: "DK".to_owned(),
            age: 21,
            role: "Rifler".to_owned(),
            majors: 2,
            major_wins: 1,
        };

        assert_eq!(team_relation(&guess, &target), "shared_history");
        assert!(!matched_fields(&guess, &target).contains(&"team"));

        let guess_current_in_target_history = CatalogPlayer {
            historical_teams: vec!["Astralis".to_owned()],
            ..guess.clone()
        };
        let target_with_guess_current_history = CatalogPlayer {
            historical_teams: vec!["Falcons".to_owned(), "Vitality".to_owned()],
            ..target.clone()
        };
        assert_eq!(
            team_relation(
                &guess_current_in_target_history,
                &target_with_guess_current_history
            ),
            "target_history"
        );

        let guess_with_target_current_history = CatalogPlayer {
            historical_teams: vec!["MOUZ".to_owned(), "Vitality".to_owned()],
            ..guess
        };
        let target_without_direct_history = CatalogPlayer {
            historical_teams: vec!["NAVI".to_owned()],
            ..target
        };
        assert_eq!(
            team_relation(
                &guess_with_target_current_history,
                &target_without_direct_history
            ),
            "guess_history"
        );
    }

    #[test]
    fn country_hint_uses_normalized_codes_continents_and_capital_distance() {
        let guess = CatalogPlayer {
            id: "guess".to_owned(),
            nickname: "Guess".to_owned(),
            team: "A".to_owned(),
            historical_teams: Vec::new(),
            country_code: "FR".to_owned(),
            age: 20,
            role: "Rifler".to_owned(),
            majors: 1,
            major_wins: 0,
        };
        let target = CatalogPlayer {
            id: "target".to_owned(),
            nickname: "Target".to_owned(),
            team: "B".to_owned(),
            historical_teams: Vec::new(),
            country_code: "DE".to_owned(),
            age: 21,
            role: "AWPer".to_owned(),
            majors: 2,
            major_wins: 0,
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
        let participant = participant_from(first.clone(), 0);
        assert!(bool::from(
            participant
                .token_hash
                .ct_eq(&hash_token(&first.session_token))
        ));
    }

    #[tokio::test]
    async fn quick_rematch_restarts_only_after_every_opponent_accepts() {
        let fixture = completed_quick_room("CS-515151", Config::for_test()).await;
        fixture
            .room
            .client_message(
                fixture.host.player_id,
                fixture.host_connection,
                ClientMessage::RequestRematch {
                    request_id: Uuid::new_v4(),
                },
            )
            .await
            .unwrap();
        let invitation = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(invitation) = fixture
                    .room
                    .snapshot(fixture.guest.player_id)
                    .await
                    .unwrap()
                    .rematch
                {
                    break invitation;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("guest receives the invitation");
        assert_eq!(invitation.status, RematchStatus::Pending);
        assert_eq!(invitation.requester_player_id, fixture.host.player_id);

        fixture
            .room
            .client_message(
                fixture.guest.player_id,
                fixture.guest_connection,
                ClientMessage::RespondRematch {
                    request_id: Uuid::new_v4(),
                    invitation_id: invitation.invitation_id,
                    accept: true,
                },
            )
            .await
            .unwrap();
        timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = fixture.room.snapshot(fixture.host.player_id).await.unwrap();
                if snapshot.phase == Phase::Playing
                    && snapshot.series_status == SeriesStatus::Active
                    && snapshot.round_number == 1
                    && snapshot.rematch.is_none()
                    && snapshot.players.iter().all(|player| player.score == 0)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("accepted rematch starts a fresh series");
    }

    #[tokio::test]
    async fn quick_rematch_reports_decline_without_resetting_the_series() {
        let fixture = completed_quick_room("CS-525252", Config::for_test()).await;
        fixture
            .room
            .client_message(
                fixture.host.player_id,
                fixture.host_connection,
                ClientMessage::RequestRematch {
                    request_id: Uuid::new_v4(),
                },
            )
            .await
            .unwrap();
        let invitation = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(invitation) = fixture
                    .room
                    .snapshot(fixture.guest.player_id)
                    .await
                    .unwrap()
                    .rematch
                {
                    break invitation;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("guest receives the invitation");
        fixture
            .room
            .client_message(
                fixture.guest.player_id,
                fixture.guest_connection,
                ClientMessage::RespondRematch {
                    request_id: Uuid::new_v4(),
                    invitation_id: invitation.invitation_id,
                    accept: false,
                },
            )
            .await
            .unwrap();
        let declined = timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = fixture.room.snapshot(fixture.host.player_id).await.unwrap();
                if snapshot
                    .rematch
                    .as_ref()
                    .is_some_and(|rematch| rematch.status == RematchStatus::Declined)
                {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("requester sees the decline");
        assert_eq!(declined.phase, Phase::Finished);
        assert_eq!(declined.series_status, SeriesStatus::Completed);
    }

    #[tokio::test]
    async fn quick_rematch_reports_an_opponent_disconnect() {
        let fixture = completed_quick_room("CS-535353", Config::for_test()).await;
        fixture
            .room
            .client_message(
                fixture.host.player_id,
                fixture.host_connection,
                ClientMessage::RequestRematch {
                    request_id: Uuid::new_v4(),
                },
            )
            .await
            .unwrap();
        timeout(Duration::from_secs(1), async {
            loop {
                if fixture
                    .room
                    .snapshot(fixture.host.player_id)
                    .await
                    .unwrap()
                    .rematch
                    .is_some()
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("request is active");
        fixture
            .room
            .disconnect(fixture.guest.player_id, fixture.guest_connection)
            .await;
        timeout(Duration::from_secs(1), async {
            loop {
                if fixture
                    .room
                    .snapshot(fixture.host.player_id)
                    .await
                    .unwrap()
                    .rematch
                    .as_ref()
                    .is_some_and(|rematch| rematch.status == RematchStatus::OpponentOffline)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("requester sees the opponent offline state");
    }

    #[tokio::test]
    async fn friend_room_requires_every_configured_seat_before_starting() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-404040".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 4,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, mut host_rx) = mpsc::channel(32);
        let (second_tx, _second_rx) = mpsc::channel(32);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        room.connect(second.session_token, second_tx).await.unwrap();

        let rejected_request = Uuid::new_v4();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: rejected_request,
            },
        )
        .await
        .unwrap();

        let rejection = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::Error {
                        request_id,
                        code,
                        message,
                        ..
                    } = message.as_ref()
                    && *request_id == Some(rejected_request)
                {
                    break (*code, message.clone());
                }
            }
        })
        .await
        .expect("host receives the not-ready rejection");
        assert_eq!(rejection.0, "not_ready");
        assert_eq!(
            rejection.1,
            "all room seats must be connected before starting"
        );
        assert_eq!(
            room.snapshot(host.player_id).await.unwrap().phase,
            Phase::Waiting
        );

        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();
        let (third_tx, _third_rx) = mpsc::channel(32);
        let (fourth_tx, _fourth_rx) = mpsc::channel(32);
        room.connect(third.session_token, third_tx).await.unwrap();
        room.connect(fourth.session_token, fourth_tx).await.unwrap();

        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            room.snapshot(host.player_id).await.unwrap().phase,
            Phase::Playing
        );
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
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            shutdown,
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, mut host_rx) = mpsc::channel(16);
        let (guest_tx, mut guest_rx) = mpsc::channel(16);
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

        let progress_seq = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::OpponentProgress {
                        seq,
                        guessed_player_id,
                        ..
                    } = message.as_ref()
                {
                    break (*seq, guessed_player_id.clone());
                }
            }
        })
        .await
        .expect("host receives progress");
        assert_eq!(progress_seq.1, None);
        assert!(
            timeout(Duration::from_millis(50), async {
                loop {
                    if let Some(message) = host_rx.recv().await
                        && matches!(message.as_ref(), ServerMessage::OpponentProgress { .. })
                    {
                        break;
                    }
                }
            })
            .await
            .is_err(),
            "a retried request must not broadcast opponent progress twice"
        );

        let accepted_sequences = timeout(Duration::from_secs(1), async {
            let mut sequences = Vec::new();
            while sequences.len() < 2 {
                if let Some(message) = guest_rx.recv().await
                    && let ServerMessage::GuessAccepted {
                        seq, request_id, ..
                    } = message.as_ref()
                    && *request_id == guess_request_id
                {
                    sequences.push(*seq);
                }
            }
            sequences
        })
        .await
        .expect("the actor replays both guess acknowledgements");
        assert_eq!(
            accepted_sequences,
            vec![accepted_sequences[0], accepted_sequences[0]],
            "a transport retry must replay the original event identity"
        );
        assert!(
            accepted_sequences[0] < progress_seq.0,
            "the original guess acknowledgement precedes opponent progress"
        );

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
    async fn concurrent_guess_retries_commit_and_broadcast_once() {
        let shutdown = CancellationToken::new();
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-208208".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            shutdown,
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, mut host_rx) = mpsc::channel(16);
        let (guest_tx, mut guest_rx) = mpsc::channel(16);
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

        let request_id = Uuid::new_v4();
        let message = ClientMessage::Guess {
            request_id,
            player_id: "donk".to_owned(),
        };
        let (first, second) = tokio::join!(
            room.client_message(guest.player_id, guest_connection, message.clone()),
            room.client_message(guest.player_id, guest_connection, message),
        );
        first.unwrap();
        second.unwrap();

        let accepted_sequences = timeout(Duration::from_secs(1), async {
            let mut sequences = Vec::new();
            while sequences.len() < 2 {
                if let Some(message) = guest_rx.recv().await
                    && let ServerMessage::GuessAccepted {
                        seq,
                        request_id: event_request_id,
                        ..
                    } = message.as_ref()
                    && *event_request_id == request_id
                {
                    sequences.push(*seq);
                }
            }
            sequences
        })
        .await
        .expect("both concurrent deliveries receive the cached acknowledgement");
        assert_eq!(accepted_sequences[0], accepted_sequences[1]);

        let progress_count = timeout(Duration::from_millis(100), async {
            let mut count = 0;
            loop {
                match timeout(Duration::from_millis(25), host_rx.recv()).await {
                    Ok(Some(message))
                        if matches!(message.as_ref(), ServerMessage::OpponentProgress { .. }) =>
                    {
                        count += 1;
                    }
                    Ok(Some(_)) => {}
                    _ => break,
                }
            }
            count
        })
        .await
        .unwrap();
        assert_eq!(progress_count, 1);
        let snapshot = room.snapshot(guest.player_id).await.unwrap();
        assert_eq!(snapshot.own_guesses.len(), 1);
        assert_eq!(
            snapshot
                .players
                .iter()
                .find(|player| player.player_id == guest.player_id)
                .unwrap()
                .guess_count,
            1
        );
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
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(64);
        let (guest_tx, mut guest_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, guest_connection) = room
            .connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();

        for expected_score in 1..=2 {
            if expected_score == 1 {
                room.client_message(
                    host.player_id,
                    host_connection,
                    ClientMessage::StartRound {
                        request_id: Uuid::new_v4(),
                    },
                )
                .await
                .unwrap();
            } else {
                timeout(Duration::from_secs(2), async {
                    loop {
                        if room.snapshot(host.player_id).await.unwrap().phase == Phase::Playing {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                })
                .await
                .expect("friend room automatically starts its next round");
            }
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

            let finish_reason = timeout(Duration::from_secs(1), async {
                loop {
                    if let Some(message) = guest_rx.recv().await
                        && let ServerMessage::RoundFinished { finish_reason, .. } = message.as_ref()
                    {
                        break *finish_reason;
                    }
                }
            })
            .await
            .expect("guest receives the authoritative round finish reason");
            assert_eq!(finish_reason, FinishReason::Solved);

            let snapshot = room.snapshot(guest.player_id).await.unwrap();
            let score = snapshot
                .players
                .iter()
                .find(|player| player.player_id == guest.player_id)
                .unwrap()
                .score;
            assert_eq!(score, expected_score);
            assert_eq!(snapshot.round_number, expected_score);
            assert_eq!(snapshot.finish_reason, Some(FinishReason::Solved));
            if expected_score == 1 {
                assert_eq!(snapshot.series_winner_player_id, None);
            } else {
                assert_eq!(snapshot.series_winner_player_id, Some(guest.player_id));
            }
            assert_eq!(snapshot.round_results.len(), usize::from(expected_score));
            let latest = snapshot.round_results.last().unwrap();
            assert_eq!(latest.round_number, expected_score);
            assert_eq!(latest.finish_reason, FinishReason::Solved);
            assert_eq!(latest.winner_player_id, Some(guest.player_id));
            assert_eq!(latest.standings.len(), 2);
            assert_eq!(
                latest
                    .standings
                    .iter()
                    .find(|standing| standing.player_id == guest.player_id)
                    .map(|standing| (standing.score, standing.guess_count)),
                Some((expected_score, 1))
            );
        }
    }

    #[tokio::test]
    async fn bo_one_draw_keeps_the_series_active_and_schedules_a_tiebreak() {
        let mut config = Config::for_test();
        config.round_transition = Duration::from_secs(5);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-313131".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
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
        let misses = PLAYERS
            .iter()
            .filter(|player| player.id != target)
            .take(Difficulty::Hard.max_guesses())
            .map(|player| player.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(misses.len(), Difficulty::Hard.max_guesses());
        for miss in &misses {
            room.client_message(
                host.player_id,
                host_connection,
                ClientMessage::Guess {
                    request_id: Uuid::new_v4(),
                    player_id: miss.clone(),
                },
            )
            .await
            .unwrap();
            room.client_message(
                guest.player_id,
                guest_connection,
                ClientMessage::Guess {
                    request_id: Uuid::new_v4(),
                    player_id: miss.clone(),
                },
            )
            .await
            .unwrap();
        }

        let snapshot = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(snapshot.phase, Phase::Finished);
        assert_eq!(snapshot.series_status, SeriesStatus::Active);
        assert_eq!(snapshot.series_winner_player_id, None);
        assert_eq!(snapshot.winner_player_id, None);
        assert_eq!(snapshot.finish_reason, Some(FinishReason::MaxGuesses));
        assert!(snapshot.next_round_unix_ms.is_some());
        assert_eq!(snapshot.round_results.len(), 1);
        assert!(
            snapshot.round_results[0]
                .standings
                .iter()
                .all(|standing| standing.score == 0 && standing.rank == 1)
        );
    }

    #[tokio::test]
    async fn host_can_restart_a_completed_bo_five_without_recreating_the_room() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-353535".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 5,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
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

        for round in 1..=3 {
            if round == 1 {
                room.client_message(
                    host.player_id,
                    host_connection,
                    ClientMessage::StartRound {
                        request_id: Uuid::new_v4(),
                    },
                )
                .await
                .unwrap();
            } else {
                timeout(Duration::from_secs(2), async {
                    loop {
                        let snapshot = room.snapshot(host.player_id).await.unwrap();
                        if snapshot.phase == Phase::Playing && snapshot.round_number == round {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .expect("next BO5 round starts authoritatively");
            }
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
        }

        let completed = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(completed.series_status, SeriesStatus::Completed);
        assert_eq!(completed.round_results.len(), 3);
        assert_eq!(completed.round_number, 3);
        let completed_target = completed.mystery_id.clone().unwrap();

        room.client_message(
            guest.player_id,
            guest_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            room.snapshot(host.player_id).await.unwrap().series_status,
            SeriesStatus::Completed
        );

        let restart_request = Uuid::new_v4();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::RestartSeries {
                request_id: restart_request,
            },
        )
        .await
        .unwrap();
        // Retrying the same acknowledged command must remain harmless.
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::RestartSeries {
                request_id: restart_request,
            },
        )
        .await
        .unwrap();

        let restarted = room.snapshot(guest.player_id).await.unwrap();
        assert_eq!(restarted.phase, Phase::Waiting);
        assert_eq!(restarted.series_status, SeriesStatus::Active);
        assert_eq!(restarted.round_number, 0);
        assert!(restarted.round_results.is_empty());
        assert_eq!(restarted.series_winner_player_id, None);
        assert_eq!(restarted.finish_reason, None);
        assert_ne!(room.target_id().await, completed_target);
        assert!(
            restarted
                .players
                .iter()
                .all(|player| player.score == 0 && player.guess_count == 0)
        );
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
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
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
        room.disconnect(guest.player_id, guest_connection).await;
        let disconnected = room.snapshot(host.player_id).await.unwrap();
        let disconnect_deadline = disconnected
            .players
            .iter()
            .find(|player| player.player_id == guest.player_id)
            .and_then(|player| player.disconnect_deadline_unix_ms)
            .expect("disconnect snapshot carries an authoritative deadline");
        tokio::time::sleep(Duration::from_millis(5)).await;
        let refreshed = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(
            refreshed
                .players
                .iter()
                .find(|player| player.player_id == guest.player_id)
                .and_then(|player| player.disconnect_deadline_unix_ms),
            Some(disconnect_deadline)
        );

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
        assert_eq!(
            finished.finish_reason,
            Some(FinishReason::DisconnectForfeit)
        );
        let finish_reason = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::RoundFinished { finish_reason, .. } = message.as_ref()
                {
                    break *finish_reason;
                }
            }
        })
        .await
        .expect("winner receives the disconnect-forfeit finish reason");
        assert_eq!(finish_reason, FinishReason::DisconnectForfeit);
    }

    #[tokio::test]
    async fn reconnect_snapshot_keeps_current_round_forfeit_and_next_round_restores_eligibility() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-414141".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();

        let (host_tx, mut host_rx) = mpsc::channel(64);
        let (second_tx, second_rx) = mpsc::channel(64);
        let (third_tx, third_rx) = mpsc::channel(64);
        let (fourth_tx, fourth_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, second_connection) = room
            .connect(second.session_token.clone(), second_tx)
            .await
            .unwrap();
        room.connect(third.session_token.clone(), third_tx)
            .await
            .unwrap();
        room.connect(fourth.session_token.clone(), fourth_tx)
            .await
            .unwrap();
        // Keep every receiver alive so the bounded outbound channels remain connected.
        let _other_receivers = (second_rx, third_rx, fourth_rx);

        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        room.disconnect(second.player_id, second_connection).await;

        timeout(Duration::from_secs(3), async {
            loop {
                let snapshot = room.snapshot(host.player_id).await.unwrap();
                if snapshot
                    .players
                    .iter()
                    .find(|player| player.player_id == second.player_id)
                    .is_some_and(|player| player.forfeited_this_round)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("authoritative maintenance marks the disconnected player forfeited");

        let forfeit_event = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::PlayerRoundForfeited {
                        player_id,
                        round_number,
                        ..
                    } = message.as_ref()
                    && *player_id == second.player_id
                {
                    break *round_number;
                }
            }
        })
        .await
        .expect("remaining players receive the current-round eligibility change");
        assert_eq!(forfeit_event, 1);

        let (reconnect_tx, _reconnect_rx) = mpsc::channel(64);
        room.connect(second.session_token.clone(), reconnect_tx)
            .await
            .unwrap();
        let reconnected = room.snapshot(second.player_id).await.unwrap();
        let second_view = reconnected
            .players
            .iter()
            .find(|player| player.player_id == second.player_id)
            .unwrap();
        assert!(second_view.connected);
        assert!(second_view.forfeited_this_round);
        assert_eq!(second_view.disconnect_deadline_unix_ms, None);
        assert_eq!(reconnected.phase, Phase::Playing);

        let target = room.target_id().await;
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::Guess {
                request_id: Uuid::new_v4(),
                player_id: target.to_owned(),
            },
        )
        .await
        .unwrap();
        let next_round = timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = room.snapshot(second.player_id).await.unwrap();
                if snapshot.phase == Phase::Playing && snapshot.round_number == 2 {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("friend room automatically starts the next round");
        assert_eq!(next_round.phase, Phase::Playing);
        assert_eq!(next_round.round_number, 2);
        assert!(
            next_round
                .players
                .iter()
                .all(|player| !player.forfeited_this_round)
        );
    }

    #[tokio::test]
    async fn four_player_snapshot_seats_are_stable_across_refresh_and_reconnect() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-505505".to_owned(),
                kind: RoomKind::Quick,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Easy,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();
        let first_snapshot = room.snapshot(host.player_id).await.unwrap();
        let second_snapshot = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(
            first_snapshot
                .players
                .iter()
                .map(|player| player.seat_index)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
        assert_eq!(
            first_snapshot
                .players
                .iter()
                .map(|player| player.player_id)
                .collect::<Vec<_>>(),
            second_snapshot
                .players
                .iter()
                .map(|player| player.player_id)
                .collect::<Vec<_>>()
        );

        let (outbound, _receiver) = mpsc::channel(8);
        let (_, connection_id) = room
            .connect(third.session_token.clone(), outbound)
            .await
            .unwrap();
        room.disconnect(third.player_id, connection_id).await;
        let (outbound, _receiver) = mpsc::channel(8);
        room.connect(third.session_token, outbound).await.unwrap();
        let reconnected = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(
            reconnected
                .players
                .iter()
                .find(|player| player.player_id == third.player_id)
                .map(|player| player.seat_index),
            Some(2)
        );
        assert!(
            reconnected
                .players
                .iter()
                .any(|player| player.player_id == second.player_id)
        );
        assert!(
            reconnected
                .players
                .iter()
                .any(|player| player.player_id == fourth.player_id)
        );
    }

    #[tokio::test]
    async fn two_player_member_leave_awards_the_remaining_player_the_series() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-616161".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 5,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, mut host_rx) = mpsc::channel(32);
        let (guest_tx, _guest_rx) = mpsc::channel(32);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        room.connect(guest.session_token.clone(), guest_tx)
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

        room.leave_friend_room(guest.session_token).await.unwrap();
        let snapshot = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(snapshot.phase, Phase::Finished);
        assert_eq!(snapshot.winner_player_id, Some(host.player_id));
        assert_eq!(snapshot.series_winner_player_id, Some(host.player_id));
        assert_eq!(snapshot.series_status, SeriesStatus::Completed);
        assert_eq!(
            snapshot.series_finish_reason,
            Some(SeriesFinishReason::MemberLeftForfeit)
        );
        assert_eq!(snapshot.finish_reason, Some(FinishReason::MemberLeft));
        assert_eq!(snapshot.next_round_unix_ms, None);
        assert_eq!(
            snapshot
                .players
                .iter()
                .find(|player| player.player_id == host.player_id)
                .map(|player| player.score),
            Some(3)
        );
        let standings = snapshot.series_final_standings.unwrap();
        assert_eq!(standings.len(), 2);
        assert!(
            standings
                .iter()
                .any(|player| player.player_id == guest.player_id && player.left_series)
        );

        let event = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = host_rx.recv().await
                    && let ServerMessage::RoundFinished {
                        series_status,
                        series_finish_reason,
                        ..
                    } = message.as_ref()
                {
                    break (*series_status, *series_finish_reason);
                }
            }
        })
        .await
        .expect("remaining player receives the terminal series event");
        assert_eq!(event.0, SeriesStatus::Completed);
        assert_eq!(event.1, Some(SeriesFinishReason::MemberLeftForfeit));
    }

    #[tokio::test]
    async fn four_player_member_leave_abandons_without_choosing_a_tied_winner() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-626262".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                difficulty: Difficulty::Hard,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(32);
        let (second_tx, _second_rx) = mpsc::channel(32);
        let (third_tx, _third_rx) = mpsc::channel(32);
        let (fourth_tx, _fourth_rx) = mpsc::channel(32);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        room.connect(second.session_token.clone(), second_tx)
            .await
            .unwrap();
        room.connect(third.session_token.clone(), third_tx)
            .await
            .unwrap();
        room.connect(fourth.session_token.clone(), fourth_tx)
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

        room.leave_friend_room(third.session_token).await.unwrap();
        let snapshot = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(snapshot.phase, Phase::Finished);
        assert_eq!(snapshot.winner_player_id, None);
        assert_eq!(snapshot.series_winner_player_id, None);
        assert_eq!(snapshot.series_status, SeriesStatus::Abandoned);
        assert_eq!(
            snapshot.series_finish_reason,
            Some(SeriesFinishReason::MemberLeftAbandoned)
        );
        assert_eq!(snapshot.next_round_unix_ms, None);
        let standings = snapshot.series_final_standings.unwrap();
        assert_eq!(standings.len(), 4);
        assert!(
            standings
                .iter()
                .any(|player| player.player_id == third.player_id && player.left_series)
        );

        let restart_request = Uuid::new_v4();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::RestartSeries {
                request_id: restart_request,
            },
        )
        .await
        .unwrap();
        let restarted = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(restarted.phase, Phase::Waiting);
        assert_eq!(restarted.players.len(), 3);
        assert!(restarted.round_results.is_empty());
        let replacement = room.reserve_player("333ed2k".to_owned()).await.unwrap();
        let refilled = room.snapshot(host.player_id).await.unwrap();
        assert_eq!(refilled.players.len(), 4);
        assert_eq!(
            refilled
                .players
                .iter()
                .find(|player| player.player_id == replacement.player_id)
                .map(|player| player.seat_index),
            Some(2)
        );
    }

    #[tokio::test]
    async fn expired_friend_room_host_transfers_authority_and_cannot_rejoin() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-717171".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(64);
        let (guest_tx, mut guest_rx) = mpsc::channel(64);
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
        room.disconnect(host.player_id, host_connection).await;

        let terminal = timeout(Duration::from_secs(3), async {
            loop {
                let snapshot = room.snapshot(guest.player_id).await.unwrap();
                if snapshot.series_status == SeriesStatus::Completed {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("host expiry terminalizes the duel");
        assert_eq!(terminal.host_player_id, guest.player_id);
        assert_eq!(terminal.players.len(), 1);
        assert_eq!(terminal.series_winner_player_id, Some(guest.player_id));
        assert!(room.snapshot(host.player_id).await.is_err());
        let (late_host_tx, _late_host_rx) = mpsc::channel(8);
        assert!(
            room.connect(host.session_token.clone(), late_host_tx)
                .await
                .is_err()
        );

        let transferred_snapshot = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = guest_rx.recv().await
                    && let ServerMessage::Snapshot { snapshot, .. } = message.as_ref()
                    && snapshot.series_status == SeriesStatus::Completed
                {
                    break snapshot.clone();
                }
            }
        })
        .await
        .expect("remaining member receives the transferred host snapshot");
        assert_eq!(transferred_snapshot.host_player_id, guest.player_id);

        room.client_message(
            guest.player_id,
            guest_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        let restarted = room.snapshot(guest.player_id).await.unwrap();
        assert_eq!(restarted.phase, Phase::Waiting);
        assert_eq!(restarted.host_player_id, guest.player_id);
        assert_eq!(
            restarted
                .players
                .iter()
                .find(|player| player.player_id == guest.player_id)
                .map(|player| player.seat_index),
            Some(1)
        );
        let replacement = room.reserve_player("2high".to_owned()).await.unwrap();
        assert_eq!(
            room.snapshot(guest.player_id)
                .await
                .unwrap()
                .players
                .iter()
                .find(|player| player.player_id == replacement.player_id)
                .map(|player| player.seat_index),
            Some(0)
        );
    }

    #[tokio::test]
    async fn four_player_host_expiry_preserves_online_seats_for_refill() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-727272".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                difficulty: Difficulty::Hard,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(64);
        let (second_tx, _second_rx) = mpsc::channel(64);
        let (third_tx, _third_rx) = mpsc::channel(64);
        let (fourth_tx, _fourth_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, second_connection) = room
            .connect(second.session_token.clone(), second_tx)
            .await
            .unwrap();
        room.connect(third.session_token.clone(), third_tx)
            .await
            .unwrap();
        room.connect(fourth.session_token.clone(), fourth_tx)
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
        room.disconnect(host.player_id, host_connection).await;
        timeout(Duration::from_secs(3), async {
            loop {
                if room
                    .snapshot(second.player_id)
                    .await
                    .unwrap()
                    .players
                    .iter()
                    .find(|player| player.player_id == host.player_id)
                    .is_some_and(|player| player.forfeited_this_round)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("host reaches the authoritative expiry deadline");
        let target = room.target_id().await;
        room.client_message(
            second.player_id,
            second_connection,
            ClientMessage::Guess {
                request_id: Uuid::new_v4(),
                player_id: target.to_owned(),
            },
        )
        .await
        .unwrap();

        let abandoned = timeout(Duration::from_secs(3), async {
            loop {
                let snapshot = room.snapshot(second.player_id).await.unwrap();
                if snapshot.series_status == SeriesStatus::Abandoned {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("expired host abandons the active four-player series");
        assert_eq!(abandoned.host_player_id, second.player_id);
        assert_eq!(
            abandoned
                .players
                .iter()
                .map(|player| player.seat_index)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(room.snapshot(host.player_id).await.is_err());

        room.client_message(
            second.player_id,
            second_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        let replacement = room.reserve_player("333ed2k".to_owned()).await.unwrap();
        let refilled = room.snapshot(second.player_id).await.unwrap();
        assert_eq!(refilled.phase, Phase::Waiting);
        assert_eq!(
            refilled
                .players
                .iter()
                .find(|player| player.player_id == replacement.player_id)
                .map(|player| player.seat_index),
            Some(0)
        );
        assert_eq!(
            refilled
                .players
                .iter()
                .filter(|player| player.player_id != replacement.player_id)
                .map(|player| player.seat_index)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[tokio::test]
    async fn explicit_host_leave_transfers_the_same_restart_authority() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-737373".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 5,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(32);
        let (guest_tx, _guest_rx) = mpsc::channel(32);
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
        room.leave_friend_room(host.session_token.clone())
            .await
            .unwrap();
        let terminal = room.snapshot(guest.player_id).await.unwrap();
        assert_eq!(terminal.host_player_id, guest.player_id);
        assert_eq!(terminal.series_status, SeriesStatus::Completed);
        assert!(room.snapshot(host.player_id).await.is_err());

        room.client_message(
            guest.player_id,
            guest_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            room.snapshot(guest.player_id).await.unwrap().phase,
            Phase::Waiting
        );
    }

    #[tokio::test]
    async fn explicit_four_player_host_leave_broadcasts_the_new_host_and_can_start_after_refill() {
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-767676".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Open,
                difficulty: Difficulty::Hard,
                max_players: 4,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let second = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let third = room.reserve_player("2high".to_owned()).await.unwrap();
        let fourth = room.reserve_player("2ssb".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(64);
        let (second_tx, mut second_rx) = mpsc::channel(64);
        let (third_tx, _third_rx) = mpsc::channel(64);
        let (fourth_tx, _fourth_rx) = mpsc::channel(64);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        let (_, second_connection) = room
            .connect(second.session_token.clone(), second_tx)
            .await
            .unwrap();
        room.connect(third.session_token.clone(), third_tx)
            .await
            .unwrap();
        room.connect(fourth.session_token.clone(), fourth_tx)
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
        room.leave_friend_room(host.session_token.clone())
            .await
            .unwrap();

        let (event_host, event_status, event_standings) = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = second_rx.recv().await
                    && let ServerMessage::RoundFinished {
                        host_player_id,
                        series_status,
                        series_final_standings,
                        ..
                    } = message.as_ref()
                {
                    break (
                        *host_player_id,
                        *series_status,
                        series_final_standings.clone().unwrap(),
                    );
                }
            }
        })
        .await
        .expect("new host receives the terminal round event");
        let final_snapshot = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(message) = second_rx.recv().await
                    && let ServerMessage::Snapshot { snapshot, .. } = message.as_ref()
                    && snapshot.series_status == SeriesStatus::Abandoned
                {
                    break snapshot.clone();
                }
            }
        })
        .await
        .expect("new host receives a matching terminal snapshot");
        assert_eq!(event_host, second.player_id);
        assert_eq!(event_status, SeriesStatus::Abandoned);
        assert_eq!(final_snapshot.host_player_id, event_host);
        assert_eq!(final_snapshot.series_status, event_status);
        let snapshot_standings = final_snapshot.series_final_standings.unwrap();
        assert_eq!(event_standings.len(), snapshot_standings.len());
        assert_eq!(
            event_standings
                .iter()
                .map(|standing| (standing.player_id, standing.score, standing.left_series))
                .collect::<Vec<_>>(),
            snapshot_standings
                .iter()
                .map(|standing| (standing.player_id, standing.score, standing.left_series))
                .collect::<Vec<_>>()
        );
        assert!(room.snapshot(host.player_id).await.is_err());
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            room.snapshot(second.player_id).await.unwrap().series_status,
            SeriesStatus::Abandoned
        );

        room.client_message(
            second.player_id,
            second_connection,
            ClientMessage::RestartSeries {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        let replacement = room.reserve_player("333ed2k".to_owned()).await.unwrap();
        let (replacement_tx, _replacement_rx) = mpsc::channel(32);
        room.connect(replacement.session_token, replacement_tx)
            .await
            .unwrap();
        room.client_message(
            second.player_id,
            second_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        let started = room.snapshot(second.player_id).await.unwrap();
        assert_eq!(started.phase, Phase::Playing);
        assert_eq!(started.host_player_id, second.player_id);
        assert_eq!(
            started
                .players
                .iter()
                .map(|player| player.seat_index)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
    }

    #[tokio::test]
    async fn explicit_host_leave_closes_when_every_remaining_member_is_offline() {
        for (index, max_players) in [2_u8, 4].into_iter().enumerate() {
            let host = NewPlayer::new("0samas".to_owned()).unwrap();
            let room = spawn_room(
                RoomSpec {
                    room_code: format!("CS-78{index}78{index}"),
                    kind: RoomKind::Friend,
                    visibility: Visibility::Hidden,
                    difficulty: Difficulty::Hard,
                    max_players,
                    best_of: 3,
                    host: host.clone(),
                    queue_telemetry: Arc::new(QueueTelemetry::new()),
                    database: None,
                },
                Config::for_test(),
                CancellationToken::new(),
            );
            let identity_ids = ["1nvisiblee", "2high", "2ssb"];
            let mut guests = Vec::new();
            for identity_id in identity_ids.iter().take(usize::from(max_players - 1)) {
                guests.push(
                    room.reserve_player((*identity_id).to_owned())
                        .await
                        .unwrap(),
                );
            }
            let (host_tx, _host_rx) = mpsc::channel(32);
            room.connect(host.session_token.clone(), host_tx)
                .await
                .unwrap();
            for guest in &guests {
                let (guest_tx, _guest_rx) = mpsc::channel(8);
                let (_, connection_id) = room
                    .connect(guest.session_token.clone(), guest_tx)
                    .await
                    .unwrap();
                room.disconnect(guest.player_id, connection_id).await;
            }

            let result = room
                .leave_friend_room(host.session_token.clone())
                .await
                .unwrap();
            assert!(result.closed);
            assert_eq!(result.remaining_players, 0);
            timeout(Duration::from_secs(1), async {
                while !room.is_closed() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("room actor closes instead of assigning an offline host");
        }
    }

    #[tokio::test]
    async fn host_reconnect_inside_the_grace_window_keeps_authority() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(250);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-797979".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 3,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(32);
        let (guest_tx, _guest_rx) = mpsc::channel(32);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        room.connect(guest.session_token, guest_tx).await.unwrap();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        room.disconnect(host.player_id, host_connection).await;
        tokio::time::sleep(Duration::from_millis(25)).await;
        let (reconnect_tx, _reconnect_rx) = mpsc::channel(32);
        room.connect(host.session_token, reconnect_tx)
            .await
            .unwrap();

        let snapshot = room.snapshot(guest.player_id).await.unwrap();
        assert_eq!(snapshot.host_player_id, host.player_id);
        assert_eq!(snapshot.series_status, SeriesStatus::Active);
        assert!(
            snapshot
                .players
                .iter()
                .find(|player| player.player_id == host.player_id)
                .is_some_and(|player| player.connected && !player.forfeited_this_round)
        );
    }

    #[tokio::test]
    async fn a_friend_room_closes_when_no_online_member_can_take_authority() {
        let mut config = Config::for_test();
        config.disconnect_forfeit = Duration::from_millis(20);
        let host = NewPlayer::new("0samas".to_owned()).unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-747474".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            config,
            CancellationToken::new(),
        );
        let guest = room.reserve_player("1nvisiblee".to_owned()).await.unwrap();
        let (host_tx, _host_rx) = mpsc::channel(16);
        let (guest_tx, _guest_rx) = mpsc::channel(16);
        let (_, host_connection) = room.connect(host.session_token, host_tx).await.unwrap();
        let (_, guest_connection) = room.connect(guest.session_token, guest_tx).await.unwrap();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::StartRound {
                request_id: Uuid::new_v4(),
            },
        )
        .await
        .unwrap();
        room.disconnect(host.player_id, host_connection).await;
        room.disconnect(guest.player_id, guest_connection).await;

        timeout(Duration::from_secs(3), async {
            while !room.is_closed() {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("room actor closes after every member expires");

        let lone_host = NewPlayer::new("0samas".to_owned()).unwrap();
        let lone_room = spawn_room(
            RoomSpec {
                room_code: "CS-757575".to_owned(),
                kind: RoomKind::Friend,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: lone_host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: None,
            },
            Config::for_test(),
            CancellationToken::new(),
        );
        let result = lone_room
            .leave_friend_room(lone_host.session_token)
            .await
            .unwrap();
        assert!(result.closed);
        assert_eq!(result.remaining_players, 0);
    }

    #[tokio::test]
    async fn finished_realtime_round_settles_bound_profiles() {
        use crate::{daily::catalog_players, profile::CreateProfileRequest};

        let config = Config::for_test();
        let database = DatabaseStore::new(&config);
        database.initialize().await.unwrap();
        let identities = catalog_players()
            .iter()
            .filter(|player| (1..=4).contains(&player.major_appearances) && player.major_wins == 0)
            .take(2)
            .map(|player| player.id.clone())
            .collect::<Vec<_>>();
        let host_profile_id = "anonymous-realtime-host-0001";
        let guest_profile_id = "anonymous-realtime-guest-0001";
        let host_token = "realtime_host_sync_token_abcdefghijklmnopqrstuvwxyz";
        let guest_token = "realtime_guest_sync_token_abcdefghijklmnopqrstuvwxyz";
        database
            .create_profile(
                CreateProfileRequest {
                    anonymous_id: host_profile_id.to_owned(),
                    initial_player_id: identities[0].clone(),
                },
                host_token,
            )
            .await
            .unwrap();
        database
            .create_profile(
                CreateProfileRequest {
                    anonymous_id: guest_profile_id.to_owned(),
                    initial_player_id: identities[1].clone(),
                },
                guest_token,
            )
            .await
            .unwrap();

        let host =
            NewPlayer::new_with_profile(identities[0].clone(), Some(host_profile_id.to_owned()))
                .unwrap();
        let room = spawn_room(
            RoomSpec {
                room_code: "CS-858585".to_owned(),
                kind: RoomKind::Quick,
                visibility: Visibility::Hidden,
                difficulty: Difficulty::Hard,
                max_players: 2,
                best_of: 1,
                host: host.clone(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                database: Some(database.clone()),
            },
            config,
            CancellationToken::new(),
        );
        let (guest, _) = room
            .reserve_player_with_profile(identities[1].clone(), Some(guest_profile_id.to_owned()))
            .await
            .unwrap();
        let (host_tx, _host_rx) = mpsc::channel(16);
        let (guest_tx, _guest_rx) = mpsc::channel(16);
        let (_, host_connection) = room
            .connect(host.session_token.clone(), host_tx)
            .await
            .unwrap();
        room.connect(guest.session_token.clone(), guest_tx)
            .await
            .unwrap();
        let target_id = room.target_id().await.to_owned();
        room.client_message(
            host.player_id,
            host_connection,
            ClientMessage::Guess {
                request_id: Uuid::new_v4(),
                player_id: target_id,
            },
        )
        .await
        .unwrap();

        timeout(Duration::from_secs(2), async {
            loop {
                let host_profile = database
                    .load_profile(host_profile_id, host_token)
                    .await
                    .unwrap();
                let guest_profile = database
                    .load_profile(guest_profile_id, guest_token)
                    .await
                    .unwrap();
                if host_profile.stats.wins == 1 && guest_profile.stats.losses == 1 {
                    assert_eq!(host_profile.match_history[0].mode, "quick");
                    assert_eq!(guest_profile.match_history[0].mode, "quick");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("room actor settles both profiles");
    }
}
