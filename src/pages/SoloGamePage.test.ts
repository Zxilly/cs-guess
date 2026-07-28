import { describe, expect, it } from "vitest";

import {
  soloGameReducer,
  type SoloGameState,
} from "@/lib/solo-game";

function playingState(): SoloGameState {
  return {
    roundId: "solo:test",
    roundNumber: 1,
    difficulty: "easy",
    mysteryId: "answer",
    guessedIds: [],
    status: "playing",
    deadline: Date.now() + 180_000,
    resultDismissed: false,
  };
}

describe("soloGameReducer", () => {
  it("wins immediately when the mystery player is guessed", () => {
    const next = soloGameReducer(playingState(), {
      type: "guess",
      playerId: "answer",
    });

    expect(next.status).toBe("won");
    expect(next.resultReason).toBe("guessed");
    expect(next.guessedIds).toEqual(["answer"]);
  });

  it("ends after eight incorrect guesses", () => {
    const next = Array.from({ length: 8 }, (_, index) => `wrong-${index}`)
      .reduce(
        (state, playerId) =>
          soloGameReducer(state, { type: "guess", playerId }),
        playingState(),
      );

    expect(next.status).toBe("lost");
    expect(next.resultReason).toBe("attempts-exhausted");
    expect(next.guessedIds).toHaveLength(8);
  });

  it("marks a timer expiry separately from exhausted guesses", () => {
    const next = soloGameReducer(playingState(), { type: "expire" });

    expect(next.status).toBe("lost");
    expect(next.resultReason).toBe("timeout");
  });

  it("starts a clean next round", () => {
    const finished = {
      ...playingState(),
      guessedIds: ["answer"],
      status: "won" as const,
    };
    const next = soloGameReducer(finished, { type: "restart" });

    expect(next.roundNumber).toBe(2);
    expect(next.roundId).not.toBe(finished.roundId);
    expect(next.guessedIds).toEqual([]);
    expect(next.status).toBe("playing");
    expect(next.resultDismissed).toBe(false);
  });

  it("keeps a dismissed result closed until the next round", () => {
    const finished = {
      ...playingState(),
      status: "lost" as const,
    };

    const dismissed = soloGameReducer(finished, {
      type: "dismiss-result",
    });

    expect(dismissed.resultDismissed).toBe(true);
  });
});
