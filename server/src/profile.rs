use rand::Rng;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    daily::{CatalogPlayer, catalog_player_by_id, catalog_players},
    error::AppError,
    state::validate_identity_id,
};

const MAX_HISTORY: usize = 50;
const MAX_RECORDED_ROUNDS: usize = 100;
const DRAW_ITEM_COUNT: usize = 29;
const DRAW_WINNER_INDEX: usize = 23;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub pool_id: String,
    pub item_ids: Vec<String>,
    pub winner_id: String,
    pub winner_index: usize,
    pub created_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingIdentityDrawView {
    pub pool_id: String,
    pub item_ids: Vec<String>,
    pub winner_id: String,
    pub winner_index: usize,
    pub created_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub anonymous_id: String,
    pub player_id: String,
    pub identity_confirmed: bool,
    pub stats: ProfileStats,
    pub draw_credits: u32,
    pub losses_toward_credit: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_draw: Option<PendingIdentityDrawView>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCompletionResponse {
    pub profile: ProfileSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_entry: Option<MatchHistoryEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHistoryPage {
    pub items: Vec<MatchHistoryEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    pub anonymous_id: String,
    pub initial_player_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartIdentityDrawRequest {
    pub request_id: String,
    pub pool_id: String,
    #[serde(default)]
    pub replaced_winner_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthoritativeRoundSettlement {
    pub round_id: String,
    pub result: String,
    pub details: Option<RoundRecordDetails>,
}

#[derive(Clone, Debug)]
pub(crate) struct RoundRecordDetails {
    pub mode: String,
    pub room_code: Option<String>,
    pub round_number: u32,
    pub best_of: u8,
    pub answer_id: Option<String>,
    pub guess_ids: Vec<String>,
    pub opponent_names: Vec<String>,
    pub self_score: u32,
    pub opponent_score: u32,
}

impl ProfileState {
    pub fn new(anonymous_id: String, initial_player_id: String) -> Result<Self, AppError> {
        validate_anonymous_id(&anonymous_id)?;
        if !is_common_identity(&initial_player_id) {
            return Err(AppError::BadRequest(
                "initial_player_id must belong to the common identity pool".to_owned(),
            ));
        }
        Ok(Self {
            anonymous_id,
            player_id: initial_player_id,
            identity_confirmed: false,
            stats: ProfileStats {
                wins: 0,
                losses: 0,
                draws: 0,
                current_streak: 0,
                best_streak: 0,
            },
            draw_credits: 1,
            losses_toward_credit: 0,
            recorded_rounds: Vec::new(),
            match_history: Vec::new(),
            pending_draw: None,
            updated_at: unix_timestamp_millis(),
        })
    }

    pub fn summary(&self) -> ProfileSummary {
        ProfileSummary {
            anonymous_id: self.anonymous_id.clone(),
            player_id: self.player_id.clone(),
            identity_confirmed: self.identity_confirmed,
            stats: self.stats.clone(),
            draw_credits: self.draw_credits,
            losses_toward_credit: self.losses_toward_credit,
            pending_draw: self
                .pending_draw
                .as_ref()
                .map(PendingIdentityDrawView::from),
            updated_at: self.updated_at,
        }
    }

    pub fn completion_response(&self, round_id: &str) -> ProfileCompletionResponse {
        ProfileCompletionResponse {
            profile: self.summary(),
            history_entry: self
                .match_history
                .iter()
                .find(|entry| entry.id == round_id)
                .cloned(),
        }
    }

    pub fn history_page(
        &self,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<ProfileHistoryPage, AppError> {
        if !(1..=MAX_HISTORY).contains(&limit) {
            return Err(AppError::BadRequest(format!(
                "history limit must be between 1 and {MAX_HISTORY}"
            )));
        }
        let end = match cursor {
            Some(cursor) => self
                .match_history
                .iter()
                .position(|entry| entry.id == cursor)
                .ok_or_else(|| AppError::BadRequest("history cursor is invalid".to_owned()))?,
            None => self.match_history.len(),
        };
        let start = end.saturating_sub(limit);
        let items = self.match_history[start..end]
            .iter()
            .rev()
            .cloned()
            .collect();
        let next_cursor = (start > 0).then(|| self.match_history[start].id.clone());
        Ok(ProfileHistoryPage { items, next_cursor })
    }

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

    pub fn start_identity_draw(
        &mut self,
        request: StartIdentityDrawRequest,
    ) -> Result<(), AppError> {
        validate_request_id(&request.request_id)?;
        let unlock_wins = identity_pool_unlock_wins(&request.pool_id)?;
        if !self.identity_confirmed && request.pool_id != "common" {
            return Err(AppError::BadRequest(
                "initial identity must be drawn from the common pool".to_owned(),
            ));
        }
        if self.stats.wins < unlock_wins {
            return Err(AppError::BadRequest(
                "identity pool is still locked".to_owned(),
            ));
        }
        if self
            .pending_draw
            .as_ref()
            .and_then(|draw| draw.request_id.as_deref())
            == Some(request.request_id.as_str())
        {
            return Ok(());
        }
        match (&self.pending_draw, &request.replaced_winner_id) {
            (None, None) => {}
            (Some(draw), Some(replaced))
                if draw.pool_id == request.pool_id && draw.winner_id == *replaced => {}
            _ => {
                return Err(AppError::ProfileConflict(
                    "pending identity draw changed".to_owned(),
                ));
            }
        }
        if self.draw_credits == 0 {
            return Err(AppError::ProfileConflict(
                "no identity draw credits remain".to_owned(),
            ));
        }

        let candidates: Vec<&CatalogPlayer> = catalog_players()
            .iter()
            .filter(|player| {
                player.id != self.player_id && player_belongs_to_pool(player, &request.pool_id)
            })
            .collect();
        if candidates.is_empty() {
            return Err(AppError::Internal);
        }
        let mut rng = rand::rng();
        let winner = candidates[rng.random_range(0..candidates.len())];
        let mut item_ids: Vec<String> = (0..DRAW_ITEM_COUNT)
            .map(|_| candidates[rng.random_range(0..candidates.len())].id.clone())
            .collect();
        item_ids[DRAW_WINNER_INDEX] = winner.id.clone();

        self.draw_credits -= 1;
        self.pending_draw = Some(PendingIdentityDraw {
            request_id: Some(request.request_id),
            pool_id: request.pool_id,
            item_ids,
            winner_id: winner.id.clone(),
            winner_index: DRAW_WINNER_INDEX,
            created_at: unix_timestamp_millis(),
        });
        self.touch();
        Ok(())
    }

    pub fn adopt_identity_draw(&mut self, winner_id: &str) -> Result<(), AppError> {
        if self.pending_draw.is_none() && self.identity_confirmed && self.player_id == winner_id {
            return Ok(());
        }
        let pending = self.pending_draw.as_ref().ok_or_else(|| {
            AppError::ProfileConflict("no pending identity draw exists".to_owned())
        })?;
        if pending.winner_id != winner_id {
            return Err(AppError::ProfileConflict(
                "identity draw winner changed".to_owned(),
            ));
        }
        self.player_id = winner_id.to_owned();
        self.identity_confirmed = true;
        self.pending_draw = None;
        self.touch();
        Ok(())
    }

    pub fn discard_identity_draw(&mut self, winner_id: &str) -> Result<(), AppError> {
        let Some(pending) = &self.pending_draw else {
            return Ok(());
        };
        if !self.identity_confirmed {
            return Err(AppError::BadRequest(
                "initial identity draw must be adopted".to_owned(),
            ));
        }
        if pending.winner_id != winner_id {
            return Err(AppError::ProfileConflict(
                "identity draw winner changed".to_owned(),
            ));
        }
        self.pending_draw = None;
        self.touch();
        Ok(())
    }

    pub(crate) fn settle_round(
        &mut self,
        settlement: AuthoritativeRoundSettlement,
    ) -> Result<(), AppError> {
        if !valid_short_text(&settlement.round_id, 160) {
            return Err(AppError::BadRequest(
                "round_id has an invalid format".to_owned(),
            ));
        }
        if self
            .recorded_rounds
            .iter()
            .any(|round_id| round_id == &settlement.round_id)
        {
            return Ok(());
        }
        if !matches!(settlement.result.as_str(), "win" | "loss" | "draw") {
            return Err(AppError::BadRequest("round result is invalid".to_owned()));
        }

        let next_streak = if settlement.result == "win" {
            self.stats.current_streak.saturating_add(1)
        } else {
            0
        };
        let losses_toward_credit = if settlement.result == "loss" {
            self.losses_toward_credit.saturating_add(1)
        } else {
            self.losses_toward_credit
        };
        let earned_credits = u32::from(
            settlement.result == "win" || settlement.result == "loss" && losses_toward_credit >= 2,
        );
        self.stats.wins = self
            .stats
            .wins
            .saturating_add(u32::from(settlement.result == "win"));
        self.stats.losses = self
            .stats
            .losses
            .saturating_add(u32::from(settlement.result == "loss"));
        self.stats.draws = self
            .stats
            .draws
            .saturating_add(u32::from(settlement.result == "draw"));
        self.stats.current_streak = next_streak;
        self.stats.best_streak = self.stats.best_streak.max(next_streak);
        self.draw_credits = self.draw_credits.saturating_add(earned_credits);
        if settlement.result == "loss" {
            self.losses_toward_credit = losses_toward_credit % 2;
        }
        push_bounded(
            &mut self.recorded_rounds,
            settlement.round_id.clone(),
            MAX_RECORDED_ROUNDS,
        );

        if let Some(details) = settlement.details {
            let answer_snapshot = details
                .answer_id
                .as_deref()
                .and_then(catalog_player_by_id)
                .map(history_snapshot);
            let guess_snapshots = details
                .guess_ids
                .iter()
                .map(|id| catalog_player_by_id(id).map(history_snapshot))
                .collect();
            let entry = MatchHistoryEntry {
                id: settlement.round_id,
                completed_at: current_timestamp(),
                result: settlement.result,
                mode: details.mode,
                room_code: details.room_code,
                round_number: details.round_number,
                best_of: details.best_of,
                answer_id: details.answer_id,
                answer_snapshot,
                guess_ids: details.guess_ids,
                guess_snapshots: Some(guess_snapshots),
                opponent_names: details.opponent_names,
                self_score: details.self_score,
                opponent_score: details.opponent_score,
            };
            if !entry.is_valid() {
                return Err(AppError::BadRequest(
                    "round history contains invalid data".to_owned(),
                ));
            }
            push_bounded(&mut self.match_history, entry, MAX_HISTORY);
        }
        self.touch();
        Ok(())
    }

    fn touch(&mut self) {
        self.updated_at = unix_timestamp_millis().max(self.updated_at.saturating_add(1));
    }
}

impl From<&PendingIdentityDraw> for PendingIdentityDrawView {
    fn from(draw: &PendingIdentityDraw) -> Self {
        Self {
            pool_id: draw.pool_id.clone(),
            item_ids: draw.item_ids.clone(),
            winner_id: draw.winner_id.clone(),
            winner_index: draw.winner_index,
            created_at: draw.created_at,
        }
    }
}

impl PendingIdentityDraw {
    fn is_valid(&self) -> bool {
        self.request_id
            .as_deref()
            .is_none_or(|request_id| validate_request_id(request_id).is_ok())
            && matches!(self.pool_id.as_str(), "common" | "advanced" | "star")
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

fn validate_request_id(value: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::BadRequest("request_id must be a UUID".to_owned()))
}

fn identity_pool_unlock_wins(pool_id: &str) -> Result<u32, AppError> {
    match pool_id {
        "common" => Ok(0),
        "advanced" => Ok(3),
        "star" => Ok(10),
        _ => Err(AppError::BadRequest("identity pool is invalid".to_owned())),
    }
}

fn player_belongs_to_pool(player: &CatalogPlayer, pool_id: &str) -> bool {
    match pool_id {
        "common" => (1..=4).contains(&player.major_appearances) && player.major_wins == 0,
        "advanced" => player.major_appearances >= 5 && player.major_wins == 0,
        "star" => player.major_wins >= 1,
        _ => false,
    }
}

fn is_common_identity(player_id: &str) -> bool {
    catalog_player_by_id(player_id).is_some_and(|player| player_belongs_to_pool(player, "common"))
}

fn history_snapshot(player: &CatalogPlayer) -> HistoryPlayerSnapshot {
    HistoryPlayerSnapshot {
        id: player.id.clone(),
        nickname: player.nickname.clone(),
        name: player.name.clone(),
        team: player.team.clone(),
        country_code: player.country_code.clone(),
        age: player.age,
        role: player.role.clone(),
        major_appearances: u32::from(player.major_appearances),
    }
}

fn push_bounded<T>(values: &mut Vec<T>, value: T, limit: usize) {
    if values.len() >= limit {
        values.remove(0);
    }
    values.push(value);
}

fn unix_timestamp_millis() -> u64 {
    OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .div_euclid(1_000_000)
        .try_into()
        .unwrap_or(1)
}

fn current_timestamp() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    )
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
    use super::{HistoryPlayerSnapshot, MatchHistoryEntry, ProfileState, ProfileStats};

    fn history_entry(id: &str) -> MatchHistoryEntry {
        MatchHistoryEntry {
            id: id.to_owned(),
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
        }
    }

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

    #[test]
    fn history_pages_are_newest_first_and_cursor_based() {
        let profile = ProfileState {
            anonymous_id: "anonymous-history-pagination".to_owned(),
            player_id: "donk".to_owned(),
            identity_confirmed: true,
            stats: ProfileStats {
                wins: 3,
                losses: 0,
                draws: 0,
                current_streak: 3,
                best_streak: 3,
            },
            draw_credits: 0,
            losses_toward_credit: 0,
            recorded_rounds: vec![],
            match_history: vec![
                history_entry("round-1"),
                history_entry("round-2"),
                history_entry("round-3"),
            ],
            pending_draw: None,
            updated_at: 1,
        };

        let first = profile.history_page(None, 2).unwrap();
        assert_eq!(
            first
                .items
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["round-3", "round-2"]
        );
        assert_eq!(first.next_cursor.as_deref(), Some("round-2"));

        let second = profile
            .history_page(first.next_cursor.as_deref(), 2)
            .unwrap();
        assert_eq!(second.items[0].id, "round-1");
        assert!(second.next_cursor.is_none());
    }
}
