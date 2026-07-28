/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  battleResultIdentityKey,
  markBattleResultViewed,
  wasBattleResultViewed,
} from "@/lib/battle-result-dismissal";

describe("battle result dismissal", () => {
  beforeEach(() => sessionStorage.clear());

  it("scopes viewed state to the room, round, and exact result", () => {
    const result = {
      roomCode: "CS-111111",
      roundNumber: 2,
      winnerPlayerId: "winner",
      finishReason: "solved",
      mysteryId: "donk",
    };
    markBattleResultViewed(result);

    expect(wasBattleResultViewed(result)).toBe(true);
    expect(
      wasBattleResultViewed({ ...result, roomCode: "CS-222222" }),
    ).toBe(false);
    expect(
      wasBattleResultViewed({ ...result, roundNumber: 3 }),
    ).toBe(false);
    expect(
      wasBattleResultViewed({ ...result, mysteryId: "m0nesy" }),
    ).toBe(false);
  });

  it("produces a stable key for the same result identity", () => {
    const result = {
      roomCode: "CS-123456",
      roundNumber: 1,
      finishReason: "member_left",
    };
    expect(battleResultIdentityKey(result)).toBe(
      battleResultIdentityKey({ ...result }),
    );
  });
});
