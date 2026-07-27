import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCurrentDailyChallenge } from "@/lib/daily-challenge-api";

describe("loadCurrentDailyChallenge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the server-persisted player snapshot", async () => {
    const response = {
      date: "2026-07-27",
      roundNumber: 208,
      mysteryPlayerId: "donk",
      mysteryPlayer: {
        id: "donk",
        nickname: "donk",
        name: "Danil Kryshkovets",
        team: "Spirit",
        nationality: "Russian Federation",
        countryCode: "RU",
        age: 19,
        role: "Entry",
        majorAppearances: 5,
        majorWins: 1,
      },
      catalogVersion: "catalog-sha256",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(loadCurrentDailyChallenge()).resolves.toEqual(response);
  });
});
