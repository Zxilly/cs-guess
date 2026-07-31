import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AnonymousProfile,
  MatchHistoryEntry,
} from "@/hooks/use-anonymous-profile";
import {
  loadServerProfile,
  mergeServerProfileCompletion,
} from "@/lib/profile-api";

const summary = {
  anonymousId: "anonymous-profile-api-test",
  playerId: "donk",
  identityConfirmed: true,
  stats: {
    wins: 2,
    losses: 0,
    draws: 0,
    currentStreak: 2,
    bestStreak: 2,
  },
  drawCredits: 1,
  lossesTowardCredit: 0,
  updatedAt: 200,
};

function historyEntry(id: string): MatchHistoryEntry {
  return {
    id,
    completedAt: "2026-07-31T12:00:00.000Z",
    result: "win",
    mode: "solo",
    roundNumber: 1,
    bestOf: 1,
    answerId: "donk",
    guessIds: ["donk"],
    opponentNames: [],
    selfScore: 1,
    opponentScore: 0,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("profile API DTOs", () => {
  it("loads summary and history separately, then restores chronological state", async () => {
    const first = historyEntry("round-1");
    const second = historyEntry("round-2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(jsonResponse({ items: [second, first] }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await loadServerProfile(
      summary.anonymousId,
      "profile_sync_token_abcdefghijklmnopqrstuvwxyz",
    );

    expect(profile?.matchHistory).toEqual([first, second]);
    expect(profile?.recordedRounds).toEqual(["round-1", "round-2"]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/v1/profiles/${summary.anonymousId}/history?limit=50`,
    );
  });

  it("merges a completion delta without duplicating its history entry", () => {
    const oldEntry = historyEntry("round-1");
    const updatedEntry = { ...oldEntry, selfScore: 2 };
    const local: AnonymousProfile = {
      ...summary,
      syncToken: "profile_sync_token_abcdefghijklmnopqrstuvwxyz",
      recordedRounds: [oldEntry.id],
      matchHistory: [oldEntry],
    };

    const merged = mergeServerProfileCompletion(local, {
      profile: { ...summary, updatedAt: 201 },
      historyEntry: updatedEntry,
    });

    expect(merged.matchHistory).toEqual([updatedEntry]);
    expect(merged.recordedRounds).toEqual([oldEntry.id]);
    expect(merged.updatedAt).toBe(201);
  });
});
