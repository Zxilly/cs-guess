import { describe, expect, it } from "vitest";

import { currentRoundHistory } from "@/lib/live-round";
import type { ServerEvent } from "@/lib/realtime";

describe("currentRoundHistory", () => {
  it("drops snapshot guesses when a newer round starts", () => {
    const snapshot = {
      round_number: 1,
      own_guesses: [{ player_id: "old-guess" }],
      opponent_progress: [{ player_id: "opponent", guess_number: 1 }],
    };
    const events: ServerEvent[] = [
      { type: "round_started", seq: 11, round_number: 2 },
      {
        type: "guess_accepted",
        seq: 12,
        player_id: "new-guess",
      },
    ];

    const history = currentRoundHistory(snapshot, events);

    expect(history.ownGuessEvents).toEqual([events[1]]);
    expect(history.opponentEvents).toEqual([]);
  });

  it("keeps snapshot history while reconnecting into the same round", () => {
    const ownGuess = { player_id: "existing-guess" };
    const snapshot = {
      round_number: 2,
      own_guesses: [ownGuess],
      opponent_progress: [],
    };

    expect(currentRoundHistory(snapshot, []).ownGuessEvents).toEqual([
      ownGuess,
    ]);
  });
});
