/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { players } from "@/data/players";
import { PROFILE_KEY } from "@/lib/identity-profile";

const commonPlayers = players.filter(
  (player) =>
    player.majorAppearances >= 1 &&
    player.majorAppearances <= 4 &&
    player.majorWins === 0,
);
const currentPlayer = commonPlayers[0]!;
const winner = commonPlayers[1]!;

function storedProfile() {
  return {
    version: 8,
    anonymousId: "anonymous-profile-swr-mutation-test",
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

function serverProfile(overrides: Record<string, unknown> = {}) {
  const {
    version: _version,
    syncToken: _syncToken,
    ...server
  } = storedProfile();
  return { ...server, ...overrides };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(storedProfile()));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useAnonymousProfile SWR mutations", () => {
  it("publishes pending state before the draw endpoint responds", async () => {
    let resolveDraw!: (response: Response) => void;
    const drawResponse = new Promise<Response>((resolve) => {
      resolveDraw = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(serverProfile()))
        .mockResolvedValueOnce(jsonResponse({ items: [] }))
        .mockReturnValueOnce(drawResponse),
    );
    const { useIdentityProfile } = await import(
      "@/hooks/use-anonymous-profile"
    );

    function Probe() {
      const identity = useIdentityProfile();
      return (
        <>
          <button
            type="button"
            onClick={() => void identity.spendDrawCredit("common")}
          >
            抽取
          </button>
          <output>{identity.drawPending ? "pending" : "idle"}</output>
        </>
      );
    }

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    act(() => {
      container.querySelector("button")?.click();
    });
    expect(container.querySelector("output")?.textContent).toBe("pending");

    await act(async () => {
      resolveDraw(
        jsonResponse(
          serverProfile({
            drawCredits: 1,
            pendingDraw: {
              poolId: "common",
              itemIds: Array.from({ length: 29 }, () => winner.id),
              winnerId: winner.id,
              winnerIndex: 23,
              createdAt: 101,
            },
            updatedAt: 101,
          }),
        ),
      );
      await drawResponse;
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.textContent).toBe("idle");
  });
});
