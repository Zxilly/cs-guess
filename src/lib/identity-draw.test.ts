import { describe, expect, it } from "vitest";

import type { Player } from "@/data/players";
import {
  reconcilePendingIdentityDraw,
  restorePreparedIdentityDraw,
} from "@/lib/identity-draw";

function player(id: string): Player {
  return {
    id,
    nickname: id,
    name: id,
    countryCode: "CN",
    nationality: "China",
    age: 24,
    team: "Test",
    role: "Rifler",
    majorAppearances: 1,
    majorWins: 0,
  };
}

describe("identity draw persistence", () => {
  it("restores the exact paid sequence after a refresh", () => {
    const winner = player("winner");
    const items = Array.from({ length: 29 }, () => winner.id);

    const restored = restorePreparedIdentityDraw(
      {
        itemIds: items,
        winnerId: winner.id,
        winnerIndex: 23,
      },
      [winner],
    );

    expect(restored?.winner).toBe(winner);
    expect(restored?.items.map((item) => item.id)).toEqual(items);
    expect(restored?.winnerIndex).toBe(23);
  });

  it("closes an open stale result when another tab clears pending", () => {
    const winner = player("winner");
    const current = {
      poolId: "common",
      items: Array.from({ length: 29 }, () => winner),
      winner,
      winnerIndex: 23,
    };

    expect(
      reconcilePendingIdentityDraw(current, undefined, [winner]),
    ).toEqual({ action: "close" });
  });

  it("keeps an active roll when a profile update still carries its exact pending", () => {
    const winner = player("winner");
    const items = Array.from({ length: 29 }, () => winner);
    const current = {
      poolId: "common",
      items,
      winner,
      winnerIndex: 23,
    };

    expect(
      reconcilePendingIdentityDraw(
        current,
        {
          poolId: "common",
          itemIds: items.map((item) => item.id),
          winnerId: winner.id,
          winnerIndex: 23,
        },
        [winner],
      ),
    ).toEqual({ action: "keep" });
  });

  it("replaces an open stale result with the latest pending from another tab", () => {
    const firstWinner = player("first");
    const latestWinner = player("latest");
    const current = {
      poolId: "common",
      items: Array.from({ length: 29 }, () => firstWinner),
      winner: firstWinner,
      winnerIndex: 23,
    };
    const latestPending = {
      poolId: "advanced",
      itemIds: Array.from({ length: 29 }, () => latestWinner.id),
      winnerId: latestWinner.id,
      winnerIndex: 23,
    };

    const reconciliation = reconcilePendingIdentityDraw(
      current,
      latestPending,
      [firstWinner, latestWinner],
    );

    expect(reconciliation.action).toBe("restore");
    if (reconciliation.action !== "restore") return;
    expect(reconciliation.draw.poolId).toBe("advanced");
    expect(reconciliation.draw.winner).toBe(latestWinner);
    expect(reconciliation.draw.items).toHaveLength(29);
  });
});
