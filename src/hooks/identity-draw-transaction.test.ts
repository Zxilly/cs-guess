import { beforeEach, describe, expect, it, vi } from "vitest";

import { players } from "@/data/players";
import { PROFILE_KEY } from "@/lib/identity-profile";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
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
const winner = commonPlayers[1];

function profile() {
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
    drawCredits: 2,
    lossesTowardCredit: 0,
    recordedRounds: [],
    matchHistory: [],
    updatedAt: 100,
  };
}

function pendingDraw() {
  return {
    requestId: "52de8707-292b-4a83-82d5-c1776ed54a01",
    poolId: "common" as const,
    itemIds: Array.from({ length: 29 }, () => winner.id),
    winnerId: winner.id,
    winnerIndex: 23,
    createdAt: 101,
  };
}

function serverProfile(overrides: Record<string, unknown> = {}) {
  const {
    version: _version,
    syncToken: _syncToken,
    ...server
  } = profile();
  return { ...server, ...overrides };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("identity draw server operations", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify(profile()));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn());
  });

  it("stores the server-generated draw instead of accepting a local winner", async () => {
    const draw = pendingDraw();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(serverProfile()))
      .mockResolvedValueOnce(
        jsonResponse(
          serverProfile({
            drawCredits: 1,
            pendingDraw: draw,
            updatedAt: 101,
          }),
        ),
      );
    const { spendDrawCreditSafely } = await import(
      "@/hooks/use-anonymous-profile"
    );

    await expect(spendDrawCreditSafely("common")).resolves.toEqual(draw);
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.drawCredits).toBe(1);
    expect(stored.pendingDraw).toEqual(draw);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain(
      "/identity-draws",
    );
  });

  it("does not spend a local credit when the server rejects the draw", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(serverProfile()))
      .mockResolvedValueOnce(jsonResponse({ code: "profile_conflict" }, 409));
    const { spendDrawCreditSafely } = await import(
      "@/hooks/use-anonymous-profile"
    );

    await expect(spendDrawCreditSafely("common")).resolves.toBeNull();
    expect(
      JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}").drawCredits,
    ).toBe(2);
  });

  it("adopts only the pending server winner", async () => {
    const draw = pendingDraw();
    storage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...profile(), pendingDraw: draw }),
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(serverProfile({ pendingDraw: draw })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          serverProfile({
            playerId: winner.id,
            pendingDraw: undefined,
            updatedAt: 102,
          }),
        ),
      );
    const { adoptPendingIdentityDraw } = await import(
      "@/hooks/use-anonymous-profile"
    );

    await expect(
      adoptPendingIdentityDraw("common", winner.id),
    ).resolves.toBe(true);
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}");
    expect(stored.playerId).toBe(winner.id);
    expect(stored.pendingDraw).toBeUndefined();
  });

  it("discards the pending result through its dedicated endpoint", async () => {
    const draw = pendingDraw();
    storage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...profile(), pendingDraw: draw }),
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(serverProfile({ pendingDraw: draw })),
      )
      .mockResolvedValueOnce(
        jsonResponse(serverProfile({ pendingDraw: undefined, updatedAt: 102 })),
      );
    const { discardPendingIdentityDraw } = await import(
      "@/hooks/use-anonymous-profile"
    );

    await expect(
      discardPendingIdentityDraw("common", winner.id),
    ).resolves.toBe(true);
    expect(
      JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}").pendingDraw,
    ).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.method).toBe("DELETE");
  });
});
