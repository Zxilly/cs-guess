use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const STANDARD_MAX_GUESSES: usize = 8;
pub const MAX_GUESSES: usize = 10;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    #[default]
    Hidden,
    Open,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    #[default]
    Easy,
    Full,
    Hard,
}

impl Difficulty {
    pub const fn max_guesses(self) -> usize {
        match self {
            Self::Easy | Self::Full => STANDARD_MAX_GUESSES,
            Self::Hard => MAX_GUESSES,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoomKind {
    Friend,
    Quick,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Waiting,
    Playing,
    Finished,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Solved,
    DisconnectForfeit,
    MemberLeft,
    Timeout,
    MaxGuesses,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SeriesStatus {
    #[default]
    Active,
    Completed,
    Abandoned,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SeriesFinishReason {
    ScoreLimit,
    MemberLeftForfeit,
    MemberLeftAbandoned,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RematchStatus {
    Pending,
    Starting,
    Declined,
    Cancelled,
    Expired,
    OpponentOffline,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RematchDecision {
    Pending,
    Accepted,
    Declined,
}

#[derive(Clone, Debug, Serialize)]
pub struct RematchResponseView {
    pub player_id: Uuid,
    pub display_name: String,
    pub decision: RematchDecision,
}

#[derive(Clone, Debug, Serialize)]
pub struct RematchView {
    pub invitation_id: Uuid,
    pub requester_player_id: Uuid,
    pub status: RematchStatus,
    pub expires_at_unix_ms: u64,
    pub responses: Vec<RematchResponseView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SeriesStandingView {
    pub player_id: Uuid,
    pub display_name: String,
    pub seat_index: u8,
    pub score: u8,
    pub left_series: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RoundStandingView {
    pub player_id: Uuid,
    pub display_name: String,
    pub seat_index: u8,
    pub score: u8,
    pub rank: u8,
    pub guess_count: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct RoundResultView {
    pub round_number: u8,
    pub mystery_id: String,
    pub finish_reason: FinishReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_player_id: Option<Uuid>,
    pub standings: Vec<RoundStandingView>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoomRequest {
    pub identity_id: String,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default = "default_max_players")]
    pub max_players: u8,
    #[serde(default = "default_best_of")]
    pub best_of: u8,
    #[serde(default)]
    pub difficulty: Difficulty,
}

#[derive(Debug, Deserialize)]
pub struct JoinRoomRequest {
    pub identity_id: String,
}

#[derive(Debug, Deserialize)]
pub struct QuickMatchRequest {
    pub identity_id: String,
    #[serde(default)]
    pub client_request_id: Option<String>,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default = "default_best_of")]
    pub best_of: u8,
    #[serde(default = "default_party_size")]
    pub party_size: u8,
    #[serde(default)]
    pub difficulty: Difficulty,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct DifficultyQueueCounts {
    pub bo1_hidden: u32,
    pub bo1_open: u32,
    pub bo3_hidden: u32,
    pub bo3_open: u32,
    pub bo5_hidden: u32,
    pub bo5_open: u32,
    pub group_bo1_hidden: u32,
    pub group_bo1_open: u32,
    pub group_bo3_hidden: u32,
    pub group_bo3_open: u32,
    pub group_bo5_hidden: u32,
    pub group_bo5_open: u32,
    pub total: u32,
    pub playing_bo1: u32,
    pub playing_bo1_hidden: u32,
    pub playing_bo1_open: u32,
    pub playing_bo3: u32,
    pub playing_bo3_hidden: u32,
    pub playing_bo3_open: u32,
    pub playing_bo5: u32,
    pub playing_bo5_hidden: u32,
    pub playing_bo5_open: u32,
    pub playing_group_bo1: u32,
    pub playing_group_bo1_hidden: u32,
    pub playing_group_bo1_open: u32,
    pub playing_group_bo3: u32,
    pub playing_group_bo3_hidden: u32,
    pub playing_group_bo3_open: u32,
    pub playing_group_bo5: u32,
    pub playing_group_bo5_hidden: u32,
    pub playing_group_bo5_open: u32,
    pub playing_total: u32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct QueueCounts {
    pub bo1: u32,
    pub bo3: u32,
    pub bo5: u32,
    pub bo1_hidden: u32,
    pub bo1_open: u32,
    pub bo3_hidden: u32,
    pub bo3_open: u32,
    pub bo5_hidden: u32,
    pub bo5_open: u32,
    pub total: u32,
    pub group_bo1: u32,
    pub group_bo3: u32,
    pub group_bo5: u32,
    pub group_bo1_hidden: u32,
    pub group_bo1_open: u32,
    pub group_bo3_hidden: u32,
    pub group_bo3_open: u32,
    pub group_bo5_hidden: u32,
    pub group_bo5_open: u32,
    pub group_total: u32,
    pub playing_bo1: u32,
    pub playing_bo3: u32,
    pub playing_bo5: u32,
    pub playing_group_bo1: u32,
    pub playing_group_bo3: u32,
    pub playing_group_bo5: u32,
    pub playing_total: u32,
    pub easy: DifficultyQueueCounts,
    pub full: DifficultyQueueCounts,
    pub hard: DifficultyQueueCounts,
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionResponse {
    pub room_code: String,
    pub player_id: Uuid,
    pub session_token: String,
    pub socket_io_url: String,
    pub snapshot: Snapshot,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub seq: u64,
    pub room_code: String,
    pub kind: RoomKind,
    pub visibility: Visibility,
    pub difficulty: Difficulty,
    pub phase: Phase,
    pub self_player_id: Uuid,
    pub host_player_id: Uuid,
    pub max_players: u8,
    pub max_guesses: usize,
    pub best_of: u8,
    pub round_number: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_unix_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_round_unix_ms: Option<u64>,
    pub players: Vec<PlayerView>,
    pub own_guesses: Vec<GuessView>,
    pub opponent_progress: Vec<OpponentProgressView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_player_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_winner_player_id: Option<Uuid>,
    #[serde(default)]
    pub series_status: SeriesStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_finish_reason: Option<SeriesFinishReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_final_standings: Option<Vec<SeriesStandingView>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub round_results: Vec<RoundResultView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<FinishReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mystery_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rematch: Option<RematchView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PlayerView {
    pub player_id: Uuid,
    pub seat_index: u8,
    pub display_name: String,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disconnect_deadline_unix_ms: Option<u64>,
    pub forfeited_this_round: bool,
    pub guess_count: usize,
    pub score: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct GuessView {
    pub player_id: String,
    pub guess_number: usize,
    pub matched_fields: Vec<&'static str>,
    pub country_relation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_distance_km: Option<u32>,
    pub correct: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpponentProgressView {
    pub player_id: Uuid,
    pub guess_number: usize,
    pub guessed_player_id: Option<String>,
    pub matched_fields: Vec<&'static str>,
    pub country_relation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_distance_km: Option<u32>,
    pub correct: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    StartRound {
        request_id: Uuid,
    },
    Guess {
        request_id: Uuid,
        player_id: String,
    },
    SetVisibility {
        request_id: Uuid,
        visibility: Visibility,
    },
    RestartSeries {
        request_id: Uuid,
    },
    RequestRematch {
        request_id: Uuid,
    },
    RespondRematch {
        request_id: Uuid,
        invitation_id: Uuid,
        accept: bool,
    },
    CancelRematch {
        request_id: Uuid,
        invitation_id: Uuid,
    },
}

impl ClientMessage {
    pub fn request_id(&self) -> Uuid {
        match self {
            Self::StartRound { request_id }
            | Self::Guess { request_id, .. }
            | Self::SetVisibility { request_id, .. }
            | Self::RestartSeries { request_id }
            | Self::RequestRematch { request_id }
            | Self::RespondRematch { request_id, .. }
            | Self::CancelRematch { request_id, .. } => *request_id,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Snapshot {
        seq: u64,
        snapshot: Box<Snapshot>,
    },
    PlayerJoined {
        seq: u64,
        player: PlayerView,
    },
    PlayerConnection {
        seq: u64,
        player_id: Uuid,
        connected: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        disconnect_deadline_unix_ms: Option<u64>,
    },
    PlayerRoundForfeited {
        seq: u64,
        player_id: Uuid,
        round_number: u8,
    },
    RoundStarted {
        seq: u64,
        round_number: u8,
        deadline_unix_ms: u64,
    },
    GuessAccepted {
        seq: u64,
        request_id: Uuid,
        player_id: String,
        guess_number: usize,
        matched_fields: Vec<&'static str>,
        country_relation: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        country_distance_km: Option<u32>,
        correct: bool,
    },
    OpponentProgress {
        seq: u64,
        player_id: Uuid,
        guess_number: usize,
        guessed_player_id: Option<String>,
        matched_fields: Vec<&'static str>,
        country_relation: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        country_distance_km: Option<u32>,
        correct: bool,
    },
    VisibilityChanged {
        seq: u64,
        request_id: Uuid,
        visibility: Visibility,
    },
    RoundFinished {
        seq: u64,
        round_number: u8,
        host_player_id: Uuid,
        winner_player_id: Option<Uuid>,
        series_winner_player_id: Option<Uuid>,
        series_status: SeriesStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        series_finish_reason: Option<SeriesFinishReason>,
        #[serde(skip_serializing_if = "Option::is_none")]
        series_final_standings: Option<Vec<SeriesStandingView>>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        round_results: Vec<RoundResultView>,
        finish_reason: FinishReason,
        scores: Vec<ScoreView>,
        next_round_unix_ms: Option<u64>,
        mystery_id: String,
    },
    Ack {
        seq: u64,
        request_id: Uuid,
    },
    Error {
        seq: u64,
        request_id: Option<Uuid>,
        code: &'static str,
        message: String,
    },
}

fn default_max_players() -> u8 {
    4
}

fn default_best_of() -> u8 {
    3
}

fn default_party_size() -> u8 {
    2
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreView {
    pub player_id: Uuid,
    pub score: u8,
}
