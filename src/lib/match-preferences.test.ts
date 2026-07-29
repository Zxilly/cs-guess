import { describe, expect, it } from "vitest";

import {
  loadQuickMatchPreferences,
  loadRoomPreferences,
  saveQuickMatchPreferences,
  saveRoomPreferences,
} from "@/lib/match-preferences";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("match preferences", () => {
  it("round-trips the last submitted quick-match configuration", () => {
    const storage = new MemoryStorage();
    const settings = {
      partySize: 4 as const,
      bestOf: 5 as const,
      difficulty: "hard" as const,
      visibility: "open" as const,
    };

    saveQuickMatchPreferences(settings, storage);

    expect(loadQuickMatchPreferences(storage)).toEqual(settings);
  });

  it("ignores malformed stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "cs-guess:quick-match-preferences:v1",
      JSON.stringify({
        partySize: 3,
        bestOf: 7,
        difficulty: "impossible",
        visibility: "public",
      }),
    );

    expect(loadQuickMatchPreferences(storage)).toBeUndefined();
  });

  it("round-trips a supported room capacity", () => {
    const storage = new MemoryStorage();
    const settings = {
      bestOf: 3 as const,
      difficulty: "full" as const,
      visibility: "hidden" as const,
      maxPlayers: 4 as const,
    };

    saveRoomPreferences(settings, storage);

    expect(loadRoomPreferences(storage)).toEqual(settings);
  });

  it("ignores legacy room capacities outside the supported 2/4 choices", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "cs-guess:room-preferences:v1",
      JSON.stringify({
        bestOf: 3,
        difficulty: "full",
        visibility: "hidden",
        maxPlayers: 3,
      }),
    );

    expect(loadRoomPreferences(storage)).toBeUndefined();
  });
});
