import { players } from "@/data/players";
import {
  maxGuessesForDifficulty,
  type GameDifficulty,
  type GameStatus,
} from "@/types/game";

const SOLO_ROUND_SECONDS = 180;
const SOLO_PROGRESS_VERSION = 2;
const SOLO_ACTIVE_DIFFICULTY_KEY = "cs-guess:solo-progress:active";

export type SoloDifficulty = GameDifficulty;

export const SOLO_DIFFICULTIES = [
  {
    id: "easy",
    label: "简单",
    poolLabel: "知名选手",
    recommended: true,
  },
  {
    id: "full",
    label: "完整",
    poolLabel: "Major 参赛选手",
    recommended: false,
  },
  {
    id: "hard",
    label: "困难",
    poolLabel: "全部选手",
    recommended: false,
  },
] as const satisfies readonly {
  id: SoloDifficulty;
  label: string;
  poolLabel: string;
  recommended: boolean;
}[];

export function parseSoloDifficulty(value: string | null | undefined) {
  return value === "easy" || value === "full" || value === "hard"
    ? value
    : undefined;
}

const SOLO_DIFFICULTY_KEY = "cs-guess:solo-difficulty";

interface SoloStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function browserStorage(): SoloStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSoloDifficulty(
  storage: SoloStorage | undefined = browserStorage(),
): SoloDifficulty {
  return parseSoloDifficulty(storage?.getItem(SOLO_DIFFICULTY_KEY)) ?? "easy";
}

export function saveSoloDifficulty(
  difficulty: SoloDifficulty,
  storage: SoloStorage | undefined = browserStorage(),
) {
  storage?.setItem(SOLO_DIFFICULTY_KEY, difficulty);
}

const fullSoloMysteryPool = players.filter(
  (player) => player.majorAppearances > 0,
);

const easySoloMysteryPool = fullSoloMysteryPool.filter(
  (player) => player.majorWins > 0 || player.majorAppearances >= 5,
);

export function soloMysteryPool(difficulty: SoloDifficulty) {
  if (difficulty === "easy") return easySoloMysteryPool;
  if (difficulty === "full") return fullSoloMysteryPool;
  return players;
}

export interface SoloGameState {
  roundId: string;
  roundNumber: number;
  difficulty: SoloDifficulty;
  mysteryId: string;
  guessedIds: string[];
  status: GameStatus;
  resultReason?: "guessed" | "timeout" | "attempts-exhausted";
  deadline: number;
  resultDismissed: boolean;
}

export type SoloGameAction =
  | { type: "guess"; playerId: string }
  | { type: "expire" }
  | { type: "dismiss-result" }
  | { type: "restart" }
  | {
      type: "bind-server-round";
      round: {
        roundId: string;
        roundNumber: number;
        difficulty: SoloDifficulty;
        mysteryId: string;
        deadline: number;
      };
    };

function randomIndex(length: number) {
  if (length <= 1) return 0;
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0] % length;
}

export function createSoloRound(
  difficulty: SoloDifficulty,
  roundNumber = 1,
  previousMysteryId?: string,
  now = Date.now(),
): SoloGameState {
  const difficultyPool = soloMysteryPool(difficulty);
  const availableMysteries = difficultyPool.filter(
    (player) => player.id !== previousMysteryId,
  );
  const mysteryPool =
    availableMysteries.length > 0 ? availableMysteries : difficultyPool;
  const mysteryPlayer = mysteryPool[randomIndex(mysteryPool.length)];
  const roundToken = globalThis.crypto.randomUUID();

  return {
    roundId: `solo:${difficulty}:${roundToken}`,
    roundNumber,
    difficulty,
    mysteryId: mysteryPlayer.id,
    guessedIds: [],
    status: "playing",
    deadline: now + SOLO_ROUND_SECONDS * 1_000,
    resultDismissed: false,
  };
}

function soloProgressKey(difficulty: SoloDifficulty) {
  return `cs-guess:solo-progress:v${SOLO_PROGRESS_VERSION}:${difficulty}`;
}

function legacySoloProgressKey(difficulty: SoloDifficulty) {
  return `cs-guess:solo-progress:v1:${difficulty}`;
}

export interface LoadedSoloProgress {
  state: SoloGameState;
  resetReason?: "catalog-changed" | "progress-reset";
}

interface MigrationIssue {
  reason: NonNullable<LoadedSoloProgress["resetReason"]>;
  roundNumber?: number;
}

function migrateLegacySoloProgress(
  storage: SoloStorage,
  now: number,
): Map<SoloDifficulty, MigrationIssue> {
  const issues = new Map<SoloDifficulty, MigrationIssue>();
  for (const difficulty of ["easy", "full", "hard"] as const) {
    const maxGuesses = maxGuessesForDifficulty(difficulty);
    if (storage.getItem(soloProgressKey(difficulty))) continue;
    const legacyKey = legacySoloProgressKey(difficulty);
    const raw = storage.getItem(legacyKey);
    if (!raw) continue;

    try {
      const stored = JSON.parse(raw) as {
        version?: unknown;
        state?: Partial<SoloGameState>;
      };
      const state = stored.state;
      const roundNumber =
        typeof state?.roundNumber === "number" &&
        Number.isInteger(state.roundNumber) &&
        state.roundNumber > 0
          ? state.roundNumber
          : undefined;
      if (
        stored.version !== 1 ||
        !state ||
        state.difficulty !== difficulty ||
        typeof state.roundId !== "string" ||
        !state.roundId.startsWith(`solo:${difficulty}:`) ||
        !roundNumber ||
        typeof state.mysteryId !== "string" ||
        !Array.isArray(state.guessedIds) ||
        !state.guessedIds.every((id) => typeof id === "string") ||
        (state.status !== "playing" &&
          state.status !== "won" &&
          state.status !== "lost") ||
        typeof state.deadline !== "number" ||
        !Number.isFinite(state.deadline) ||
        typeof state.resultDismissed !== "boolean"
      ) {
        issues.set(difficulty, { reason: "progress-reset", roundNumber });
        continue;
      }
      const validMystery = soloMysteryPool(difficulty).some(
        ({ id }) => id === state.mysteryId,
      );
      const validGuesses = state.guessedIds.every((id) =>
        players.some((player) => player.id === id),
      );
      const uniqueGuesses =
        new Set(state.guessedIds).size === state.guessedIds.length;
      if (!validMystery || !validGuesses) {
        issues.set(difficulty, { reason: "catalog-changed", roundNumber });
        continue;
      }
      if (!uniqueGuesses || state.guessedIds.length > maxGuesses) {
        issues.set(difficulty, { reason: "progress-reset", roundNumber });
        continue;
      }
      const guessedMystery = state.guessedIds.includes(state.mysteryId);
      if (
        (state.status === "playing" &&
          (guessedMystery ||
            state.guessedIds.length >= maxGuesses ||
            state.resultDismissed)) ||
        (state.status === "won" && !guessedMystery) ||
        (state.status === "lost" && guessedMystery)
      ) {
        issues.set(difficulty, { reason: "progress-reset", roundNumber });
        continue;
      }

      let status = state.status;
      let resultReason: SoloGameState["resultReason"];
      if (status === "won") {
        resultReason = "guessed";
      } else if (status === "lost" && state.guessedIds.length >= maxGuesses) {
        resultReason = "attempts-exhausted";
      } else if (state.deadline <= now) {
        status = "lost";
        resultReason = "timeout";
      } else if (status === "lost") {
        issues.set(difficulty, { reason: "progress-reset", roundNumber });
        continue;
      }

      const migrated: SoloGameState = {
        roundId: state.roundId,
        roundNumber,
        difficulty,
        mysteryId: state.mysteryId,
        guessedIds: state.guessedIds,
        status,
        resultReason,
        deadline: state.deadline,
        resultDismissed: state.resultDismissed,
      };
      storage.setItem(
        soloProgressKey(difficulty),
        JSON.stringify({ version: SOLO_PROGRESS_VERSION, state: migrated }),
      );
      storage.removeItem?.(legacyKey);
    } catch {
      issues.set(difficulty, { reason: "progress-reset" });
    }
  }
  return issues;
}

export function saveSoloProgress(
  state: SoloGameState,
  storage: SoloStorage | undefined = browserStorage(),
) {
  if (!storage) return;
  storage.setItem(
    soloProgressKey(state.difficulty),
    JSON.stringify({ version: SOLO_PROGRESS_VERSION, state }),
  );
  storage.setItem(SOLO_ACTIVE_DIFFICULTY_KEY, state.difficulty);
}

export function prepareSoloRoundForPlay(
  difficulty: SoloDifficulty,
  storage: SoloStorage | undefined = browserStorage(),
  now = Date.now(),
) {
  const loaded = loadSoloProgress(difficulty, storage, now);
  const state =
    loaded.state.status === "playing"
      ? loaded.state
      : createSoloRound(
          difficulty,
          loaded.state.roundNumber + 1,
          loaded.state.mysteryId,
          now,
        );
  saveSoloProgress(state, storage);
  return state;
}

export function loadSoloProgress(
  difficulty: SoloDifficulty,
  storage: SoloStorage | undefined = browserStorage(),
  now = Date.now(),
): LoadedSoloProgress {
  try {
    const migrationIssues = storage
      ? migrateLegacySoloProgress(storage, now)
      : new Map<SoloDifficulty, MigrationIssue>();
    const migrationIssue = migrationIssues.get(difficulty);
    if (
      migrationIssue &&
      !storage?.getItem(soloProgressKey(difficulty))
    ) {
      const fallback = createSoloRound(
        difficulty,
        migrationIssue.roundNumber ?? 1,
        undefined,
        now,
      );
      storage?.setItem(
        soloProgressKey(difficulty),
        JSON.stringify({
          version: SOLO_PROGRESS_VERSION,
          state: fallback,
        }),
      );
      return {
        state: fallback,
        resetReason: migrationIssue.reason,
      };
    }
    if (storage?.getItem(SOLO_ACTIVE_DIFFICULTY_KEY) !== difficulty) {
      const previous = storage?.getItem(soloProgressKey(difficulty));
      let nextRoundNumber = 1;
      if (previous) {
        const parsed = JSON.parse(previous) as {
          version?: unknown;
          state?: { roundNumber?: unknown };
        };
        if (
          parsed.version === SOLO_PROGRESS_VERSION &&
          typeof parsed.state?.roundNumber === "number" &&
          Number.isInteger(parsed.state.roundNumber) &&
          parsed.state.roundNumber > 0
        ) {
          nextRoundNumber = parsed.state.roundNumber + 1;
        }
      }
      return {
        state: createSoloRound(
          difficulty,
          nextRoundNumber,
          undefined,
          now,
        ),
      };
    }
    const raw = storage.getItem(soloProgressKey(difficulty));
    if (!raw) return { state: createSoloRound(difficulty, 1, undefined, now) };
    const stored = JSON.parse(raw) as {
      version?: unknown;
      state?: Partial<SoloGameState>;
    };
    const state = stored.state;
    if (
      stored.version !== SOLO_PROGRESS_VERSION ||
      !state ||
      state.difficulty !== difficulty ||
      typeof state.roundId !== "string" ||
      typeof state.roundNumber !== "number" ||
      !Number.isInteger(state.roundNumber) ||
      state.roundNumber < 1 ||
      typeof state.mysteryId !== "string" ||
      !Array.isArray(state.guessedIds) ||
      !state.guessedIds.every((id) => typeof id === "string") ||
      (state.status !== "playing" &&
        state.status !== "won" &&
        state.status !== "lost") ||
      typeof state.deadline !== "number" ||
      typeof state.resultDismissed !== "boolean" ||
      (state.status === "playing" && state.resultReason !== undefined) ||
      (state.status === "won" && state.resultReason !== "guessed") ||
      (state.status === "lost" &&
        state.resultReason !== "timeout" &&
        state.resultReason !== "attempts-exhausted")
    ) {
      return { state: createSoloRound(difficulty, 1, undefined, now) };
    }
    const restored = state as SoloGameState;
    const validMystery = soloMysteryPool(difficulty).some(
      ({ id }) => id === restored.mysteryId,
    );
    const validGuesses = restored.guessedIds.every((id) =>
      players.some((player) => player.id === id),
    );
    if (!validMystery || !validGuesses) {
      return {
        state: createSoloRound(
          difficulty,
          restored.roundNumber,
          undefined,
          now,
        ),
        resetReason: "catalog-changed",
      };
    }
    const maxGuesses = maxGuessesForDifficulty(difficulty);
    const guessedMystery = restored.guessedIds.includes(restored.mysteryId);
    const uniqueGuesses =
      new Set(restored.guessedIds).size === restored.guessedIds.length;
    const invalidRoundState =
      !uniqueGuesses ||
      restored.guessedIds.length > maxGuesses ||
      (restored.status === "playing" &&
        (guessedMystery ||
          restored.guessedIds.length >= maxGuesses ||
          restored.resultDismissed)) ||
      (restored.status === "won" && !guessedMystery) ||
      (restored.status === "lost" && guessedMystery) ||
      (restored.status === "lost" &&
        restored.resultReason === "attempts-exhausted" &&
        restored.guessedIds.length < maxGuesses);
    if (invalidRoundState) {
      return {
        state: createSoloRound(
          difficulty,
          restored.roundNumber,
          undefined,
          now,
        ),
        resetReason: "progress-reset",
      };
    }
    return {
      state:
        restored.status === "playing" && restored.deadline <= now
          ? { ...restored, status: "lost", resultReason: "timeout" }
          : restored,
    };
  } catch {
    return { state: createSoloRound(difficulty, 1, undefined, now) };
  }
}

export function soloGameReducer(
  state: SoloGameState,
  action: SoloGameAction,
): SoloGameState {
  switch (action.type) {
    case "guess": {
      if (
        state.status !== "playing" ||
        state.guessedIds.includes(action.playerId)
      ) {
        return state;
      }
      const guessedIds = [...state.guessedIds, action.playerId];
      const maxGuesses = maxGuessesForDifficulty(state.difficulty);
      const status =
        action.playerId === state.mysteryId
          ? "won"
          : guessedIds.length >= maxGuesses
            ? "lost"
            : "playing";
      const resultReason =
        status === "won"
          ? "guessed"
          : status === "lost"
            ? "attempts-exhausted"
            : undefined;
      return { ...state, guessedIds, status, resultReason };
    }
    case "expire":
      return state.status === "playing"
        ? { ...state, status: "lost", resultReason: "timeout" }
        : state;
    case "dismiss-result":
      return state.status === "playing"
        ? state
        : { ...state, resultDismissed: true };
    case "restart":
      return createSoloRound(
        state.difficulty,
        state.roundNumber + 1,
        state.mysteryId,
      );
    case "bind-server-round":
      return action.round.roundId === state.roundId
        ? {
            ...state,
            ...action.round,
          }
        : {
            ...action.round,
            guessedIds: [],
            status: "playing",
            resultDismissed: false,
          };
  }
}

export function soloSecondsUntil(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}
