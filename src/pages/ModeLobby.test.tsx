// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModeLobby } from "@/pages/ModeLobby";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  loadPlayers: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/data/players", () => ({
  loadPlayers: mocks.loadPlayers,
}));

vi.mock("@/hooks/use-daily-challenge", () => ({
  useDailyChallengeMetadata: () => ({
    challenge: {
      date: "2026-07-28",
      roundNumber: 209,
    },
  }),
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    player: { nickname: "steel" },
    profile: {
      stats: {
        wins: 1,
        losses: 0,
        draws: 0,
        currentStreak: 1,
        bestStreak: 1,
      },
      drawCredits: 1,
      lossesTowardCredit: 0,
    },
    winRate: 100,
    currentPool: "common",
  }),
}));

vi.mock("@/components/PlayerIdentity", () => ({
  PlayerIdentity: () => <section aria-label="我的身份">steel 的身份摘要</section>,
}));

describe("ModeLobby", () => {
  beforeEach(() => {
    mocks.loadPlayers.mockClear();
  });

  it("keeps every mode entry and the daily CTA visible in the lobby markup", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/play/daily"');
    expect(markup).toContain('href="/solo"');
    expect(markup).toContain('href="/quick"');
    expect(markup).toContain('href="/quick?players=4"');
    expect(markup).toContain('href="/room"');
    expect(markup).toContain("开始今日挑战");
    expect(markup).toContain("单人练习");
    expect(markup).toContain("实时 1v1");
    expect(markup).toContain("4 人乱斗");
    expect(markup).toContain("好友房间");
  });

  it("uses a compact round label and readable, localized mode metadata", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain("第 209 轮");
    expect(markup).not.toContain("Round #");
    expect(markup).not.toContain("text-6xl");
    expect(markup).not.toContain("text-[10px]");
    expect(markup).not.toContain("Online");
    expect(markup).toContain("在线匹配 · 1 / 3 / 5 局赛制");
    expect(markup).toContain("text-xs");
  });

  it("keeps compact mobile header actions accessible without visible labels", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="CS GUESS · 职业选手竞猜"');
    expect(markup).toContain('href="/identity"');
    expect(markup).toContain('aria-label="管理玩家身份"');
    expect(markup).not.toContain('<span class="sm:hidden">身份</span>');
    expect(markup).toContain('href="/stats"');
    expect(markup).toContain('aria-label="查看战绩"');
    expect(markup).toContain('<span class="hidden sm:inline">战绩</span>');
  });

  it("links the lobby to the GitHub repository in a new tab", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="https://github.com/Zxilly/cs-guess"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain("GitHub 源码");
  });

  it("limits directional arrow motion to motion-safe environments", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain(
      "motion-safe:group-hover:translate-x-1",
    );
    expect(markup).toContain("motion-reduce:transform-none");
    expect(markup).toContain("motion-reduce:transition-none");
  });

  it("renders the lobby before warming the player catalog after a paint", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter>
          <ModeLobby />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("开始今日挑战");
    expect(mocks.loadPlayers).not.toHaveBeenCalled();

    act(() => frames.shift()?.(0));
    expect(mocks.loadPlayers).not.toHaveBeenCalled();

    act(() => frames.shift()?.(16));
    expect(mocks.loadPlayers).toHaveBeenCalledWith({ priority: "low" });

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});
