use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset};

use crate::{
    error::AppError,
    profile::{AuthoritativeRoundSettlement, RoundRecordDetails},
    protocol::STANDARD_MAX_GUESSES,
};

pub const DAILY_ROUND_SECONDS: u64 = 180;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlayer {
    pub id: String,
    pub nickname: String,
    pub name: String,
    pub team: String,
    #[serde(default)]
    pub historical_teams: Vec<String>,
    #[serde(default)]
    pub team_logo_url: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    pub nationality: String,
    pub country_code: String,
    pub age: u8,
    pub role: String,
    pub major_appearances: u16,
    pub major_wins: u16,
}

impl CatalogPlayer {
    pub(crate) fn normalize_team_for_display(&mut self) -> bool {
        let normalized = self.team.trim().to_ascii_lowercase();
        let invalid = matches!(
            normalized.as_str(),
            "" | "undefined" | "null" | "none" | "n/a"
        ) || (normalized.starts_with("undefined (")
            && normalized.ends_with(" team)"));
        if !invalid {
            return false;
        }
        self.team = "无队伍".to_owned();
        self.team_logo_url = None;
        true
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyChallenge {
    pub date: String,
    pub round_number: u16,
    pub mystery_player_id: String,
    pub mystery_player: CatalogPlayer,
    pub catalog_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyChallengeMetadata {
    pub date: String,
    pub round_number: u16,
}

impl From<&DailyChallenge> for DailyChallengeMetadata {
    fn from(challenge: &DailyChallenge) -> Self {
        Self {
            date: challenge.date.clone(),
            round_number: challenge.round_number,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyChallengeAttempt {
    pub date: String,
    pub round_number: u16,
    pub mystery_player: CatalogPlayer,
    pub deadline_unix_ms: u64,
}

impl DailyChallengeAttempt {
    pub fn new(challenge: DailyChallenge, deadline_unix_ms: u64) -> Self {
        Self {
            date: challenge.date,
            round_number: challenge.round_number,
            mystery_player: challenge.mystery_player,
            deadline_unix_ms,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteDailyChallengeRequest {
    pub anonymous_id: String,
    #[serde(default)]
    pub guess_ids: Vec<String>,
    #[serde(default)]
    pub timed_out: bool,
}

pub struct DailyChallengeCandidate {
    pub challenge: DailyChallenge,
    pub player_snapshot_json: String,
}

static CATALOG_JSON: &str = include_str!("../../src/data/players.generated.json");

static PLAYERS: LazyLock<Vec<CatalogPlayer>> = LazyLock::new(|| {
    let mut players: Vec<CatalogPlayer> =
        serde_json::from_str(CATALOG_JSON).expect("generated player catalog must be valid JSON");
    for player in &mut players {
        player.normalize_team_for_display();
    }
    players
});

static CATALOG_VERSION: LazyLock<String> =
    LazyLock::new(|| format!("{:x}", Sha256::digest(CATALOG_JSON.as_bytes())));

pub fn catalog_player_by_id(id: &str) -> Option<&'static CatalogPlayer> {
    PLAYERS.iter().find(|player| player.id == id)
}

pub fn catalog_players() -> &'static [CatalogPlayer] {
    &PLAYERS
}

impl DailyChallengeCandidate {
    pub fn current() -> Result<Self, AppError> {
        let shanghai_offset = UtcOffset::from_hms(8, 0, 0).map_err(|_| AppError::Internal)?;
        let now = OffsetDateTime::now_utc().to_offset(shanghai_offset);
        Self::for_date(now.date())
    }

    fn for_date(date: time::Date) -> Result<Self, AppError> {
        if PLAYERS.is_empty() {
            return Err(AppError::Internal);
        }
        let date_string = format!(
            "{:04}-{:02}-{:02}",
            date.year(),
            u8::from(date.month()),
            date.day()
        );
        let digest = Sha256::digest(format!("{date_string}:{}", *CATALOG_VERSION).as_bytes());
        let index = u64::from_be_bytes(digest[..8].try_into().expect("digest has eight bytes"))
            as usize
            % PLAYERS.len();
        let mystery_player = PLAYERS[index].clone();
        let player_snapshot_json =
            serde_json::to_string(&mystery_player).map_err(|_| AppError::Internal)?;
        Ok(Self {
            challenge: DailyChallenge {
                date: date_string,
                round_number: date.ordinal(),
                mystery_player_id: mystery_player.id.clone(),
                mystery_player,
                catalog_version: CATALOG_VERSION.clone(),
            },
            player_snapshot_json,
        })
    }
}

impl DailyChallenge {
    pub(crate) fn settlement(
        &self,
        guess_ids: Vec<String>,
        timed_out: bool,
    ) -> Result<AuthoritativeRoundSettlement, AppError> {
        if guess_ids.len() > STANDARD_MAX_GUESSES {
            return Err(AppError::BadRequest(
                "daily challenge has too many guesses".to_owned(),
            ));
        }
        let mut unique_guesses = std::collections::HashSet::with_capacity(guess_ids.len());
        for guess_id in &guess_ids {
            if catalog_player_by_id(guess_id).is_none() {
                return Err(AppError::BadRequest(
                    "daily challenge contains an unknown guess".to_owned(),
                ));
            }
            if !unique_guesses.insert(guess_id) {
                return Err(AppError::BadRequest(
                    "daily challenge guesses must be unique".to_owned(),
                ));
            }
        }

        let winning_index = guess_ids
            .iter()
            .position(|guess_id| guess_id == &self.mystery_player_id);
        if winning_index.is_some_and(|index| index + 1 != guess_ids.len()) {
            return Err(AppError::BadRequest(
                "daily challenge cannot continue after the correct guess".to_owned(),
            ));
        }
        let result = if winning_index.is_some() {
            "win"
        } else if timed_out || guess_ids.len() == STANDARD_MAX_GUESSES {
            "loss"
        } else {
            return Err(AppError::BadRequest(
                "daily challenge is not finished".to_owned(),
            ));
        };

        Ok(AuthoritativeRoundSettlement {
            round_id: format!("daily:{}", self.date),
            result: result.to_owned(),
            details: Some(RoundRecordDetails {
                mode: "daily".to_owned(),
                room_code: None,
                round_number: u32::from(self.round_number),
                best_of: 1,
                answer_id: Some(self.mystery_player_id.clone()),
                guess_ids,
                opponent_names: Vec::new(),
                self_score: u32::from(result == "win"),
                opponent_score: u32::from(result == "loss"),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::CatalogPlayer;

    #[test]
    fn legacy_undefined_team_is_safe_for_display() {
        let mut player = CatalogPlayer {
            id: "jedqr".to_owned(),
            nickname: "jedqr".to_owned(),
            name: "Grzegorz Jędras".to_owned(),
            team: "undefined (American team)".to_owned(),
            historical_teams: Vec::new(),
            team_logo_url: Some("https://cdn.example/undefined.png".to_owned()),
            image_url: None,
            nationality: "Poland".to_owned(),
            country_code: "PL".to_owned(),
            age: 27,
            role: "Entry".to_owned(),
            major_appearances: 0,
            major_wins: 0,
        };

        player.normalize_team_for_display();

        assert_eq!(player.team, "无队伍");
        assert_eq!(player.team_logo_url, None);
    }
}
