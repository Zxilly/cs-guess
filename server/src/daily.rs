use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, UtcOffset};

use crate::error::AppError;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlayer {
    pub id: String,
    pub nickname: String,
    pub name: String,
    pub team: String,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyChallenge {
    pub date: String,
    pub round_number: u16,
    pub mystery_player_id: String,
    pub mystery_player: CatalogPlayer,
    pub catalog_version: String,
}

pub struct DailyChallengeCandidate {
    pub challenge: DailyChallenge,
    pub player_snapshot_json: String,
}

static CATALOG_JSON: &str = include_str!("../../src/data/players.generated.json");

static PLAYERS: LazyLock<Vec<CatalogPlayer>> = LazyLock::new(|| {
    serde_json::from_str(CATALOG_JSON).expect("generated player catalog must be valid JSON")
});

static CATALOG_VERSION: LazyLock<String> =
    LazyLock::new(|| format!("{:x}", Sha256::digest(CATALOG_JSON.as_bytes())));

pub fn catalog_player_by_id(id: &str) -> Option<&'static CatalogPlayer> {
    PLAYERS.iter().find(|player| player.id == id)
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
