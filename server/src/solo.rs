use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{
    daily::{CatalogPlayer, catalog_player_by_id},
    error::AppError,
    profile::{AuthoritativeRoundSettlement, RoundRecordDetails},
    protocol::Difficulty,
};

pub const SOLO_ROUND_SECONDS: u64 = 180;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoloRound {
    pub round_id: String,
    pub round_number: u32,
    pub difficulty: Difficulty,
    pub mystery_player: CatalogPlayer,
    pub deadline_unix_ms: u64,
    pub max_guesses: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSoloRoundRequest {
    pub anonymous_id: String,
    pub difficulty: Difficulty,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteSoloRoundRequest {
    pub anonymous_id: String,
    #[serde(default)]
    pub guess_ids: Vec<String>,
    #[serde(default)]
    pub timed_out: bool,
}

impl SoloRound {
    pub(crate) fn settlement(
        &self,
        guess_ids: Vec<String>,
        timed_out: bool,
        now_unix_ms: u64,
    ) -> Result<AuthoritativeRoundSettlement, AppError> {
        if guess_ids.len() > self.max_guesses {
            return Err(AppError::BadRequest(
                "solo round has too many guesses".to_owned(),
            ));
        }
        let mut unique_guesses = HashSet::with_capacity(guess_ids.len());
        for guess_id in &guess_ids {
            if catalog_player_by_id(guess_id).is_none() {
                return Err(AppError::BadRequest(
                    "solo round contains an unknown guess".to_owned(),
                ));
            }
            if !unique_guesses.insert(guess_id) {
                return Err(AppError::BadRequest(
                    "solo round guesses must be unique".to_owned(),
                ));
            }
        }

        let winning_index = guess_ids
            .iter()
            .position(|guess_id| guess_id == &self.mystery_player.id);
        if winning_index.is_some_and(|index| index + 1 != guess_ids.len()) {
            return Err(AppError::BadRequest(
                "solo round cannot continue after the correct guess".to_owned(),
            ));
        }
        if timed_out && now_unix_ms < self.deadline_unix_ms {
            return Err(AppError::BadRequest(
                "solo round deadline has not elapsed".to_owned(),
            ));
        }
        let result = if now_unix_ms >= self.deadline_unix_ms {
            "loss"
        } else if winning_index.is_some() {
            "win"
        } else if guess_ids.len() == self.max_guesses {
            "loss"
        } else {
            return Err(AppError::BadRequest(
                "solo round is not finished".to_owned(),
            ));
        };

        Ok(AuthoritativeRoundSettlement {
            round_id: self.round_id.clone(),
            result: result.to_owned(),
            details: Some(RoundRecordDetails {
                mode: "solo".to_owned(),
                room_code: None,
                round_number: self.round_number,
                best_of: 1,
                answer_id: Some(self.mystery_player.id.clone()),
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
    use super::*;

    #[test]
    fn server_deadline_controls_both_timeout_flags() {
        let round = SoloRound {
            round_id: "solo:hard:deadline-test".to_owned(),
            round_number: 1,
            difficulty: Difficulty::Hard,
            mystery_player: catalog_player_by_id("donk").unwrap().clone(),
            deadline_unix_ms: 180_000,
            max_guesses: 8,
        };
        assert_eq!(
            round
                .settlement(vec!["donk".to_owned()], false, 179_999)
                .unwrap()
                .result,
            "win"
        );
        assert!(round.settlement(vec![], true, 179_999).is_err());
        for now in [180_000, 180_001] {
            for timed_out in [false, true] {
                assert_eq!(
                    round
                        .settlement(vec!["donk".to_owned()], timed_out, now)
                        .unwrap()
                        .result,
                    "loss"
                );
                assert_eq!(
                    round.settlement(vec![], timed_out, now).unwrap().result,
                    "loss"
                );
            }
        }
    }
}
