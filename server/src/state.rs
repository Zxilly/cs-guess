use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use axum::body::Bytes;
use dashmap::{DashMap, mapref::entry::Entry};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    config::Config,
    daily::{CompleteDailyChallengeRequest, DailyChallenge, DailyChallengeAttempt},
    database::DatabaseStore,
    error::AppError,
    profile::{
        CreateProfileRequest, ProfileCompletionResponse, ProfileState, StartIdentityDrawRequest,
    },
    protocol::{
        Difficulty, DifficultyQueueCounts, QueueCounts, RoomKind, SessionResponse, Snapshot,
        Visibility,
    },
    room::{NewPlayer, RoomHandle, RoomSpec, spawn_room},
    solo::{CompleteSoloRoundRequest, CreateSoloRoundRequest, SoloRound},
};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    pub config: Config,
    rooms: DashMap<String, RoomHandle>,
    quick_queues: Mutex<HashMap<(u8, Visibility, u8, Difficulty), QuickQueue>>,
    quick_request_results: DashMap<String, QuickRequestRecord>,
    quick_request_locks: DashMap<String, Arc<Mutex<()>>>,
    queue_telemetry: Arc<QueueTelemetry>,
    session_limiter: Mutex<SessionRateLimiter>,
    websocket_permits: Arc<Semaphore>,
    ready: AtomicBool,
    pub shutdown: CancellationToken,
    database: DatabaseStore,
}

#[derive(Clone)]
struct QuickQueue {
    room_code: String,
    players: u32,
}

#[derive(Clone, PartialEq, Eq)]
struct QuickRequestFingerprint {
    identity_id: String,
    profile_id: Option<String>,
    visibility: Visibility,
    best_of: u8,
    party_size: u8,
    difficulty: Difficulty,
}

#[derive(Clone)]
struct QuickRequestRecord {
    fingerprint: QuickRequestFingerprint,
    response: SessionResponse,
    created_at: Instant,
}

pub(crate) struct QueueTelemetry {
    counts: StdMutex<QueueCounts>,
    sender: watch::Sender<Bytes>,
}

impl QueueTelemetry {
    pub(crate) fn new() -> Self {
        let counts = QueueCounts::default();
        let (sender, _) = watch::channel(encode_queue_counts(counts));
        Self {
            counts: StdMutex::new(counts),
            sender,
        }
    }

    fn current(&self) -> QueueCounts {
        *self
            .counts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn subscribe(&self) -> watch::Receiver<Bytes> {
        self.sender.subscribe()
    }

    fn publish_waiting(&self, mut waiting: QueueCounts) {
        let mut counts = self
            .counts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        waiting.playing_bo1 = counts.playing_bo1;
        waiting.playing_bo3 = counts.playing_bo3;
        waiting.playing_bo5 = counts.playing_bo5;
        waiting.playing_group_bo1 = counts.playing_group_bo1;
        waiting.playing_group_bo3 = counts.playing_group_bo3;
        waiting.playing_group_bo5 = counts.playing_group_bo5;
        waiting.playing_total = counts.playing_total;
        waiting.easy.copy_playing_from(counts.easy);
        waiting.full.copy_playing_from(counts.full);
        waiting.hard.copy_playing_from(counts.hard);
        if *counts == waiting {
            return;
        }
        *counts = waiting;
        self.sender.send_replace(encode_queue_counts(waiting));
    }

    pub(crate) fn set_room_active(
        &self,
        party_size: u8,
        best_of: u8,
        difficulty: Difficulty,
        visibility: Visibility,
        active: bool,
    ) {
        let mut counts = self
            .counts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let players = u32::from(party_size);
        let previous = *counts;
        let bucket = match (party_size, best_of) {
            (2, 1) => &mut counts.playing_bo1,
            (2, 3) => &mut counts.playing_bo3,
            (2, 5) => &mut counts.playing_bo5,
            (4, 1) => &mut counts.playing_group_bo1,
            (4, 3) => &mut counts.playing_group_bo3,
            (4, 5) => &mut counts.playing_group_bo5,
            _ => return,
        };
        if active {
            *bucket = bucket.saturating_add(players);
            counts.playing_total = counts.playing_total.saturating_add(players);
        } else {
            *bucket = bucket.saturating_sub(players);
            counts.playing_total = counts.playing_total.saturating_sub(players);
        }
        counts
            .difficulty_mut(difficulty)
            .set_room_active(party_size, best_of, visibility, active);
        if *counts != previous {
            self.sender.send_replace(encode_queue_counts(*counts));
        }
    }
}

impl QueueCounts {
    fn difficulty_mut(&mut self, difficulty: Difficulty) -> &mut DifficultyQueueCounts {
        match difficulty {
            Difficulty::Easy => &mut self.easy,
            Difficulty::Full => &mut self.full,
            Difficulty::Hard => &mut self.hard,
        }
    }
}

impl DifficultyQueueCounts {
    fn add_waiting(&mut self, party_size: u8, best_of: u8, visibility: Visibility, players: u32) {
        let bucket = match (party_size, best_of, visibility) {
            (2, 1, Visibility::Hidden) => &mut self.bo1_hidden,
            (2, 1, Visibility::Open) => &mut self.bo1_open,
            (2, 3, Visibility::Hidden) => &mut self.bo3_hidden,
            (2, 3, Visibility::Open) => &mut self.bo3_open,
            (2, 5, Visibility::Hidden) => &mut self.bo5_hidden,
            (2, 5, Visibility::Open) => &mut self.bo5_open,
            (4, 1, Visibility::Hidden) => &mut self.group_bo1_hidden,
            (4, 1, Visibility::Open) => &mut self.group_bo1_open,
            (4, 3, Visibility::Hidden) => &mut self.group_bo3_hidden,
            (4, 3, Visibility::Open) => &mut self.group_bo3_open,
            (4, 5, Visibility::Hidden) => &mut self.group_bo5_hidden,
            (4, 5, Visibility::Open) => &mut self.group_bo5_open,
            _ => return,
        };
        *bucket = bucket.saturating_add(players);
        self.total = self.total.saturating_add(players);
    }

    fn set_room_active(
        &mut self,
        party_size: u8,
        best_of: u8,
        visibility: Visibility,
        active: bool,
    ) {
        let players = u32::from(party_size);
        let bucket = match (party_size, best_of) {
            (2, 1) => &mut self.playing_bo1,
            (2, 3) => &mut self.playing_bo3,
            (2, 5) => &mut self.playing_bo5,
            (4, 1) => &mut self.playing_group_bo1,
            (4, 3) => &mut self.playing_group_bo3,
            (4, 5) => &mut self.playing_group_bo5,
            _ => return,
        };
        if active {
            *bucket = bucket.saturating_add(players);
            self.playing_total = self.playing_total.saturating_add(players);
        } else {
            *bucket = bucket.saturating_sub(players);
            self.playing_total = self.playing_total.saturating_sub(players);
        }
        let visibility_bucket = match (party_size, best_of, visibility) {
            (2, 1, Visibility::Hidden) => &mut self.playing_bo1_hidden,
            (2, 1, Visibility::Open) => &mut self.playing_bo1_open,
            (2, 3, Visibility::Hidden) => &mut self.playing_bo3_hidden,
            (2, 3, Visibility::Open) => &mut self.playing_bo3_open,
            (2, 5, Visibility::Hidden) => &mut self.playing_bo5_hidden,
            (2, 5, Visibility::Open) => &mut self.playing_bo5_open,
            (4, 1, Visibility::Hidden) => &mut self.playing_group_bo1_hidden,
            (4, 1, Visibility::Open) => &mut self.playing_group_bo1_open,
            (4, 3, Visibility::Hidden) => &mut self.playing_group_bo3_hidden,
            (4, 3, Visibility::Open) => &mut self.playing_group_bo3_open,
            (4, 5, Visibility::Hidden) => &mut self.playing_group_bo5_hidden,
            (4, 5, Visibility::Open) => &mut self.playing_group_bo5_open,
            _ => return,
        };
        if active {
            *visibility_bucket = visibility_bucket.saturating_add(players);
        } else {
            *visibility_bucket = visibility_bucket.saturating_sub(players);
        }
    }

    fn copy_playing_from(&mut self, current: Self) {
        self.playing_bo1 = current.playing_bo1;
        self.playing_bo1_hidden = current.playing_bo1_hidden;
        self.playing_bo1_open = current.playing_bo1_open;
        self.playing_bo3 = current.playing_bo3;
        self.playing_bo3_hidden = current.playing_bo3_hidden;
        self.playing_bo3_open = current.playing_bo3_open;
        self.playing_bo5 = current.playing_bo5;
        self.playing_bo5_hidden = current.playing_bo5_hidden;
        self.playing_bo5_open = current.playing_bo5_open;
        self.playing_group_bo1 = current.playing_group_bo1;
        self.playing_group_bo1_hidden = current.playing_group_bo1_hidden;
        self.playing_group_bo1_open = current.playing_group_bo1_open;
        self.playing_group_bo3 = current.playing_group_bo3;
        self.playing_group_bo3_hidden = current.playing_group_bo3_hidden;
        self.playing_group_bo3_open = current.playing_group_bo3_open;
        self.playing_group_bo5 = current.playing_group_bo5;
        self.playing_group_bo5_hidden = current.playing_group_bo5_hidden;
        self.playing_group_bo5_open = current.playing_group_bo5_open;
        self.playing_total = current.playing_total;
    }
}

fn encode_queue_counts(counts: QueueCounts) -> Bytes {
    Bytes::from(
        serde_json::to_vec(&serde_json::json!({
            "type": "queue_counts",
            "counts": counts,
        }))
        .expect("queue telemetry is always serializable"),
    )
}

struct SessionRateLimiter {
    tokens: f64,
    capacity: f64,
    refill_per_second: f64,
    last_refill: Instant,
}

impl SessionRateLimiter {
    fn new(capacity: usize, refill_per_second: usize) -> Self {
        Self {
            tokens: capacity as f64,
            capacity: capacity as f64,
            refill_per_second: refill_per_second as f64,
            last_refill: Instant::now(),
        }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens
            + now.duration_since(self.last_refill).as_secs_f64() * self.refill_per_second)
            .min(self.capacity);
        self.last_refill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let websocket_permits = Arc::new(Semaphore::new(config.max_websocket_connections));
        let session_limiter = Mutex::new(SessionRateLimiter::new(
            config.session_rate_capacity,
            config.session_rate_refill_per_second,
        ));
        let database = DatabaseStore::new(&config);
        Self {
            inner: Arc::new(Inner {
                config,
                rooms: DashMap::new(),
                quick_queues: Mutex::new(HashMap::new()),
                quick_request_results: DashMap::new(),
                quick_request_locks: DashMap::new(),
                queue_telemetry: Arc::new(QueueTelemetry::new()),
                session_limiter,
                websocket_permits,
                ready: AtomicBool::new(false),
                shutdown: CancellationToken::new(),
                database,
            }),
        }
    }

    pub fn config(&self) -> &Config {
        &self.inner.config
    }

    pub async fn initialize(&self) -> Result<(), AppError> {
        self.inner.database.initialize().await
    }

    pub async fn load_profile(
        &self,
        anonymous_id: &str,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        self.inner
            .database
            .load_profile(anonymous_id, sync_token)
            .await
    }

    pub async fn create_profile(
        &self,
        request: CreateProfileRequest,
        sync_token: &str,
    ) -> Result<(ProfileState, bool), AppError> {
        self.inner
            .database
            .create_profile(request, sync_token)
            .await
    }

    pub async fn start_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        request: StartIdentityDrawRequest,
    ) -> Result<ProfileState, AppError> {
        self.inner
            .database
            .start_identity_draw(anonymous_id, sync_token, request)
            .await
    }

    pub async fn adopt_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        winner_id: &str,
    ) -> Result<ProfileState, AppError> {
        self.inner
            .database
            .adopt_identity_draw(anonymous_id, sync_token, winner_id)
            .await
    }

    pub async fn discard_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        winner_id: &str,
    ) -> Result<ProfileState, AppError> {
        self.inner
            .database
            .discard_identity_draw(anonymous_id, sync_token, winner_id)
            .await
    }

    pub async fn current_daily_challenge(&self) -> Result<DailyChallenge, AppError> {
        self.inner.database.current_daily_challenge().await
    }

    pub async fn complete_daily_challenge(
        &self,
        sync_token: &str,
        request: CompleteDailyChallengeRequest,
    ) -> Result<ProfileCompletionResponse, AppError> {
        self.inner
            .database
            .load_profile(&request.anonymous_id, sync_token)
            .await?;
        let challenge = self.current_daily_challenge().await?;
        if request.timed_out {
            let deadline = self
                .inner
                .database
                .daily_attempt_deadline(&request.anonymous_id, &challenge.date)
                .await?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
                .unwrap_or(0);
            if now < deadline {
                return Err(AppError::BadRequest(
                    "daily challenge deadline has not elapsed".to_owned(),
                ));
            }
        }
        let round_id = format!("daily:{}", challenge.date);
        let settlement = challenge.settlement(request.guess_ids, request.timed_out)?;
        let profile = self
            .inner
            .database
            .settle_profile_round(&request.anonymous_id, settlement)
            .await?;
        Ok(profile.completion_response(&round_id))
    }

    pub async fn start_daily_challenge_attempt(
        &self,
        anonymous_id: &str,
        sync_token: &str,
    ) -> Result<(DailyChallengeAttempt, bool), AppError> {
        self.inner
            .database
            .start_daily_challenge_attempt(anonymous_id, sync_token)
            .await
    }

    pub async fn create_solo_round(
        &self,
        sync_token: &str,
        request: CreateSoloRoundRequest,
    ) -> Result<SoloRound, AppError> {
        self.inner
            .database
            .create_solo_round(&request.anonymous_id, sync_token, request.difficulty)
            .await
    }

    pub async fn load_solo_round(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        round_id: &str,
    ) -> Result<SoloRound, AppError> {
        self.inner
            .database
            .load_solo_round(anonymous_id, sync_token, round_id)
            .await
    }

    pub async fn complete_solo_round(
        &self,
        round_id: &str,
        sync_token: &str,
        request: CompleteSoloRoundRequest,
    ) -> Result<ProfileCompletionResponse, AppError> {
        let round = self
            .inner
            .database
            .load_solo_round(&request.anonymous_id, sync_token, round_id)
            .await?;
        let now_unix_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
            .unwrap_or(0);
        let settlement = round.settlement(request.guess_ids, request.timed_out, now_unix_ms)?;
        let profile = self
            .inner
            .database
            .settle_profile_round(&request.anonymous_id, settlement)
            .await?;
        Ok(profile.completion_response(round_id))
    }

    pub fn set_ready(&self, value: bool) {
        self.inner.ready.store(value, Ordering::Release);
    }

    pub fn is_ready(&self) -> bool {
        self.inner.ready.load(Ordering::Acquire) && !self.inner.shutdown.is_cancelled()
    }

    pub fn shutdown(&self) {
        self.set_ready(false);
        self.inner.shutdown.cancel();
    }

    pub fn queue_counts(&self) -> QueueCounts {
        self.inner.queue_telemetry.current()
    }

    pub fn subscribe_queue_counts(&self) -> watch::Receiver<Bytes> {
        self.inner.queue_telemetry.subscribe()
    }

    pub async fn admit_session_request(&self) -> Result<(), AppError> {
        if self.inner.session_limiter.lock().await.take() {
            Ok(())
        } else {
            Err(AppError::RateLimited)
        }
    }

    pub fn acquire_websocket(&self) -> Result<OwnedSemaphorePermit, AppError> {
        self.inner
            .websocket_permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::Capacity)
    }

    pub async fn create_friend_room(
        &self,
        identity_id: String,
        visibility: Visibility,
        max_players: u8,
        best_of: u8,
        difficulty: Difficulty,
    ) -> Result<SessionResponse, AppError> {
        self.create_friend_room_for_profile(
            identity_id,
            visibility,
            max_players,
            best_of,
            difficulty,
            None,
        )
        .await
    }

    pub async fn create_friend_room_for_profile(
        &self,
        identity_id: String,
        visibility: Visibility,
        max_players: u8,
        best_of: u8,
        difficulty: Difficulty,
        profile_id: Option<String>,
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_best_of(best_of)?;
        if !matches!(max_players, 2 | 4) {
            return Err(AppError::BadRequest(
                "max_players must be 2 or 4".to_owned(),
            ));
        }

        let (room_code, room, host) = self.create_room_entry(
            RoomKind::Friend,
            identity_id,
            visibility,
            max_players,
            best_of,
            difficulty,
            profile_id,
        )?;
        self.session_response(&room_code, &room, host).await
    }

    pub async fn join_room(
        &self,
        room_code: &str,
        identity_id: String,
    ) -> Result<SessionResponse, AppError> {
        self.join_room_for_profile(room_code, identity_id, None)
            .await
    }

    pub async fn join_room_for_profile(
        &self,
        room_code: &str,
        identity_id: String,
        profile_id: Option<String>,
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_room_code(room_code)?;
        let room = self.room(room_code).await?;
        let (player, _) = room
            .reserve_player_with_profile(identity_id, profile_id)
            .await?;
        self.session_response(room_code, &room, player).await
    }

    pub async fn leave_friend_room(
        &self,
        room_code: &str,
        session_token: String,
    ) -> Result<(), AppError> {
        validate_room_code(room_code)?;
        let room = self.room(room_code).await?;
        let left = room.leave_friend_room(session_token).await?;
        if left.closed {
            self.inner.rooms.remove(room_code);
        }
        Ok(())
    }

    pub async fn quick_match(
        &self,
        identity_id: String,
        client_request_id: Option<String>,
        visibility: Visibility,
        best_of: u8,
        party_size: u8,
        difficulty: Difficulty,
    ) -> Result<SessionResponse, AppError> {
        self.quick_match_for_profile(
            identity_id,
            client_request_id,
            visibility,
            best_of,
            party_size,
            difficulty,
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn quick_match_for_profile(
        &self,
        identity_id: String,
        client_request_id: Option<String>,
        visibility: Visibility,
        best_of: u8,
        party_size: u8,
        difficulty: Difficulty,
        profile_id: Option<String>,
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_best_of(best_of)?;
        validate_party_size(party_size)?;

        let Some(client_request_id) = client_request_id else {
            return self
                .quick_match_once(
                    identity_id,
                    visibility,
                    best_of,
                    party_size,
                    difficulty,
                    profile_id,
                )
                .await;
        };
        validate_client_request_id(&client_request_id)?;
        let fingerprint = QuickRequestFingerprint {
            identity_id: identity_id.clone(),
            profile_id: profile_id.clone(),
            visibility,
            best_of,
            party_size,
            difficulty,
        };
        if let Some(response) = self.cached_quick_response(&client_request_id, &fingerprint)? {
            return Ok(response);
        }

        let request_lock = self
            .inner
            .quick_request_locks
            .entry(client_request_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let request_guard = request_lock.lock().await;
        let result = async {
            if let Some(response) = self.cached_quick_response(&client_request_id, &fingerprint)? {
                return Ok(response);
            }
            let response = self
                .quick_match_once(
                    identity_id,
                    visibility,
                    best_of,
                    party_size,
                    difficulty,
                    profile_id,
                )
                .await?;
            self.prune_quick_request_results();
            self.inner.quick_request_results.insert(
                client_request_id.clone(),
                QuickRequestRecord {
                    fingerprint,
                    response: response.clone(),
                    created_at: Instant::now(),
                },
            );
            Ok(response)
        }
        .await;
        drop(request_guard);
        self.inner.quick_request_locks.remove(&client_request_id);
        result
    }

    fn cached_quick_response(
        &self,
        client_request_id: &str,
        fingerprint: &QuickRequestFingerprint,
    ) -> Result<Option<SessionResponse>, AppError> {
        let Some(record) = self.inner.quick_request_results.get(client_request_id) else {
            return Ok(None);
        };
        if record.created_at.elapsed() >= self.inner.config.quick_request_ttl {
            drop(record);
            self.inner.quick_request_results.remove(client_request_id);
            return Ok(None);
        }
        if &record.fingerprint != fingerprint {
            return Err(AppError::IdempotencyConflict);
        }
        Ok(Some(record.response.clone()))
    }

    fn prune_quick_request_results(&self) {
        let ttl = self.inner.config.quick_request_ttl;
        self.inner
            .quick_request_results
            .retain(|_, record| record.created_at.elapsed() < ttl);
        let capacity = self.inner.config.max_quick_request_results;
        while self.inner.quick_request_results.len() >= capacity {
            let oldest = self
                .inner
                .quick_request_results
                .iter()
                .min_by_key(|entry| entry.created_at)
                .map(|entry| entry.key().clone());
            let Some(oldest) = oldest else {
                break;
            };
            self.inner.quick_request_results.remove(&oldest);
        }
    }

    async fn quick_match_once(
        &self,
        identity_id: String,
        visibility: Visibility,
        best_of: u8,
        party_size: u8,
        difficulty: Difficulty,
        profile_id: Option<String>,
    ) -> Result<SessionResponse, AppError> {
        let queue_key = (best_of, visibility, party_size, difficulty);
        loop {
            let mut queues = self.inner.quick_queues.lock().await;
            let Some(queue) = queues.get(&queue_key).cloned() else {
                let (room_code, room, host) = self.create_room_entry(
                    RoomKind::Quick,
                    identity_id.clone(),
                    visibility,
                    party_size,
                    best_of,
                    difficulty,
                    profile_id.clone(),
                )?;
                queues.insert(
                    queue_key,
                    QuickQueue {
                        room_code: room_code.clone(),
                        players: 1,
                    },
                );
                self.publish_queue_counts(&queues);
                drop(queues);
                return self.session_response(&room_code, &room, host).await;
            };

            let reservation = match self.room(&queue.room_code).await {
                Ok(room) => room
                    .reserve_player_with_profile(identity_id.clone(), profile_id.clone())
                    .await
                    .map(|(player, ready)| (room, player, ready)),
                Err(error) => Err(error),
            };
            match reservation {
                Ok((room, player, room_ready)) => {
                    if let Some(current) = queues.get_mut(&queue_key)
                        && current.room_code == queue.room_code
                    {
                        current.players = current.players.saturating_add(1);
                    }
                    if room_ready {
                        queues.remove(&queue_key);
                    }
                    self.publish_queue_counts(&queues);
                    drop(queues);
                    if room_ready {
                        room.start_if_ready().await?;
                    }
                    return self.session_response(&queue.room_code, &room, player).await;
                }
                Err(_) => {
                    queues.retain(|_, queued| queued.room_code != queue.room_code);
                    self.publish_queue_counts(&queues);
                }
            }
        }
    }

    pub async fn room(&self, room_code: &str) -> Result<RoomHandle, AppError> {
        let room = self
            .inner
            .rooms
            .get(room_code)
            .map(|entry| entry.value().clone())
            .ok_or(AppError::RoomNotFound)?;
        if room.is_closed() {
            self.inner.rooms.remove(room_code);
            return Err(AppError::RoomNotFound);
        }
        Ok(room)
    }

    pub async fn cancel_quick_match(
        &self,
        room_code: &str,
        session_token: String,
    ) -> Result<(), AppError> {
        validate_room_code(room_code)?;
        let cancelled_session_token = session_token.clone();
        let room = self.room(room_code).await?;
        let cancelled = room.cancel_match(session_token).await?;
        let mut queues = self.inner.quick_queues.lock().await;
        queues.retain(|_, queue| queue.room_code != room_code);
        if cancelled.requeue {
            queues
                .entry((
                    cancelled.best_of,
                    cancelled.visibility,
                    cancelled.party_size,
                    cancelled.difficulty,
                ))
                .or_insert(QuickQueue {
                    room_code: room_code.to_owned(),
                    players: cancelled.remaining_players,
                });
        }
        self.publish_queue_counts(&queues);
        drop(queues);
        if cancelled.closed {
            self.inner.rooms.remove(room_code);
        }
        self.inner.quick_request_results.retain(|_, record| {
            record.response.room_code != room_code
                || record.response.session_token != cancelled_session_token
        });
        Ok(())
    }

    pub async fn cancel_quick_match_by_request_id(
        &self,
        client_request_id: &str,
    ) -> Result<(), AppError> {
        validate_client_request_id(client_request_id)?;
        let request_lock = self
            .inner
            .quick_request_locks
            .entry(client_request_id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let request_guard = request_lock.lock().await;
        let result = async {
            let Some(record) = self
                .inner
                .quick_request_results
                .get(client_request_id)
                .map(|entry| entry.clone())
            else {
                return Err(AppError::RoomNotFound);
            };
            if record.created_at.elapsed() >= self.inner.config.quick_request_ttl {
                self.inner.quick_request_results.remove(client_request_id);
                return Err(AppError::RoomNotFound);
            }
            self.cancel_quick_match(&record.response.room_code, record.response.session_token)
                .await?;
            self.inner.quick_request_results.remove(client_request_id);
            Ok(())
        }
        .await;
        drop(request_guard);
        self.inner.quick_request_locks.remove(client_request_id);
        result
    }

    #[cfg(test)]
    pub(crate) fn quick_request_result_count(&self) -> usize {
        self.inner.quick_request_results.len()
    }

    #[cfg(test)]
    pub(crate) fn quick_request_lock_count(&self) -> usize {
        self.inner.quick_request_locks.len()
    }

    fn publish_queue_counts(&self, queues: &HashMap<(u8, Visibility, u8, Difficulty), QuickQueue>) {
        let mut counts = QueueCounts::default();
        for ((best_of, visibility, party_size, difficulty), queue) in queues {
            let value = queue.players;
            counts.difficulty_mut(*difficulty).add_waiting(
                *party_size,
                *best_of,
                *visibility,
                value,
            );
            match (*party_size, *best_of) {
                (2, 1) => {
                    counts.bo1 += value;
                    match visibility {
                        Visibility::Hidden => counts.bo1_hidden += value,
                        Visibility::Open => counts.bo1_open += value,
                    }
                }
                (2, 3) => {
                    counts.bo3 += value;
                    match visibility {
                        Visibility::Hidden => counts.bo3_hidden += value,
                        Visibility::Open => counts.bo3_open += value,
                    }
                }
                (2, 5) => {
                    counts.bo5 += value;
                    match visibility {
                        Visibility::Hidden => counts.bo5_hidden += value,
                        Visibility::Open => counts.bo5_open += value,
                    }
                }
                (4, 1) => {
                    counts.group_bo1 += value;
                    match visibility {
                        Visibility::Hidden => counts.group_bo1_hidden += value,
                        Visibility::Open => counts.group_bo1_open += value,
                    }
                }
                (4, 3) => {
                    counts.group_bo3 += value;
                    match visibility {
                        Visibility::Hidden => counts.group_bo3_hidden += value,
                        Visibility::Open => counts.group_bo3_open += value,
                    }
                }
                (4, 5) => {
                    counts.group_bo5 += value;
                    match visibility {
                        Visibility::Hidden => counts.group_bo5_hidden += value,
                        Visibility::Open => counts.group_bo5_open += value,
                    }
                }
                _ => {}
            }
        }
        counts.group_total = counts.group_bo1 + counts.group_bo3 + counts.group_bo5;
        counts.total = counts.bo1 + counts.bo3 + counts.bo5 + counts.group_total;
        self.inner.queue_telemetry.publish_waiting(counts);
    }

    #[allow(clippy::too_many_arguments)]
    fn create_room_entry(
        &self,
        kind: RoomKind,
        identity_id: String,
        visibility: Visibility,
        max_players: u8,
        best_of: u8,
        difficulty: Difficulty,
        profile_id: Option<String>,
    ) -> Result<(String, RoomHandle, NewPlayer), AppError> {
        if self.inner.rooms.len() >= self.inner.config.max_rooms {
            self.inner.rooms.retain(|_, room| !room.is_closed());
            if self.inner.rooms.len() >= self.inner.config.max_rooms {
                return Err(AppError::Capacity);
            }
        }

        let host = NewPlayer::new_with_profile(identity_id, profile_id)?;
        let (room_code, room) = (0..64)
            .find_map(|_| {
                let suffix = Uuid::new_v4().as_u128() % 1_000_000;
                let code = format!("CS-{suffix:06}");
                let room = spawn_room(
                    RoomSpec {
                        room_code: code.clone(),
                        kind,
                        visibility,
                        difficulty,
                        max_players,
                        best_of,
                        host: host.clone(),
                        queue_telemetry: Arc::clone(&self.inner.queue_telemetry),
                        database: Some(self.inner.database.clone()),
                    },
                    self.inner.config.clone(),
                    self.inner.shutdown.child_token(),
                );
                match self.inner.rooms.entry(code.clone()) {
                    Entry::Vacant(entry) => {
                        entry.insert(room.clone());
                        Some((code, room))
                    }
                    Entry::Occupied(_) => None,
                }
            })
            .ok_or(AppError::Capacity)?;
        Ok((room_code, room, host))
    }

    async fn session_response(
        &self,
        room_code: &str,
        room: &RoomHandle,
        player: NewPlayer,
    ) -> Result<SessionResponse, AppError> {
        let snapshot: Snapshot = room.snapshot(player.player_id).await?;
        Ok(SessionResponse {
            room_code: room_code.to_owned(),
            player_id: player.player_id,
            session_token: player.session_token,
            // Kept for wire compatibility with older clients; this is now the
            // same-origin Socket.IO path, not a native WebSocket URL.
            socket_io_url: "/socket.io".to_owned(),
            snapshot,
        })
    }
}

pub fn validate_identity_id(value: &str) -> Result<(), AppError> {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if !(1..=96).contains(&count)
        || !trimmed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::BadRequest(
            "identity_id must be a valid player catalog ID".to_owned(),
        ));
    }
    Ok(())
}

fn validate_client_request_id(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::BadRequest(
            "client_request_id must contain 1 to 128 URL-safe characters".to_owned(),
        ));
    }
    Ok(())
}

pub fn validate_room_code(value: &str) -> Result<(), AppError> {
    let bytes = value.as_bytes();
    if bytes.len() != 9 || &bytes[..3] != b"CS-" || !bytes[3..].iter().all(u8::is_ascii_digit) {
        return Err(AppError::BadRequest(
            "room code must match CS-000000 through CS-999999".to_owned(),
        ));
    }
    Ok(())
}

pub fn validate_best_of(value: u8) -> Result<(), AppError> {
    if matches!(value, 1 | 3 | 5) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "best_of must be one of 1, 3, or 5".to_owned(),
        ))
    }
}

pub fn validate_party_size(value: u8) -> Result<(), AppError> {
    if matches!(value, 2 | 4) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "party_size must be either 2 or 4".to_owned(),
        ))
    }
}
