import { describe, expect, it, vi } from "vitest";

import { recordFinishedSoloRoundOnce } from "@/lib/solo-round-record";
import type { SoloGameState } from "@/lib/solo-game";

const finishedRound: SoloGameState = {
  roundId: "solo:easy:persisted-result",
  roundNumber: 4,
  difficulty: "easy",
  mysteryId: "answer",
  guessedIds: ["guess"],
  status: "lost",
  deadline: 10_000,
  resultDismissed: true,
};

describe("solo round recording", () => {
  it("does not record a persisted result again after refresh", () => {
    const recordRound = vi.fn();

    const recordedId = recordFinishedSoloRoundOnce(
      undefined,
      [finishedRound.roundId],
      finishedRound,
      recordRound,
    );

    expect(recordedId).toBe(finishedRound.roundId);
    expect(recordRound).not.toHaveBeenCalled();
  });

  it("records a new finished round once with its persisted identity", () => {
    const recordRound = vi.fn();

    const recordedId = recordFinishedSoloRoundOnce(
      undefined,
      [],
      finishedRound,
      recordRound,
    );
    recordFinishedSoloRoundOnce(
      recordedId,
      [],
      finishedRound,
      recordRound,
    );

    expect(recordRound).toHaveBeenCalledOnce();
    expect(recordRound).toHaveBeenCalledWith(
      finishedRound.roundId,
      "loss",
      expect.objectContaining({
        mode: "solo",
        roundNumber: 4,
        answerId: "answer",
        guessIds: ["guess"],
      }),
    );
  });
});
