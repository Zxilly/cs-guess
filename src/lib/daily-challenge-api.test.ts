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

  it("replaces a legacy undefined snapshot team before rendering", async () => {
    const response = {
      date: "2026-07-28",
      roundNumber: 209,
      mysteryPlayerId: "jedqr",
      mysteryPlayer: {
        id: "jedqr",
        nickname: "jedqr",
        name: "Grzegorz Jędras",
        team: "undefined (American team)",
        teamLogoUrl: "https://cdn.example/undefined.png",
        nationality: "Poland",
        countryCode: "PL",
        age: 27,
        role: "Entry",
        majorAppearances: 0,
        majorWins: 0,
      },
      catalogVersion: "legacy-catalog",
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

    const challenge = await loadCurrentDailyChallenge();

    expect(challenge.mysteryPlayer.team).toBe("无队伍");
    expect(challenge.mysteryPlayer.teamLogoUrl).toBeUndefined();
  });
});
