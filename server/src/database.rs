use std::{path::PathBuf, time::Duration};

use sha2::{Digest, Sha256};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use subtle::ConstantTimeEq;
use tracing::error;

use crate::{
    config::Config,
    daily::{CatalogPlayer, DailyChallenge, DailyChallengeCandidate, catalog_player_by_id},
    error::AppError,
    profile::{ProfileState, validate_anonymous_id, validate_sync_token},
};

#[derive(Clone)]
pub struct DatabaseStore {
    pool: SqlitePool,
    path: PathBuf,
    in_memory: bool,
}

impl DatabaseStore {
    pub fn new(config: &Config) -> Self {
        let in_memory = config.database_path.as_os_str() == ":memory:";
        let journal_mode = if in_memory {
            SqliteJournalMode::Memory
        } else {
            SqliteJournalMode::Wal
        };
        let options = SqliteConnectOptions::new()
            .filename(&config.database_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(journal_mode)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .min_connections(if in_memory { 1 } else { 2 })
            .max_connections(config.database_max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .idle_timeout(Duration::from_secs(300))
            .connect_lazy_with(options);
        Self {
            pool,
            path: config.database_path.clone(),
            in_memory,
        }
    }

    pub async fn initialize(&self) -> Result<(), AppError> {
        if !self.in_memory
            && let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).map_err(|error| {
                error!(%error, path = %parent.display(), "failed to create database directory");
                AppError::Internal
            })?;
        }
        sqlx::raw_sql(include_str!("../migrations/0001_profiles.sql"))
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        sqlx::raw_sql(include_str!("../migrations/0002_daily_challenges.sql"))
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        sqlx::query("PRAGMA wal_autocheckpoint = 1000")
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        if !self.in_memory {
            let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
                .fetch_one(&self.pool)
                .await
                .map_err(database_error)?;
            if !journal_mode.eq_ignore_ascii_case("wal") {
                error!(%journal_mode, "SQLite did not enter WAL mode");
                return Err(AppError::Internal);
            }
        }
        Ok(())
    }

    pub async fn load_profile(
        &self,
        anonymous_id: &str,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        validate_anonymous_id(anonymous_id)?;
        validate_sync_token(sync_token)?;
        let row: Option<(Vec<u8>, String)> =
            sqlx::query_as("SELECT token_hash, state_json FROM profiles WHERE anonymous_id = ?")
                .bind(anonymous_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(database_error)?;
        let Some((stored_hash, state_json)) = row else {
            return Err(AppError::ProfileNotFound);
        };
        authorize(&stored_hash, sync_token)?;
        serde_json::from_str(&state_json).map_err(|error| {
            error!(%error, %anonymous_id, "stored profile JSON is invalid");
            AppError::Internal
        })
    }

    pub async fn save_profile(
        &self,
        profile: ProfileState,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        profile.validate()?;
        validate_sync_token(sync_token)?;
        let token_hash = hash_token(sync_token);
        let state_json = serde_json::to_string(&profile).map_err(|error| {
            error!(%error, "failed to serialize profile");
            AppError::Internal
        })?;
        sqlx::query(
            "INSERT INTO profiles (
                anonymous_id, token_hash, player_id, identity_confirmed,
                updated_at, state_json
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(anonymous_id) DO UPDATE SET
                player_id = excluded.player_id,
                identity_confirmed = excluded.identity_confirmed,
                updated_at = excluded.updated_at,
                state_json = excluded.state_json
             WHERE profiles.token_hash = excluded.token_hash
               AND excluded.updated_at >= profiles.updated_at",
        )
        .bind(&profile.anonymous_id)
        .bind(token_hash.as_slice())
        .bind(&profile.player_id)
        .bind(profile.identity_confirmed)
        .bind(profile.updated_at as i64)
        .bind(state_json)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;

        self.load_profile(&profile.anonymous_id, sync_token).await
    }

    pub async fn current_daily_challenge(&self) -> Result<DailyChallenge, AppError> {
        let candidate = DailyChallengeCandidate::current()?;
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        sqlx::query(
            "INSERT INTO daily_challenges (
                challenge_date, round_number, player_id, player_snapshot_json,
                catalog_version, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(challenge_date) DO NOTHING",
        )
        .bind(&candidate.challenge.date)
        .bind(i64::from(candidate.challenge.round_number))
        .bind(&candidate.challenge.mystery_player_id)
        .bind(&candidate.player_snapshot_json)
        .bind(&candidate.challenge.catalog_version)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;

        let row: (i64, String, String, String) = sqlx::query_as(
            "SELECT round_number, player_id, player_snapshot_json, catalog_version
             FROM daily_challenges
             WHERE challenge_date = ?",
        )
        .bind(&candidate.challenge.date)
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;
        let mut mystery_player: CatalogPlayer = serde_json::from_str(&row.2).map_err(|error| {
            error!(%error, date = %candidate.challenge.date, "stored daily player is invalid");
            AppError::Internal
        })?;
        if mystery_player.image_url.is_none()
            && let Some(current_player) = catalog_player_by_id(&row.1)
            && current_player.image_url.is_some()
        {
            mystery_player.image_url = current_player.image_url.clone();
            let enriched_snapshot =
                serde_json::to_string(&mystery_player).map_err(|_| AppError::Internal)?;
            sqlx::query(
                "UPDATE daily_challenges
                 SET player_snapshot_json = ?
                 WHERE challenge_date = ? AND player_id = ?",
            )
            .bind(enriched_snapshot)
            .bind(&candidate.challenge.date)
            .bind(&row.1)
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        }
        Ok(DailyChallenge {
            date: candidate.challenge.date,
            round_number: u16::try_from(row.0).map_err(|_| AppError::Internal)?,
            mystery_player_id: row.1,
            mystery_player,
            catalog_version: row.3,
        })
    }
}

fn authorize(stored_hash: &[u8], sync_token: &str) -> Result<(), AppError> {
    let supplied_hash = hash_token(sync_token);
    if stored_hash.len() == supplied_hash.len()
        && bool::from(stored_hash.ct_eq(supplied_hash.as_slice()))
    {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

fn hash_token(sync_token: &str) -> [u8; 32] {
    Sha256::digest(sync_token.as_bytes()).into()
}

fn database_error(error: sqlx::Error) -> AppError {
    error!(%error, "SQLite operation failed");
    AppError::Internal
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{ProfileState, ProfileStats};
    use uuid::Uuid;

    fn test_profile(updated_at: u64, player_id: &str) -> ProfileState {
        ProfileState {
            anonymous_id: "anonymous-profile-test-0001".to_owned(),
            player_id: player_id.to_owned(),
            identity_confirmed: true,
            stats: ProfileStats {
                wins: 2,
                losses: 1,
                draws: 0,
                current_streak: 1,
                best_streak: 1,
            },
            draw_credits: 2,
            losses_toward_credit: 1,
            recorded_rounds: Vec::new(),
            match_history: Vec::new(),
            updated_at,
        }
    }

    #[tokio::test]
    async fn wal_store_persists_profiles_and_rejects_stale_or_unauthorized_writes() {
        let path = std::env::temp_dir().join(format!("cs-guess-profile-{}.sqlite", Uuid::new_v4()));
        let mut config = Config::for_test();
        config.database_path = path.clone();
        config.database_max_connections = 4;
        let store = DatabaseStore::new(&config);
        store.initialize().await.unwrap();

        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");

        let token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
        let saved = store
            .save_profile(test_profile(200, "donk"), token)
            .await
            .unwrap();
        assert_eq!(saved.player_id, "donk");

        let stale = store
            .save_profile(test_profile(100, "s1mple"), token)
            .await
            .unwrap();
        assert_eq!(stale.player_id, "donk");
        assert_eq!(stale.updated_at, 200);

        assert!(matches!(
            store
                .save_profile(
                    test_profile(300, "s1mple"),
                    "different_profile_sync_token_abcdefghijkl"
                )
                .await,
            Err(AppError::Unauthorized)
        ));
        assert_eq!(
            store
                .load_profile("anonymous-profile-test-0001", token)
                .await
                .unwrap(),
            saved
        );

        store.pool.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    }
}
