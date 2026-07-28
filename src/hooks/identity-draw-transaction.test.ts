import { beforeEach, describe, expect, it, vi } from "vitest";

import { players } from "@/data/players";
import { PROFILE_KEY } from "@/lib/identity-profile";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage unavailable");
    this.values.set(key, value);
  }
}

const commonPlayers = players.filter(
  (player) =>
    player.majorAppearances >= 1 &&
    player.majorAppearances <= 4 &&
    player.majorWins === 0,
);
const currentPlayer = commonPlayers[0];
const firstWinner = commonPlayers[1];
const secondWinner = commonPlayers[2];

function profile(drawCredits = 2) {
  return {
    version: 8,
    anonymousId: "anonymous-identity-draw-test",
    syncToken: "profile_sync_token_abcdefghijklmnopqrstuvwxyz",
    playerId: currentPlayer.id,
    identityConfirmed: true,
    stats: {
      wins: 10,
      losses: 2,
      draws: 0,
      currentStreak: 2,
      bestStreak: 2,
    },
    drawCredits,
    lossesTowardCredit: 0,
    recordedRounds: [],
    matchHistory: [],
    updatedAt: 100,
  };
}

function pending(winnerId: string, createdAt: number) {
  return {
    poolId: "common" as const,
    itemIds: Array.from({ length: 29 }, () => winnerId),
    winnerId,
    winnerIndex: 23,
    createdAt,
  };
}

describe("identity draw transactions", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify(profile()));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  it("rejects a stale-tab spend after another tab used the final credit", async () => {
    const { spendDrawCreditAtomically } = await import(
      "@/hooks/use-anonymous-profile"
    );
    storage.setItem(PROFILE_KEY, JSON.stringify(profile(0)));

    expect(
      spendDrawCreditAtomically(
        "common",
        pending(firstWinner.id, 101),
      ),
    ).toBe(false);
    expect(JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}").drawCredits).toBe(
      0,
    );
  });

  it("hydrates a newer remote profile before charging an outdated local credit", async () => {
    const remote = profile(0);
    const { version: _version, syncToken: _syncToken, ...serverProfile } = {
      ...remote,
      updatedAt: 200,
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(serverProfile), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { spendDrawCreditSafely } = await import(
      "@/hooks/use-anonymous-profile"
    );

    await expect(
      spendDrawCreditSafely(
        "common",
        pending(firstWinner.id, 201),
      ),
    ).resolves.toBe(false);
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.drawCredits).toBe(0);
    expect(stored.pendingDraw).toBeUndefined();
  });

  it("persists the paid result and replaces it only for an authorized reroll", async () => {
    const { spendDrawCreditAtomically } = await import(
      "@/hooks/use-anonymous-profile"
    );
    const first = pending(firstWinner.id, 101);
    const second = pending(secondWinner.id, 102);

    expect(spendDrawCreditAtomically("common", first)).toBe(true);
    let stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.drawCredits).toBe(1);
    expect(stored.pendingDraw).toEqual(first);

    expect(spendDrawCreditAtomically("common", second)).toBe(false);
    stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.drawCredits).toBe(1);
    expect(stored.pendingDraw).toEqual(first);

    expect(
      spendDrawCreditAtomically("common", second, first.winnerId),
    ).toBe(true);
    stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.drawCredits).toBe(0);
    expect(stored.pendingDraw).toEqual(second);
  });

  it("keeps the pending result when adoption fails and clears it on success", async () => {
    const {
      adoptPendingIdentityDraw,
      spendDrawCreditAtomically,
    } = await import("@/hooks/use-anonymous-profile");
    const draw = pending(firstWinner.id, 101);
    expect(spendDrawCreditAtomically("common", draw)).toBe(true);

    expect(
      adoptPendingIdentityDraw("common", secondWinner.id),
    ).toBe(false);
    expect(
      JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}").pendingDraw,
    ).toEqual(draw);

    storage.failWrites = true;
    expect(
      adoptPendingIdentityDraw("common", firstWinner.id),
    ).toBe(false);
    storage.failWrites = false;
    expect(
      JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}").pendingDraw,
    ).toEqual(draw);

    expect(
      adoptPendingIdentityDraw("common", firstWinner.id),
    ).toBe(true);
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.playerId).toBe(firstWinner.id);
    expect(stored.pendingDraw).toBeUndefined();
  });
});
