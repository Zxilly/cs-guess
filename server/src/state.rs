use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use dashmap::{DashMap, mapref::entry::Entry};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    config::Config,
    database::ProfileStore,
    error::AppError,
    profile::ProfileState,
    protocol::{QueueCounts, RoomKind, SessionResponse, Snapshot, Visibility},
    room::{NewPlayer, RoomHandle, RoomSpec, spawn_room},
};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    pub config: Config,
    rooms: DashMap<String, RoomHandle>,
    quick_queues: Mutex<HashMap<(u8, Visibility, u8), QuickQueue>>,
    queue_counts: watch::Sender<QueueCounts>,
    session_limiter: Mutex<SessionRateLimiter>,
    websocket_permits: Arc<Semaphore>,
    ready: AtomicBool,
    pub shutdown: CancellationToken,
    profiles: ProfileStore,
}

#[derive(Clone)]
struct QuickQueue {
    room_code: String,
    players: u32,
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
        let (queue_counts, _) = watch::channel(QueueCounts::default());
        let websocket_permits = Arc::new(Semaphore::new(config.max_websocket_connections));
        let session_limiter = Mutex::new(SessionRateLimiter::new(
            config.session_rate_capacity,
            config.session_rate_refill_per_second,
        ));
        let profiles = ProfileStore::new(&config);
        Self {
            inner: Arc::new(Inner {
                config,
                rooms: DashMap::new(),
                quick_queues: Mutex::new(HashMap::new()),
                queue_counts,
                session_limiter,
                websocket_permits,
                ready: AtomicBool::new(false),
                shutdown: CancellationToken::new(),
                profiles,
            }),
        }
    }

    pub fn config(&self) -> &Config {
        &self.inner.config
    }

    pub async fn initialize(&self) -> Result<(), AppError> {
        self.inner.profiles.initialize().await
    }

    pub async fn load_profile(
        &self,
        anonymous_id: &str,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        self.inner.profiles.load(anonymous_id, sync_token).await
    }

    pub async fn save_profile(
        &self,
        profile: ProfileState,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        self.inner.profiles.save(profile, sync_token).await
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
        *self.inner.queue_counts.borrow()
    }

    pub fn subscribe_queue_counts(&self) -> watch::Receiver<QueueCounts> {
        self.inner.queue_counts.subscribe()
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
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_best_of(best_of)?;
        if !(2..=8).contains(&max_players) {
            return Err(AppError::BadRequest(
                "max_players must be between 2 and 8".to_owned(),
            ));
        }

        let (room_code, room, host) = self.create_room_entry(
            RoomKind::Friend,
            identity_id,
            visibility,
            max_players,
            best_of,
        )?;
        self.session_response(&room_code, &room, host).await
    }

    pub async fn join_room(
        &self,
        room_code: &str,
        identity_id: String,
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_room_code(room_code)?;
        let room = self.room(room_code).await?;
        let player = room.reserve_player(identity_id).await?;
        self.session_response(room_code, &room, player).await
    }

    pub async fn quick_match(
        &self,
        identity_id: String,
        visibility: Visibility,
        best_of: u8,
        party_size: u8,
    ) -> Result<SessionResponse, AppError> {
        validate_identity_id(&identity_id)?;
        validate_best_of(best_of)?;
        validate_party_size(party_size)?;

        let queue_key = (best_of, visibility, party_size);
        loop {
            let mut queues = self.inner.quick_queues.lock().await;
            let Some(queue) = queues.get(&queue_key).cloned() else {
                let (room_code, room, host) = self.create_room_entry(
                    RoomKind::Quick,
                    identity_id.clone(),
                    visibility,
                    party_size,
                    best_of,
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
                    .reserve_player_with_status(identity_id.clone())
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
        let room = self.room(room_code).await?;
        let cancelled = room.cancel_match(session_token).await?;
        let mut queues = self.inner.quick_queues.lock().await;
        queues.retain(|_, queue| queue.room_code != room_code);
        if !cancelled.closed {
            queues
                .entry((
                    cancelled.best_of,
                    cancelled.visibility,
                    cancelled.party_size,
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
        Ok(())
    }

    fn publish_queue_counts(&self, queues: &HashMap<(u8, Visibility, u8), QuickQueue>) {
        let mut counts = QueueCounts::default();
        for ((best_of, visibility, party_size), queue) in queues {
            let value = queue.players;
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
        self.inner.queue_counts.send_replace(counts);
    }

    fn create_room_entry(
        &self,
        kind: RoomKind,
        identity_id: String,
        visibility: Visibility,
        max_players: u8,
        best_of: u8,
    ) -> Result<(String, RoomHandle, NewPlayer), AppError> {
        if self.inner.rooms.len() >= self.inner.config.max_rooms {
            self.inner.rooms.retain(|_, room| !room.is_closed());
            if self.inner.rooms.len() >= self.inner.config.max_rooms {
                return Err(AppError::Capacity);
            }
        }

        let host = NewPlayer::new(identity_id)?;
        let (room_code, room) = (0..64)
            .find_map(|_| {
                let suffix = Uuid::new_v4().as_u128() % 1_000_000;
                let code = format!("CS-{suffix:06}");
                let room = spawn_room(
                    RoomSpec {
                        room_code: code.clone(),
                        kind,
                        visibility,
                        max_players,
                        best_of,
                        host: host.clone(),
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
        let ws_base = self
            .inner
            .config
            .public_base_url
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        Ok(SessionResponse {
            room_code: room_code.to_owned(),
            player_id: player.player_id,
            session_token: player.session_token,
            websocket_url: format!("{ws_base}/v1/rooms/{room_code}/ws"),
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
