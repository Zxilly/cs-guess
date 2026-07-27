import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dailySecondsLeft,
  loadDailyProgress,
  saveDailyProgress,
} from "@/lib/daily-challenge";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("daily progress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts once when the daily page is first entered", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const challenge = { date: "2026-07-27" };

    const initial = loadDailyProgress(challenge, [], 1_000);
    expect(initial.deadline).toBe(181_000);
    saveDailyProgress(initial);

    const reloaded = loadDailyProgress(challenge, [], 10_000);
    expect(reloaded.deadline).toBe(181_000);
  });

  it("uses an absolute deadline instead of resetting on reload", () => {
    expect(
      dailySecondsLeft(
        {
          date: "2026-07-27",
          deadline: 10_000,
          guessedIds: [],
          status: "playing",
        },
        7_500,
      ),
    ).toBe(3);
  });
});
