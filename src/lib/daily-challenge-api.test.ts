import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeDailyChallenge,
  loadCurrentDailyChallengeMetadata,
  startCurrentDailyChallenge,
} from "@/lib/daily-challenge-api";

const PROFILE = {
  anonymousId: "anonymous-daily-test",
  syncToken: "daily_test_sync_token_abcdefghijklmnopqrstuvwxyz",
};

describe("daily challenge API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads public metadata without starting an attempt", async () => {
    const response = { date: "2026-07-27", roundNumber: 208 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCurrentDailyChallengeMetadata()).resolves.toEqual(
      response,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/daily-challenges/current"),
      expect.not.objectContaining({ method: "POST" }),
    );
  });

  it("returns the server-persisted player snapshot for an attempt", async () => {
    const response = {
      date: "2026-07-27",
      roundNumber: 208,
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
      deadlineUnixMs: 1_800_000,
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

    await expect(startCurrentDailyChallenge(PROFILE)).resolves.toEqual(response);
  });

  it("replaces a legacy undefined snapshot team before rendering", async () => {
    const response = {
      date: "2026-07-28",
      roundNumber: 209,
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
      deadlineUnixMs: 1_800_000,
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

    const challenge = await startCurrentDailyChallenge(PROFILE);

    expect(challenge.mysteryPlayer.team).toBe("无队伍");
    expect(challenge.mysteryPlayer.teamLogoUrl).toBeUndefined();
  });

  it("starts an authenticated server attempt with the Profile credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          date: "2026-07-30",
          roundNumber: 211,
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
          deadlineUnixMs: 1_800_000,
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await startCurrentDailyChallenge(PROFILE);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/daily-challenges/current/attempts"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Profile-Token":
            "daily_test_sync_token_abcdefghijklmnopqrstuvwxyz",
        }),
        body: JSON.stringify({ anonymousId: "anonymous-daily-test" }),
      }),
    );
  });

  it("submits only the daily guess trace and timeout fact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profile: { anonymousId: "anonymous-daily-test" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeDailyChallenge(
      {
        anonymousId: "anonymous-daily-test",
        syncToken: "daily_test_sync_token_abcdefghijklmnopqrstuvwxyz",
      },
      ["donk"],
      false,
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      anonymousId: "anonymous-daily-test",
      guessIds: ["donk"],
      timedOut: false,
    });
  });
});
