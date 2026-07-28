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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_draw: Option<PendingIdentityDraw>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingIdentityDraw {
    pub pool_id: String,
    pub item_ids: Vec<String>,
    pub winner_id: String,
    pub winner_index: usize,
    pub created_at: u64,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_snapshot: Option<HistoryPlayerSnapshot>,
    pub guess_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guess_snapshots: Option<Vec<Option<HistoryPlayerSnapshot>>>,
    pub opponent_names: Vec<String>,
    pub self_score: u32,
    pub opponent_score: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPlayerSnapshot {
    pub id: String,
    pub nickname: String,
    pub name: String,
    pub team: String,
    pub country_code: String,
    pub age: u8,
    pub role: String,
    pub major_appearances: u32,
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
            || self
                .pending_draw
                .as_ref()
                .is_some_and(|draw| !draw.is_valid())
        {
            return Err(AppError::BadRequest(
                "profile history contains invalid data".to_owned(),
            ));
        }
        Ok(())
    }
}

impl PendingIdentityDraw {
    fn is_valid(&self) -> bool {
        matches!(self.pool_id.as_str(), "common" | "advanced" | "star")
            && self.item_ids.len() == 29
            && self.winner_index < self.item_ids.len()
            && self.item_ids[self.winner_index] == self.winner_id
            && self.created_at > 0
            && self
                .item_ids
                .iter()
                .all(|player_id| validate_identity_id(player_id).is_ok())
    }
}

impl MatchHistoryEntry {
    fn is_valid(&self) -> bool {
        valid_short_text(&self.id, 160)
            && valid_short_text(&self.completed_at, 64)
            && matches!(self.result.as_str(), "win" | "loss" | "draw")
            && matches!(self.mode.as_str(), "daily" | "solo" | "quick" | "room")
            && matches!(self.best_of, 1 | 3 | 5)
            && self
                .room_code
                .as_ref()
                .is_none_or(|value| valid_short_text(value, 16))
            && self
                .answer_id
                .as_ref()
                .is_none_or(|value| valid_short_text(value, 96))
            && self
                .answer_snapshot
                .as_ref()
                .is_none_or(HistoryPlayerSnapshot::is_valid)
            && self.guess_ids.len() <= crate::protocol::MAX_GUESSES
            && self
                .guess_ids
                .iter()
                .all(|value| valid_short_text(value, 96))
            && self.guess_snapshots.as_ref().is_none_or(|snapshots| {
                snapshots.len() == self.guess_ids.len()
                    && snapshots.iter().all(|snapshot| {
                        snapshot
                            .as_ref()
                            .is_none_or(HistoryPlayerSnapshot::is_valid)
                    })
            })
            && self.opponent_names.len() <= 7
            && self
                .opponent_names
                .iter()
                .all(|value| valid_short_text(value, 96))
    }
}

impl HistoryPlayerSnapshot {
    fn is_valid(&self) -> bool {
        valid_short_text(&self.id, 96)
            && valid_short_text(&self.nickname, 96)
            && valid_short_text(&self.name, 160)
            && valid_short_text(&self.team, 96)
            && valid_short_text(&self.country_code, 8)
            && matches!(
                self.role.as_str(),
                "AWPer" | "Rifler" | "IGL" | "Entry" | "Unknown"
            )
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

#[cfg(test)]
mod tests {
    use super::{HistoryPlayerSnapshot, MatchHistoryEntry};

    #[test]
    fn solo_history_entries_are_valid() {
        let entry = MatchHistoryEntry {
            id: "solo:test-round".to_owned(),
            completed_at: "2026-07-27T12:00:00.000Z".to_owned(),
            result: "win".to_owned(),
            mode: "solo".to_owned(),
            room_code: None,
            round_number: 1,
            best_of: 1,
            answer_id: Some("donk".to_owned()),
            answer_snapshot: None,
            guess_ids: vec!["donk".to_owned()],
            guess_snapshots: None,
            opponent_names: vec![],
            self_score: 1,
            opponent_score: 0,
        };

        assert!(entry.is_valid());
    }

    #[test]
    fn history_entries_accept_replay_snapshots() {
        let snapshot = HistoryPlayerSnapshot {
            id: "retired-player".to_owned(),
            nickname: "legacy".to_owned(),
            name: "Legacy Player".to_owned(),
            team: "Archive".to_owned(),
            country_code: "CN".to_owned(),
            age: 25,
            role: "Rifler".to_owned(),
            major_appearances: 2,
        };
        let entry = MatchHistoryEntry {
            id: "room:R1".to_owned(),
            completed_at: "2026-07-28T12:00:00.000Z".to_owned(),
            result: "win".to_owned(),
            mode: "room".to_owned(),
            room_code: Some("ROOM".to_owned()),
            round_number: 1,
            best_of: 3,
            answer_id: Some(snapshot.id.clone()),
            answer_snapshot: Some(snapshot.clone()),
            guess_ids: vec![snapshot.id.clone()],
            guess_snapshots: Some(vec![Some(snapshot)]),
            opponent_names: vec!["opponent".to_owned()],
            self_score: 1,
            opponent_score: 0,
        };

        assert!(entry.is_valid());
    }
}
