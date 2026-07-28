import { describe, expect, it } from "vitest";

import { players } from "@/data/players";
import {
  createSoloRound,
  loadSoloDifficulty,
  loadSoloProgress,
  parseSoloDifficulty,
  saveSoloDifficulty,
  saveSoloProgress,
  SOLO_DIFFICULTIES,
  soloGameReducer,
  soloMysteryPool,
} from "@/lib/solo-game";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  has(key: string) {
    return this.values.has(key);
  }
}

describe("solo difficulty pools", () => {
  it("keeps easy targets recognizable, full covers Major players, and hard covers the catalog", () => {
    const easy = soloMysteryPool("easy");
    const full = soloMysteryPool("full");
    const hard = soloMysteryPool("hard");

    expect(easy.length).toBeGreaterThan(0);
    expect(easy.length).toBeLessThan(full.length);
    expect(full.length).toBeLessThan(hard.length);
    expect(
      easy.every(
        (player) => player.majorWins > 0 || player.majorAppearances >= 5,
      ),
    ).toBe(true);
    expect(full.every((player) => player.majorAppearances > 0)).toBe(true);
    expect(hard).toHaveLength(players.length);
  });

  it("keeps the selected difficulty when starting the next round", () => {
    const first = createSoloRound("easy");
    const next = soloGameReducer(
      { ...first, status: "won" },
      { type: "restart" },
    );
    const easyIds = new Set(soloMysteryPool("easy").map((player) => player.id));

    expect(first.difficulty).toBe("easy");
    expect(easyIds.has(first.mysteryId)).toBe(true);
    expect(next.difficulty).toBe("easy");
    expect(next.roundNumber).toBe(2);
    expect(easyIds.has(next.mysteryId)).toBe(true);
  });

  it("exposes easy as the recommended safe route default", () => {
    expect(SOLO_DIFFICULTIES.map((option) => option.id)).toEqual([
      "easy",
      "full",
      "hard",
    ]);
    expect(SOLO_DIFFICULTIES.find((option) => option.recommended)?.id).toBe(
      "easy",
    );
    expect(parseSoloDifficulty("full")).toBe("full");
    expect(parseSoloDifficulty("hard")).toBe("hard");
    expect(parseSoloDifficulty("unknown")).toBeUndefined();
  });

  it("remembers the last selected difficulty", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadSoloDifficulty(storage)).toBe("easy");
    saveSoloDifficulty("full", storage);
    expect(loadSoloDifficulty(storage)).toBe("full");
  });
});

describe("solo progress persistence", () => {
  it("migrates an active v1 playing round without resetting it", () => {
    const storage = new MemoryStorage();
    const legacyState = {
      roundId: "solo:easy:v1-playing",
      roundNumber: 6,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 50_000,
      resultDismissed: false,
    };
    storage.setItem("cs-guess:solo-progress:active", "easy");
    storage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({ version: 1, state: legacyState }),
    );
    const legacyFull = {
      ...legacyState,
      roundId: "solo:full:v1-playing",
      difficulty: "full" as const,
      mysteryId: soloMysteryPool("full")[0].id,
    };
    storage.setItem(
      "cs-guess:solo-progress:v1:full",
      JSON.stringify({ version: 1, state: legacyFull }),
    );

    const loaded = loadSoloProgress("easy", storage, 10_000);
    const loadedAgain = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state).toEqual(legacyState);
    expect(loadedAgain.state).toEqual(legacyState);
    expect(storage.has("cs-guess:solo-progress:v2:easy")).toBe(true);
    expect(storage.has("cs-guess:solo-progress:v1:easy")).toBe(false);
    expect(storage.has("cs-guess:solo-progress:v2:full")).toBe(true);
    expect(storage.has("cs-guess:solo-progress:v1:full")).toBe(false);
  });

  it("infers a migrated v1 win as a guessed result", () => {
    const storage = new MemoryStorage();
    const mysteryId = soloMysteryPool("easy")[0].id;
    const legacyState = {
      roundId: "solo:easy:v1-won",
      roundNumber: 7,
      difficulty: "easy" as const,
      mysteryId,
      guessedIds: [mysteryId],
      status: "won" as const,
      deadline: 50_000,
      resultDismissed: true,
    };
    storage.setItem("cs-guess:solo-progress:active", "easy");
    storage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({ version: 1, state: legacyState }),
    );

    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state.status).toBe("won");
    expect(loaded.state.resultReason).toBe("guessed");
    expect(loaded.state.resultDismissed).toBe(true);
    expect(loaded.state.roundId).toBe(legacyState.roundId);
  });

  it("infers a migrated v1 loss with eight guesses as exhausted", () => {
    const storage = new MemoryStorage();
    const legacyState = {
      roundId: "solo:hard:v1-exhausted",
      roundNumber: 3,
      difficulty: "hard" as const,
      mysteryId: soloMysteryPool("hard")[20].id,
      guessedIds: players.slice(0, 8).map(({ id }) => id),
      status: "lost" as const,
      deadline: 50_000,
      resultDismissed: false,
    };
    storage.setItem("cs-guess:solo-progress:active", "hard");
    storage.setItem(
      "cs-guess:solo-progress:v1:hard",
      JSON.stringify({ version: 1, state: legacyState }),
    );

    const loaded = loadSoloProgress("hard", storage, 10_000);

    expect(loaded.state.status).toBe("lost");
    expect(loaded.state.resultReason).toBe("attempts-exhausted");
    expect(loaded.state.guessedIds).toHaveLength(8);
  });

  it("infers a migrated expired v1 loss as a timeout", () => {
    const storage = new MemoryStorage();
    const legacyState = {
      roundId: "solo:easy:v1-timeout",
      roundNumber: 8,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "lost" as const,
      deadline: 5_000,
      resultDismissed: false,
    };
    storage.setItem("cs-guess:solo-progress:active", "easy");
    storage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({ version: 1, state: legacyState }),
    );

    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state.status).toBe("lost");
    expect(loaded.state.resultReason).toBe("timeout");
    expect(loaded.state.deadline).toBe(5_000);
  });

  it("safely resets corrupt or ambiguous v1 progress without deleting it", () => {
    const corruptStorage = new MemoryStorage();
    corruptStorage.setItem("cs-guess:solo-progress:active", "easy");
    corruptStorage.setItem("cs-guess:solo-progress:v1:easy", "{broken");

    const corrupt = loadSoloProgress("easy", corruptStorage, 10_000);
    const corruptAgain = loadSoloProgress(
      "easy",
      corruptStorage,
      20_000,
    );

    expect(corrupt.resetReason).toBe("progress-reset");
    expect(corruptAgain.state.roundId).toBe(corrupt.state.roundId);
    expect(corruptAgain.state.mysteryId).toBe(corrupt.state.mysteryId);
    expect(corruptAgain.state.deadline).toBe(corrupt.state.deadline);
    expect(corruptStorage.has("cs-guess:solo-progress:v1:easy")).toBe(
      true,
    );
    expect(corruptStorage.has("cs-guess:solo-progress:v2:easy")).toBe(
      true,
    );

    const ambiguousStorage = new MemoryStorage();
    const ambiguousState = {
      roundId: "solo:easy:v1-ambiguous",
      roundNumber: 9,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "lost" as const,
      deadline: 50_000,
      resultDismissed: false,
    };
    ambiguousStorage.setItem("cs-guess:solo-progress:active", "easy");
    ambiguousStorage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({ version: 1, state: ambiguousState }),
    );

    const ambiguous = loadSoloProgress("easy", ambiguousStorage, 10_000);

    expect(ambiguous.resetReason).toBe("progress-reset");
    expect(ambiguous.state.roundNumber).toBe(9);
    expect(ambiguousStorage.has("cs-guess:solo-progress:v1:easy")).toBe(
      true,
    );
  });

  it("keeps an existing v2 partition ahead of legacy v1", () => {
    const storage = new MemoryStorage();
    const v2State = {
      roundId: "solo:easy:v2-wins",
      roundNumber: 10,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 50_000,
      resultDismissed: false,
    };
    saveSoloProgress(v2State, storage);
    storage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({
        version: 1,
        state: { ...v2State, roundId: "solo:easy:legacy" },
      }),
    );

    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state).toEqual(v2State);
    expect(storage.has("cs-guess:solo-progress:v1:easy")).toBe(true);
  });

  it("restores the full active round when refreshing the same difficulty", () => {
    const storage = new MemoryStorage();
    const mysteryId = soloMysteryPool("easy")[0].id;
    const progress = {
      roundId: "solo:easy:persisted",
      roundNumber: 4,
      difficulty: "easy" as const,
      mysteryId,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 50_000,
      resultDismissed: false,
    };

    saveSoloProgress(progress, storage);
    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state).toEqual(progress);
    expect(loaded.resetReason).toBeUndefined();
  });

  it("expires a restored round without resetting its absolute deadline", () => {
    const storage = new MemoryStorage();
    const progress = {
      roundId: "solo:easy:expired",
      roundNumber: 2,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 5_000,
      resultDismissed: false,
    };

    saveSoloProgress(progress, storage);
    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state.status).toBe("lost");
    expect(loaded.state.resultReason).toBe("timeout");
    expect(loaded.state.deadline).toBe(5_000);
    expect(loaded.state.guessedIds).toEqual(progress.guessedIds);
  });

  it("keeps a dismissed finished result closed across refresh", () => {
    const storage = new MemoryStorage();
    const progress = {
      roundId: "solo:easy:dismissed",
      roundNumber: 3,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "lost" as const,
      resultReason: "timeout" as const,
      deadline: 5_000,
      resultDismissed: true,
    };

    saveSoloProgress(progress, storage);
    const loaded = loadSoloProgress("easy", storage, 10_000);

    expect(loaded.state.status).toBe("lost");
    expect(loaded.state.resultDismissed).toBe(true);
    expect(loaded.state.roundId).toBe(progress.roundId);
  });

  it("starts the next partitioned round when switching difficulty", () => {
    const storage = new MemoryStorage();
    const previousHard = {
      roundId: "solo:hard:previous",
      roundNumber: 2,
      difficulty: "hard" as const,
      mysteryId: soloMysteryPool("hard")[0].id,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 20_000,
      resultDismissed: false,
    };
    saveSoloProgress(previousHard, storage);
    saveSoloProgress(
      {
        ...previousHard,
        roundId: "solo:easy:active",
        difficulty: "easy",
        mysteryId: soloMysteryPool("easy")[0].id,
      },
      storage,
    );

    const loaded = loadSoloProgress("hard", storage, 10_000);

    expect(loaded.state.difficulty).toBe("hard");
    expect(loaded.state.roundNumber).toBe(3);
    expect(loaded.state.roundId).not.toBe(previousHard.roundId);
    expect(loaded.state.guessedIds).toEqual([]);
    expect(loaded.state.deadline).toBe(190_000);
  });

  it("safely resets an active round when catalog IDs are no longer valid", () => {
    const storage = new MemoryStorage();
    const progress = {
      roundId: "solo:easy:stale-catalog",
      roundNumber: 5,
      difficulty: "easy" as const,
      mysteryId: soloMysteryPool("easy")[0].id,
      guessedIds: [players[0].id],
      status: "playing" as const,
      deadline: 50_000,
      resultDismissed: false,
    };
    saveSoloProgress(progress, storage);
    storage.setItem(
      "cs-guess:solo-progress:v2:easy",
      JSON.stringify({
        version: 2,
        state: {
          ...progress,
          mysteryId: "removed-mystery",
          guessedIds: ["removed-guess"],
        },
      }),
    );

    const loaded = loadSoloProgress("easy", storage, 10_000);
    const easyIds = new Set(soloMysteryPool("easy").map(({ id }) => id));

    expect(loaded.resetReason).toBe("catalog-changed");
    expect(loaded.state.roundNumber).toBe(5);
    expect(easyIds.has(loaded.state.mysteryId)).toBe(true);
    expect(loaded.state.guessedIds).toEqual([]);
    expect(loaded.state.deadline).toBe(190_000);
  });
});
