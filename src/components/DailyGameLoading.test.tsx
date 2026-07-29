import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { DailyGameLoading } from "@/components/DailyGameLoading";
import { players } from "@/data/players";
import type { ServerDailyChallenge } from "@/lib/daily-challenge-api";
import { GamePage } from "@/pages/GamePage";

const dailyState = vi.hoisted(() => ({
  challenge: undefined as ServerDailyChallenge | undefined,
  error: undefined as Error | undefined,
  retry: vi.fn(),
}));

vi.mock("@/hooks/use-daily-challenge", () => ({
  useDailyChallenge: () => dailyState,
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    recordRound: vi.fn(),
  }),
}));

function renderInRouter(node: React.ReactNode) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("DailyGameLoading", () => {
  afterEach(() => {
    dailyState.challenge = undefined;
    dailyState.error = undefined;
    dailyState.retry.mockClear();
    vi.unstubAllGlobals();
  });

  it("uses the real daily game frame without inventing round or timer values", () => {
    const markup = renderInRouter(<DailyGameLoading />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-daily-game-surface="loading"');
    expect(markup).toContain("lg:grid-cols-[280px_minmax(0,1fr)]");
    expect(markup).toContain("今日挑战");
    expect(markup).toContain("app-game-main");
    expect(markup).not.toContain("根据对比，锁定神秘选手。");
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).not.toContain("DAILY · ROUND #");
    expect(markup).not.toContain("#—");
    expect(markup).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("reuses the same frame for route chunk and daily data loading", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          version: 7,
          anonymousId: "anonymous-test",
          playerId: "donk",
          identityConfirmed: true,
        }),
    });

    const routeMarkup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/play/daily"]}>
        <App />
      </MemoryRouter>,
    );
    const dataMarkup = renderInRouter(<GamePage mode="daily" />);

    expect(routeMarkup).toContain('data-daily-game-surface="loading"');
    expect(dataMarkup).toContain('data-daily-game-surface="loading"');
    expect(routeMarkup).toContain("lg:grid-cols-[280px_minmax(0,1fr)]");
    expect(dataMarkup).toContain("lg:grid-cols-[280px_minmax(0,1fr)]");
  });

  it("keeps the daily frame stable while the client portal owns error recovery", () => {
    dailyState.error = new Error("offline");

    const markup = renderInRouter(<GamePage mode="daily" />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-daily-game-surface="error"');
    expect(markup).toContain("每日挑战载入失败");
    expect(markup).toContain("重新载入");
    expect(markup).not.toContain("animate-pulse");
  });

  it("does not repeat daily progress in a separate question strip", () => {
    const mysteryPlayer = players[0];
    dailyState.challenge = {
      date: "2026-07-29",
      roundNumber: 210,
      mysteryPlayerId: mysteryPlayer.id,
      mysteryPlayer,
      catalogVersion: "test-catalog",
    };

    const markup = renderInRouter(<GamePage mode="daily" />);

    expect(markup).not.toContain("今日统一题目");
    expect(markup).not.toContain("已使用 0 次机会");
    expect(markup).not.toContain("DAILY · ROUND");
    expect(markup).not.toContain("今日神秘选手");
    expect(markup).not.toContain("DAILY · ROUND #210");
    expect(markup).not.toContain("今日神秘选手");
  });
});
