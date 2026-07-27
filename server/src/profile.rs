use serde::{Deserialize, Serialize};

use crate::{error::AppError, state::validate_identity_id};

const MAX_HISTORY: usize = 50;
const MAX_RECORDED_ROUNDS: usize = 100;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileState {
    pub anonymous_id: String,
    pub player_id: String,
    pub identity_confirmed: bool,
    pub stats: ProfileStats,
    pub draw_credits: u32,
    pub losses_toward_credit: u8,
    pub recorded_rounds: Vec<String>,
    pub match_history: Vec<MatchHistoryEntry>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStats {
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    pub current_streak: u32,
    pub best_streak: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatchHistoryEntry {
    pub id: String,
    pub completed_at: String,
    pub result: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_code: Option<String>,
    pub round_number: u32,
    pub best_of: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer_id: Option<String>,
    pub guess_ids: Vec<String>,
    pub opponent_names: Vec<String>,
    pub self_score: u32,
    pub opponent_score: u32,
}

impl ProfileState {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_anonymous_id(&self.anonymous_id)?;
        validate_identity_id(&self.player_id)?;
        if self.losses_toward_credit > 1
            || self.recorded_rounds.len() > MAX_RECORDED_ROUNDS
            || self.match_history.len() > MAX_HISTORY
            || self.updated_at > i64::MAX as u64
        {
            return Err(AppError::BadRequest(
                "profile counters or history exceed supported limits".to_owned(),
            ));
        }
        if self.stats.current_streak > self.stats.wins
            || self.stats.best_streak < self.stats.current_streak
        {
            return Err(AppError::BadRequest(
                "profile streak counters are inconsistent".to_owned(),
            ));
        }
        if !self
            .recorded_rounds
            .iter()
            .all(|value| valid_short_text(value, 160))
            || !self.match_history.iter().all(MatchHistoryEntry::is_valid)
        {
            return Err(AppError::BadRequest(
                "profile history contains invalid data".to_owned(),
            ));
        }
        Ok(())
    }
}

impl MatchHistoryEntry {
    fn is_valid(&self) -> bool {
        valid_short_text(&self.id, 160)
            && valid_short_text(&self.completed_at, 64)
            && matches!(self.result.as_str(), "win" | "loss" | "draw")
            && matches!(self.mode.as_str(), "daily" | "quick" | "room")
            && matches!(self.best_of, 1 | 3 | 5)
            && self
                .room_code
                .as_ref()
                .is_none_or(|value| valid_short_text(value, 16))
            && self
                .answer_id
                .as_ref()
                .is_none_or(|value| valid_short_text(value, 96))
            && self.guess_ids.len() <= crate::protocol::MAX_GUESSES
            && self
                .guess_ids
                .iter()
                .all(|value| valid_short_text(value, 96))
            && self.opponent_names.len() <= 7
            && self
                .opponent_names
                .iter()
                .all(|value| valid_short_text(value, 96))
    }
}

pub fn validate_anonymous_id(value: &str) -> Result<(), AppError> {
    if (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "anonymous_id has an invalid format".to_owned(),
        ))
    }
}

pub fn validate_sync_token(value: &str) -> Result<(), AppError> {
    if (32..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

fn valid_short_text(value: &str, max_length: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max_length
}
