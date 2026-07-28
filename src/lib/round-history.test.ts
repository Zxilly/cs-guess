import { describe, expect, it } from "vitest";

import type {
  AnonymousStats,
  MatchHistoryEntry,
} from "@/hooks/use-anonymous-profile";
import { deriveRoundSummary } from "@/lib/round-history";

const EMPTY_STATS: AnonymousStats = {
  wins: 0,
  losses: 0,
  draws: 0,
  currentStreak: 0,
  bestStreak: 0,
};

function entry(
  result: MatchHistoryEntry["result"],
  guessCount: number,
): MatchHistoryEntry {
  return {
    id: `${result}-${guessCount}`,
    completedAt: "2026-07-28T01:02:03.000Z",
    result,
    mode: "daily",
    roundNumber: 1,
    bestOf: 1,
    answerId: "answer",
    guessIds: Array.from({ length: guessCount }, (_, index) => `g${index}`),
    opponentNames: [],
    selfScore: result === "win" ? 1 : 0,
    opponentScore: result === "loss" ? 1 : 0,
  };
}

describe("deriveRoundSummary", () => {
  it("keeps all first-round metrics unavailable", () => {
    expect(deriveRoundSummary(EMPTY_STATS, [])).toEqual({
      completedRounds: 0,
      winRate: 0,
      averageWinningGuesses: null,
      bestGuessCount: null,
      winningGuessSampleSize: 0,
    });
  });

  it("excludes zero-guess wins from guess metrics and reports the sample", () => {
    const stats = {
      ...EMPTY_STATS,
      wins: 3,
      currentStreak: 3,
      bestStreak: 3,
    };

    expect(
      deriveRoundSummary(stats, [
        entry("win", 0),
        entry("win", 2),
        entry("win", 4),
      ]),
    ).toEqual({
      completedRounds: 3,
      winRate: 100,
      averageWinningGuesses: 3,
      bestGuessCount: 2,
      winningGuessSampleSize: 2,
    });
  });
});
