import { describe, expect, it } from "vitest";

import {
  readRematchState,
  rematchPendingNames,
  rematchSecondsLeft,
  rematchStatusCopy,
} from "@/lib/rematch";

describe("rematch state", () => {
  const snapshot = {
    rematch: {
      invitation_id: "invite-1",
      requester_player_id: "player-1",
      status: "pending",
      expires_at_unix_ms: 21_000,
      responses: [
        {
          player_id: "player-1",
          display_name: "DANK1NG",
          decision: "accepted",
        },
        {
          player_id: "player-2",
          display_name: "ZywOo",
          decision: "pending",
        },
      ],
    },
  };

  it("reads an authoritative pending invitation", () => {
    const rematch = readRematchState(snapshot);

    expect(rematch).not.toBeNull();
    expect(rematch?.requesterPlayerId).toBe("player-1");
    expect(rematch ? rematchPendingNames(rematch) : []).toEqual(["ZywOo"]);
    expect(rematch ? rematchSecondsLeft(rematch, 10_100) : -1).toBe(11);
  });

  it("rejects incomplete or unknown rematch states", () => {
    expect(
      readRematchState({
        rematch: { ...snapshot.rematch, status: "unknown" },
      }),
    ).toBeNull();
    expect(readRematchState({ rematch: null })).toBeNull();
  });

  it("provides distinct terminal feedback", () => {
    expect(rematchStatusCopy("declined").title).toContain("拒绝");
    expect(rematchStatusCopy("expired").title).toContain("超时");
    expect(rematchStatusCopy("opponent_offline").title).toContain("离线");
  });
});
