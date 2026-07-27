export const MAX_GUESSES = 8;

export type GameMode = "daily" | "quick" | "room";

export type GameStatus = "playing" | "won" | "lost";

export type OpponentVisibility = "hidden" | "open";
export type BestOf = 1 | 3 | 5;
export type PartySize = 2 | 4;

export type CountryRelation = "match" | "near" | "miss";

export interface CountryHint {
  relation: CountryRelation;
  distanceKm: number | null;
}

export interface OpponentGuessProgress {
  playerId?: string;
  guessedPlayerId: string | null;
  matchedFields: string[];
  countryRelation?: CountryRelation;
  countryDistanceKm?: number | null;
}
