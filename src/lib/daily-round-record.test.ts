import { describe, expect, it, vi } from "vitest";

import { recordFinishedDailyRoundOnce } from "@/lib/daily-round-record";

const challenge = {
  date: "2026-07-28",
  roundNumber: 209,
  mysteryPlayerId: "answer",
  mysteryPlayer: {
    id: "answer",
    nickname: "answer",
    name: "Daily Answer",
    team: "无队伍",
    nationality: "Poland",
    countryCode: "PL",
    age: 27,
    role: "Entry" as const,
    majorAppearances: 0,
    majorWins: 0,
  },
  catalogVersion: "catalog",
};

describe("daily round recording", () => {
  it("records a timed-out daily loss even with zero guesses", () => {
    const recordRound = vi.fn();

    const recordedId = recordFinishedDailyRoundOnce(
      undefined,
      {
        date: challenge.date,
        deadline: 1,
        guessedIds: [],
        status: "lost",
      },
      challenge,
      recordRound,
    );

    expect(recordedId).toBe("daily:2026-07-28");
    expect(recordRound).toHaveBeenCalledWith(
      "daily:2026-07-28",
      "loss",
      expect.objectContaining({
        mode: "daily",
        answerId: "answer",
        guessIds: [],
        selfScore: 0,
        opponentScore: 1,
      }),
    );
  });

  it("does not record the same finished daily round twice", () => {
    const recordRound = vi.fn();
    const progress = {
      date: challenge.date,
      deadline: 1,
      guessedIds: [],
      status: "lost" as const,
    };

    const recordedId = recordFinishedDailyRoundOnce(
      undefined,
      progress,
      challenge,
      recordRound,
    );
    recordFinishedDailyRoundOnce(
      recordedId,
      progress,
      challenge,
      recordRound,
    );

    expect(recordRound).toHaveBeenCalledOnce();
  });
});
