import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeServerSoloRound,
  createServerSoloRound,
  loadServerSoloRound,
} from "@/lib/solo-round-api";

const profile = {
  anonymousId: "anonymous-solo-api-test",
  syncToken: "solo_api_test_sync_token_abcdefghijklmnopqrstuvwxyz",
};

const round = {
  roundId: "solo:easy:round-id",
  roundNumber: 2,
  difficulty: "easy",
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
  maxGuesses: 8,
};

describe("solo round API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a server-owned round for the Profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(round), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createServerSoloRound(profile, "easy")).resolves.toMatchObject({
      roundId: round.roundId,
      mysteryPlayer: { id: "donk" },
    });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      "X-Profile-Token": profile.syncToken,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      anonymousId: profile.anonymousId,
      difficulty: "easy",
    });
  });

  it("returns null when a persisted local round is not server-owned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(
      loadServerSoloRound(profile, "solo:easy:legacy"),
    ).resolves.toBeNull();
  });

  it("completes the issued round with guesses instead of a claimed result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ profile: { anonymousId: profile.anonymousId } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeServerSoloRound(profile, round.roundId, ["donk"], false);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/completions");
    expect(JSON.parse(String(request.body))).toEqual({
      anonymousId: profile.anonymousId,
      guessIds: ["donk"],
      timedOut: false,
    });
  });
});
