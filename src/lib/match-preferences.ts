import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
  PartySize,
} from "@/types/game";

const QUICK_MATCH_PREFERENCES_KEY = "cs-guess:quick-match-preferences:v1";
const ROOM_PREFERENCES_KEY = "cs-guess:room-preferences:v1";

interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface QuickMatchPreferences {
  partySize: PartySize;
  bestOf: BestOf;
  difficulty: GameDifficulty;
  visibility: OpponentVisibility;
}

export interface RoomPreferences {
  bestOf: BestOf;
  difficulty: GameDifficulty;
  visibility: OpponentVisibility;
  maxPlayers: PartySize;
}

function browserStorage(): PreferencesStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isBestOf(value: unknown): value is BestOf {
  return value === 1 || value === 3 || value === 5;
}

function isDifficulty(value: unknown): value is GameDifficulty {
  return value === "easy" || value === "full" || value === "hard";
}

function isVisibility(value: unknown): value is OpponentVisibility {
  return value === "hidden" || value === "open";
}

function readJson(
  key: string,
  storage: PreferencesStorage | undefined,
): Record<string, unknown> | undefined {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function loadQuickMatchPreferences(
  storage: PreferencesStorage | undefined = browserStorage(),
): QuickMatchPreferences | undefined {
  const value = readJson(QUICK_MATCH_PREFERENCES_KEY, storage);
  if (
    !value ||
    (value.partySize !== 2 && value.partySize !== 4) ||
    !isBestOf(value.bestOf) ||
    !isDifficulty(value.difficulty) ||
    !isVisibility(value.visibility)
  ) {
    return undefined;
  }
  return {
    partySize: value.partySize,
    bestOf: value.bestOf,
    difficulty: value.difficulty,
    visibility: value.visibility,
  };
}

export function saveQuickMatchPreferences(
  preferences: QuickMatchPreferences,
  storage: PreferencesStorage | undefined = browserStorage(),
) {
  storage?.setItem(
    QUICK_MATCH_PREFERENCES_KEY,
    JSON.stringify(preferences),
  );
}

export function loadRoomPreferences(
  storage: PreferencesStorage | undefined = browserStorage(),
): RoomPreferences | undefined {
  const value = readJson(ROOM_PREFERENCES_KEY, storage);
  if (
    !value ||
    !isBestOf(value.bestOf) ||
    !isDifficulty(value.difficulty) ||
    !isVisibility(value.visibility) ||
    (value.maxPlayers !== 2 && value.maxPlayers !== 4)
  ) {
    return undefined;
  }
  return {
    bestOf: value.bestOf,
    difficulty: value.difficulty,
    visibility: value.visibility,
    maxPlayers: value.maxPlayers,
  };
}

export function saveRoomPreferences(
  preferences: RoomPreferences,
  storage: PreferencesStorage | undefined = browserStorage(),
) {
  storage?.setItem(ROOM_PREFERENCES_KEY, JSON.stringify(preferences));
}
