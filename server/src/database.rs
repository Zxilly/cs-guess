use std::{path::PathBuf, sync::Arc, time::Duration};

use sha2::{Digest, Sha256};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;
use tracing::error;
use uuid::Uuid;

use crate::{
    config::Config,
    daily::{
        CatalogPlayer, DAILY_ROUND_SECONDS, DailyChallenge, DailyChallengeAttempt,
        DailyChallengeCandidate, catalog_player_by_id, catalog_players,
    },
    error::AppError,
    profile::{
        AuthoritativeRoundSettlement, CreateProfileRequest, ProfileCompletionResponse, ProfileState, StartIdentityDrawRequest,
        validate_anonymous_id, validate_sync_token,
    },
    protocol::Difficulty,
    solo::{SOLO_ROUND_SECONDS, SoloRound},
};

#[derive(Clone)]
pub struct DatabaseStore {
    pool: SqlitePool,
    path: PathBuf,
    in_memory: bool,
    profile_mutation_lock: Arc<Mutex<()>>,
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
            profile_mutation_lock: Arc::new(Mutex::new(())),
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
        sqlx::raw_sql(include_str!("../migrations/0003_solo_rounds.sql"))
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        sqlx::raw_sql(include_str!("../migrations/0004_daily_attempts.sql"))
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        let mut migration = self.pool.begin().await.map_err(database_error)?;
        sqlx::raw_sql(include_str!("../migrations/0005_round_settlements.sql"))
            .execute(&mut *migration)
            .await
            .map_err(database_error)?;
        migration.commit().await.map_err(database_error)?;
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

    #[cfg(test)]
    async fn save_profile(
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

    pub async fn create_profile(
        &self,
        request: CreateProfileRequest,
        sync_token: &str,
    ) -> Result<(ProfileState, bool), AppError> {
        validate_sync_token(sync_token)?;
        let _guard = self.profile_mutation_lock.lock().await;
        let profile = ProfileState::new(request.anonymous_id, request.initial_player_id)?;
        let token_hash = hash_token(sync_token);
        let state_json = serde_json::to_string(&profile).map_err(|error| {
            error!(%error, "failed to serialize initial profile");
            AppError::Internal
        })?;
        let insert = sqlx::query(
            "INSERT INTO profiles (
                anonymous_id, token_hash, player_id, identity_confirmed,
                updated_at, state_json
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(anonymous_id) DO NOTHING",
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
        Ok((
            self.load_profile(&profile.anonymous_id, sync_token).await?,
            insert.rows_affected() == 1,
        ))
    }

    pub async fn start_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        request: StartIdentityDrawRequest,
    ) -> Result<ProfileState, AppError> {
        let _guard = self.profile_mutation_lock.lock().await;
        let mut profile = self.load_profile(anonymous_id, sync_token).await?;
        profile.start_identity_draw(request)?;
        self.replace_profile(profile, sync_token).await
    }

    pub async fn adopt_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        winner_id: &str,
    ) -> Result<ProfileState, AppError> {
        let _guard = self.profile_mutation_lock.lock().await;
        let mut profile = self.load_profile(anonymous_id, sync_token).await?;
        profile.adopt_identity_draw(winner_id)?;
        self.replace_profile(profile, sync_token).await
    }

    pub async fn discard_identity_draw(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        winner_id: &str,
    ) -> Result<ProfileState, AppError> {
        let _guard = self.profile_mutation_lock.lock().await;
        let mut profile = self.load_profile(anonymous_id, sync_token).await?;
        profile.discard_identity_draw(winner_id)?;
        self.replace_profile(profile, sync_token).await
    }

    pub(crate) async fn settle_profile_round(
        &self,
        anonymous_id: &str,
        settlement: AuthoritativeRoundSettlement,
    ) -> Result<ProfileState, AppError> {
        validate_anonymous_id(anonymous_id)?;
        let _guard = self.profile_mutation_lock.lock().await;
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        // Claim the durable key and update progression in the same transaction.
        // A failed validation/write rolls back the key as well as the counters.
        let inserted = sqlx::query(
            "INSERT INTO round_settlements (anonymous_id, round_id)
             VALUES (?, ?) ON CONFLICT(anonymous_id, round_id) DO NOTHING",
        )
        .bind(anonymous_id)
        .bind(&settlement.round_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let state_json: String = sqlx::query_scalar(
            "SELECT state_json FROM profiles WHERE anonymous_id = ?",
        )
        .bind(anonymous_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        let mut profile: ProfileState =
            serde_json::from_str(&state_json).map_err(|_| AppError::Internal)?;
        if inserted.rows_affected() == 1 {
            let round_id = settlement.round_id.clone();
            profile.settle_round(settlement)?;
            profile.validate()?;
            let history_entry = profile.completion_response(&round_id).history_entry;
            let history_json = history_entry
                .map(|entry| serde_json::to_string(&entry))
                .transpose()
                .map_err(|_| AppError::Internal)?;
            sqlx::query(
                "UPDATE round_settlements SET history_entry_json = ?
                 WHERE anonymous_id = ? AND round_id = ?",
            )
            .bind(history_json)
            .bind(anonymous_id)
            .bind(round_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
            sqlx::query(
                "UPDATE profiles SET updated_at = ?, state_json = ? WHERE anonymous_id = ?",
            )
            .bind(profile.updated_at as i64)
            .bind(serde_json::to_string(&profile).map_err(|_| AppError::Internal)?)
            .bind(anonymous_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(profile)
    }

    pub async fn completed_profile_round(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        round_id: &str,
    ) -> Result<Option<ProfileCompletionResponse>, AppError> {
        let _guard = self.profile_mutation_lock.lock().await;
        let profile = self.load_profile(anonymous_id, sync_token).await?;
        let row: Option<(Option<String>, bool)> = sqlx::query_as(
            "SELECT history_entry_json, legacy_unknown FROM round_settlements
             WHERE anonymous_id = ? AND round_id = ?",
        )
        .bind(anonymous_id)
        .bind(round_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        let Some((history_json, legacy_unknown)) = row else {
            return Ok(None);
        };
        if legacy_unknown {
            return Err(AppError::BadRequest(
                "expired legacy round has no recoverable settlement receipt".to_owned(),
            ));
        }
        Ok(Some(ProfileCompletionResponse {
            profile: profile.summary(),
            history_entry: history_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|_| AppError::Internal)?,
        }))
    }

    pub async fn create_solo_round(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        difficulty: Difficulty,
    ) -> Result<SoloRound, AppError> {
        let profile = self.load_profile(anonymous_id, sync_token).await?;
        let round_number = profile
            .match_history
            .iter()
            .filter(|entry| entry.mode == "solo")
            .map(|entry| entry.round_number)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        let previous_mystery_id = profile
            .match_history
            .iter()
            .rev()
            .find(|entry| entry.mode == "solo")
            .and_then(|entry| entry.answer_id.as_deref());
        let candidates: Vec<&CatalogPlayer> = catalog_players()
            .iter()
            .filter(|player| solo_player_matches_difficulty(player, difficulty))
            .filter(|player| Some(player.id.as_str()) != previous_mystery_id)
            .collect();
        let mystery_player = candidates
            .get(rand::random_range(0..candidates.len()))
            .ok_or(AppError::Internal)?
            .to_owned()
            .clone();
        let created_at = unix_timestamp_millis();
        let round = SoloRound {
            round_id: format!("solo:{}:{}", difficulty_name(difficulty), Uuid::new_v4()),
            round_number,
            difficulty,
            mystery_player,
            deadline_unix_ms: created_at.saturating_add(SOLO_ROUND_SECONDS * 1_000),
            max_guesses: difficulty.max_guesses(),
        };
        sqlx::query(
            "INSERT INTO solo_rounds (
                round_id, anonymous_id, round_number, difficulty,
                mystery_player_id, deadline_unix_ms, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&round.round_id)
        .bind(anonymous_id)
        .bind(i64::from(round.round_number))
        .bind(difficulty_name(round.difficulty))
        .bind(&round.mystery_player.id)
        .bind(round.deadline_unix_ms as i64)
        .bind(created_at as i64)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(round)
    }

    pub async fn load_solo_round(
        &self,
        anonymous_id: &str,
        sync_token: &str,
        round_id: &str,
    ) -> Result<SoloRound, AppError> {
        self.load_profile(anonymous_id, sync_token).await?;
        let row: Option<(i64, String, String, i64)> = sqlx::query_as(
            "SELECT round_number, difficulty, mystery_player_id, deadline_unix_ms
             FROM solo_rounds
             WHERE round_id = ? AND anonymous_id = ?",
        )
        .bind(round_id)
        .bind(anonymous_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        let Some((round_number, difficulty, mystery_player_id, deadline_unix_ms)) = row else {
            return Err(AppError::ProfileNotFound);
        };
        let difficulty = parse_difficulty(&difficulty)?;
        let mystery_player = catalog_player_by_id(&mystery_player_id)
            .ok_or(AppError::Internal)?
            .clone();
        Ok(SoloRound {
            round_id: round_id.to_owned(),
            round_number: round_number.try_into().map_err(|_| AppError::Internal)?,
            difficulty,
            mystery_player,
            deadline_unix_ms: deadline_unix_ms
                .try_into()
                .map_err(|_| AppError::Internal)?,
            max_guesses: difficulty.max_guesses(),
        })
    }

    async fn replace_profile(
        &self,
        profile: ProfileState,
        sync_token: &str,
    ) -> Result<ProfileState, AppError> {
        profile.validate()?;
        let token_hash = hash_token(sync_token);
        let state_json = serde_json::to_string(&profile).map_err(|error| {
            error!(%error, "failed to serialize profile");
            AppError::Internal
        })?;
        let result = sqlx::query(
            "UPDATE profiles
             SET player_id = ?, identity_confirmed = ?, updated_at = ?, state_json = ?
             WHERE anonymous_id = ? AND token_hash = ?",
        )
        .bind(&profile.player_id)
        .bind(profile.identity_confirmed)
        .bind(profile.updated_at as i64)
        .bind(state_json)
        .bind(&profile.anonymous_id)
        .bind(token_hash.as_slice())
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        if result.rows_affected() != 1 {
            return Err(AppError::Unauthorized);
        }
        Ok(profile)
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

        self.load_daily_challenge(&candidate.challenge.date).await
    }

    pub async fn load_daily_challenge(&self, date: &str) -> Result<DailyChallenge, AppError> {
        let row: (i64, String, String, String) = sqlx::query_as(
            "SELECT round_number, player_id, player_snapshot_json, catalog_version
             FROM daily_challenges
             WHERE challenge_date = ?",
        )
        .bind(date)
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;
        let mut mystery_player: CatalogPlayer = serde_json::from_str(&row.2).map_err(|error| {
            error!(%error, date = %date, "stored daily player is invalid");
            AppError::Internal
        })?;
        let current_player = catalog_player_by_id(&row.1);
        let mut snapshot_changed = false;
        if mystery_player.normalize_team_for_display() {
            if let Some(current_player) = current_player {
                mystery_player.team = current_player.team.clone();
                mystery_player.team_logo_url = current_player.team_logo_url.clone();
            }
            snapshot_changed = true;
        }
        if mystery_player.image_url.is_none()
            && let Some(current_player) = current_player
            && current_player.image_url.is_some()
        {
            mystery_player.image_url = current_player.image_url.clone();
            snapshot_changed = true;
        }
        if snapshot_changed {
            let enriched_snapshot =
                serde_json::to_string(&mystery_player).map_err(|_| AppError::Internal)?;
            sqlx::query(
                "UPDATE daily_challenges
                 SET player_snapshot_json = ?
                 WHERE challenge_date = ? AND player_id = ?",
            )
            .bind(enriched_snapshot)
            .bind(date)
            .bind(&row.1)
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        }
        Ok(DailyChallenge {
            date: date.to_owned(),
            round_number: u16::try_from(row.0).map_err(|_| AppError::Internal)?,
            mystery_player_id: row.1,
            mystery_player,
            catalog_version: row.3,
        })
    }

    pub async fn start_daily_challenge_attempt(
        &self,
        anonymous_id: &str,
        sync_token: &str,
    ) -> Result<(DailyChallengeAttempt, bool), AppError> {
        self.load_profile(anonymous_id, sync_token).await?;
        let challenge = self.current_daily_challenge().await?;
        let created_at = unix_timestamp_millis();
        let deadline_unix_ms = created_at.saturating_add(DAILY_ROUND_SECONDS * 1_000);
        let insert = sqlx::query(
            "INSERT INTO daily_attempts (
                anonymous_id, challenge_date, deadline_unix_ms, created_at
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(anonymous_id, challenge_date) DO NOTHING",
        )
        .bind(anonymous_id)
        .bind(&challenge.date)
        .bind(deadline_unix_ms as i64)
        .bind(created_at as i64)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        let deadline_unix_ms: i64 = sqlx::query_scalar(
            "SELECT deadline_unix_ms
             FROM daily_attempts
             WHERE anonymous_id = ? AND challenge_date = ?",
        )
        .bind(anonymous_id)
        .bind(&challenge.date)
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)?;
        Ok((
            DailyChallengeAttempt::new(
                challenge,
                deadline_unix_ms
                    .try_into()
                    .map_err(|_| AppError::Internal)?,
            ),
            insert.rows_affected() == 1,
        ))
    }

    pub async fn daily_attempt_deadline(
        &self,
        anonymous_id: &str,
        challenge_date: &str,
    ) -> Result<u64, AppError> {
        let deadline: Option<i64> = sqlx::query_scalar(
            "SELECT deadline_unix_ms
             FROM daily_attempts
             WHERE anonymous_id = ? AND challenge_date = ?",
        )
        .bind(anonymous_id)
        .bind(challenge_date)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        deadline
            .ok_or_else(|| AppError::BadRequest("daily challenge was not started".to_owned()))?
            .try_into()
            .map_err(|_| AppError::Internal)
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

fn solo_player_matches_difficulty(player: &CatalogPlayer, difficulty: Difficulty) -> bool {
    match difficulty {
        Difficulty::Easy => player.major_wins > 0 || player.major_appearances >= 5,
        Difficulty::Full => player.major_appearances > 0,
        Difficulty::Hard => true,
    }
}

const fn difficulty_name(difficulty: Difficulty) -> &'static str {
    match difficulty {
        Difficulty::Easy => "easy",
        Difficulty::Full => "full",
        Difficulty::Hard => "hard",
    }
}

fn parse_difficulty(value: &str) -> Result<Difficulty, AppError> {
    match value {
        "easy" => Ok(Difficulty::Easy),
        "full" => Ok(Difficulty::Full),
        "hard" => Ok(Difficulty::Hard),
        _ => Err(AppError::Internal),
    }
}

fn unix_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
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
            pending_draw: None,
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

    #[tokio::test]
    async fn daily_challenge_repairs_a_legacy_undefined_team_without_changing_answer() {
        let path = std::env::temp_dir().join(format!("cs-guess-daily-{}.sqlite", Uuid::new_v4()));
        let mut config = Config::for_test();
        config.database_path = path.clone();
        let store = DatabaseStore::new(&config);
        store.initialize().await.unwrap();

        let candidate = DailyChallengeCandidate::current().unwrap();
        let mut legacy_player = candidate.challenge.mystery_player.clone();
        legacy_player.team = "undefined".to_owned();
        legacy_player.team_logo_url = Some("https://cdn.example/undefined.png".to_owned());
        let legacy_snapshot = serde_json::to_string(&legacy_player).unwrap();
        sqlx::query(
            "INSERT INTO daily_challenges (
                challenge_date, round_number, player_id, player_snapshot_json,
                catalog_version, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&candidate.challenge.date)
        .bind(i64::from(candidate.challenge.round_number))
        .bind(&candidate.challenge.mystery_player_id)
        .bind(legacy_snapshot)
        .bind("legacy-catalog")
        .bind(1_i64)
        .execute(&store.pool)
        .await
        .unwrap();

        let challenge = store.current_daily_challenge().await.unwrap();

        assert_eq!(
            challenge.mystery_player_id,
            candidate.challenge.mystery_player_id
        );
        assert_eq!(
            challenge.mystery_player.team,
            candidate.challenge.mystery_player.team
        );
        assert_eq!(
            challenge.mystery_player.team_logo_url,
            candidate.challenge.mystery_player.team_logo_url
        );
        let persisted: String = sqlx::query_scalar(
            "SELECT player_snapshot_json
             FROM daily_challenges
             WHERE challenge_date = ?",
        )
        .bind(&candidate.challenge.date)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        let persisted_player: CatalogPlayer = serde_json::from_str(&persisted).unwrap();
        assert_eq!(
            persisted_player.team,
            candidate.challenge.mystery_player.team
        );

        store.pool.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    }
    fn winning_round(round_id: &str) -> AuthoritativeRoundSettlement {
        crate::solo::SoloRound {
            round_id: round_id.to_owned(),
            round_number: 1,
            difficulty: Difficulty::Hard,
            mystery_player: catalog_player_by_id("donk").unwrap().clone(),
            deadline_unix_ms: u64::MAX,
            max_guesses: 8,
        }.settlement(vec!["donk".to_owned()], false, 1).unwrap()
    }

    #[tokio::test]
    async fn settlement_receipt_survives_eviction_restart_and_concurrent_retries() {
        let path = std::env::temp_dir().join(format!("cs-guess-ledger-{}.sqlite", Uuid::new_v4()));
        let mut config = Config::for_test();
        config.database_path = path.clone();
        let store = DatabaseStore::new(&config);
        store.initialize().await.unwrap();
        let profile = test_profile(200, "donk");
        let id = profile.anonymous_id.clone();
        let token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
        store.save_profile(profile.clone(), token).await.unwrap();
        let first = winning_round("solo:hard:first");
        store.settle_profile_round(&id, first.clone()).await.unwrap();
        let receipt = store.completed_profile_round(&id, token, &first.round_id).await.unwrap().unwrap();
        for index in 0..105 {
            store.settle_profile_round(&id, winning_round(&format!("solo:hard:{index}"))).await.unwrap();
        }
        let before = store.load_profile(&id, token).await.unwrap();
        assert!(!before.recorded_rounds.contains(&first.round_id));
        assert_eq!(before.match_history.len(), 50);
        store.pool.close().await;
        let restarted = DatabaseStore::new(&config);
        restarted.initialize().await.unwrap();
        let (left, right) = tokio::join!(
            restarted.settle_profile_round(&id, first.clone()),
            restarted.settle_profile_round(&id, first.clone()),
        );
        assert_eq!(left.unwrap(), before);
        assert_eq!(right.unwrap(), before);
        let replay = restarted.completed_profile_round(&id, token, &first.round_id).await.unwrap().unwrap();
        assert_eq!(replay.history_entry, receipt.history_entry);
        assert_eq!(replay.profile.draw_credits, profile.draw_credits + 106);
        assert_eq!(replay.profile.stats.wins, profile.stats.wins + 106);
        assert!(matches!(restarted.completed_profile_round(&id, "wrong_profile_token_abcdefghijklmnop", &first.round_id).await, Err(AppError::Unauthorized)));
        restarted.pool.close().await;
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn settlement_rolls_back_receipt_when_profile_write_fails() {
        let store = DatabaseStore::new(&Config::for_test());
        store.initialize().await.unwrap();
        let profile = test_profile(200, "donk");
        let id = profile.anonymous_id.clone();
        let token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
        store.save_profile(profile.clone(), token).await.unwrap();
        sqlx::raw_sql("CREATE TRIGGER reject_profile_write BEFORE UPDATE ON profiles BEGIN SELECT RAISE(ABORT, 'test failure'); END;").execute(&store.pool).await.unwrap();
        let settlement = winning_round("solo:hard:rollback");
        assert!(store.settle_profile_round(&id, settlement.clone()).await.is_err());
        assert!(store.completed_profile_round(&id, token, &settlement.round_id).await.unwrap().is_none());
        assert_eq!(store.load_profile(&id, token).await.unwrap(), profile);
        sqlx::query("DROP TRIGGER reject_profile_write").execute(&store.pool).await.unwrap();
        let saved = store.settle_profile_round(&id, settlement).await.unwrap();
        assert_eq!(saved.stats.wins, profile.stats.wins + 1);
    }

    #[tokio::test]
    async fn legacy_migration_preserves_known_results_and_seals_only_expired_unknown_rounds() {
        let store = DatabaseStore::new(&Config::for_test());
        store.initialize().await.unwrap();
        let token = "profile_sync_token_abcdefghijklmnopqrstuvwxyz";
        let mut profile = test_profile(200, "donk");
        let id = profile.anonymous_id.clone();
        let known = winning_round("solo:hard:known");
        profile.settle_round(known.clone()).unwrap();
        store.save_profile(profile.clone(), token).await.unwrap();
        for (round_id, deadline) in [("solo:hard:unknown", 1_i64), ("solo:hard:active", i64::MAX)] {
            sqlx::query("INSERT INTO solo_rounds VALUES (?, ?, 1, 'hard', 'donk', ?, 0)")
                .bind(round_id).bind(&id).bind(deadline).execute(&store.pool).await.unwrap();
        }
        sqlx::query("DELETE FROM settlement_migrations").execute(&store.pool).await.unwrap();
        store.initialize().await.unwrap();
        let receipt = store.completed_profile_round(&id, token, &known.round_id).await.unwrap().unwrap();
        assert_eq!(receipt.history_entry, profile.completion_response(&known.round_id).history_entry);
        assert!(matches!(store.completed_profile_round(&id, token, "solo:hard:unknown").await, Err(AppError::BadRequest(_))));
        assert!(store.completed_profile_round(&id, token, "solo:hard:active").await.unwrap().is_none());
        assert_eq!(store.load_profile(&id, token).await.unwrap(), profile);
        let rounds: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM solo_rounds").fetch_one(&store.pool).await.unwrap();
        assert_eq!(rounds, 2);
        // Rerunning initialization must not seal rounds created after the migration.
        sqlx::query("INSERT INTO solo_rounds VALUES ('solo:hard:new', ?, 1, 'hard', 'donk', 1, 0)")
            .bind(&id).execute(&store.pool).await.unwrap();
        store.initialize().await.unwrap();
        assert!(store.completed_profile_round(&id, token, "solo:hard:new").await.unwrap().is_none());
    }

}
