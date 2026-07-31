import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ModeLobby } from "@/pages/ModeLobby";

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

  it("keeps both mobile header destinations named without shortening the brand", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeLobby />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="CS GUESS · 职业选手竞猜"');
    expect(markup).toContain('href="/identity"');
    expect(markup).toContain("管理玩家身份：steel");
    expect(markup).toContain('<span class="sm:hidden">身份</span>');
    expect(markup).toContain('href="/stats"');
    expect(markup).toContain(">战绩</");
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
});
