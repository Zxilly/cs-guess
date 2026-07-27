import { beforeEach, describe, expect, it, vi } from "vitest";

import { players } from "@/data/players";
import {
  hasConfirmedIdentity,
  PROFILE_KEY,
} from "@/lib/identity-profile";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function storedProfile(version: number, identityConfirmed?: boolean) {
  return JSON.stringify({
    version,
    anonymousId: "anonymous-test",
    playerId: players[0].id,
    identityConfirmed,
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
    },
    drawCredits: 1,
    lossesTowardCredit: 0,
    recordedRounds: [],
    matchHistory: [],
  });
}

describe("identity setup state", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("requires setup when no profile exists", () => {
    expect(hasConfirmedIdentity()).toBe(false);
  });

  it("keeps existing version 5 players confirmed after migration", () => {
    localStorage.setItem(PROFILE_KEY, storedProfile(5));
    expect(hasConfirmedIdentity()).toBe(true);
  });

  it("keeps a new profile gated until its identity is confirmed", () => {
    localStorage.setItem(PROFILE_KEY, storedProfile(6, false));
    expect(hasConfirmedIdentity()).toBe(false);
    localStorage.setItem(PROFILE_KEY, storedProfile(6, true));
    expect(hasConfirmedIdentity()).toBe(true);
  });
});
