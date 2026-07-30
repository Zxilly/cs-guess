export const MAX_GUESSES = 8;
export const HARD_MAX_GUESSES = 10;

export type GameMode = "daily" | "solo" | "quick" | "room";

export type GameStatus = "playing" | "won" | "lost";

export type OpponentVisibility = "hidden" | "open";

export type BattleFinishReason =
  | "solved"
  | "disconnect_forfeit"
  | "member_left"
  | "timeout"
  | "max_guesses";
export type BattleSeriesStatus = "active" | "completed" | "abandoned";
export type BattleSeriesFinishReason =
  | "score_limit"
  | "member_left_forfeit"
  | "member_left_abandoned";
export type GameDifficulty = "easy" | "full" | "hard";
export type BestOf = 1 | 3 | 5;
export type PartySize = 2 | 4;

export function maxGuessesForDifficulty(difficulty: GameDifficulty) {
  return difficulty === "hard" ? HARD_MAX_GUESSES : MAX_GUESSES;
}

export type CountryRelation = "match" | "near" | "miss";
export type TeamRelation =
  | "match"
  | "target_history"
  | "guess_history"
  | "shared_history"
  | "miss";

export interface CountryHint {
  relation: CountryRelation;
  distanceKm: number | null;
}

export interface OpponentGuessProgress {
  playerId?: string;
  guessedPlayerId: string | null;
  matchedFields: string[];
  teamRelation?: TeamRelation;
  countryRelation?: CountryRelation;
  countryDistanceKm?: number | null;
}
