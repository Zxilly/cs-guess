import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const profileState = vi.hoisted(() => ({
  identityConfirmed: false,
}));

vi.mock("@/hooks/use-anonymous-profile", () => {
  const player = {
    id: "test-player",
    nickname: "tester",
    countryCode: "CN",
    team: "Test",
    majorAppearances: 1,
    majorWins: 0,
  };
  const pool = {
    id: "common" as const,
    label: "Major 参赛池",
    unlockWins: 0,
    description: "测试选手池",
  };

  return {
    IDENTITY_POOLS: [pool],
    playersInPool: () => [player],
    useAnonymousProfile: () => ({
      profile: {
        identityConfirmed: profileState.identityConfirmed,
        drawCredits: 1,
        stats: {
          wins: 0,
          losses: 0,
          draws: 0,
          currentStreak: 0,
          bestStreak: 0,
        },
      },
      player,
      currentPool: "common",
      winRate: 0,
      spendDrawCredit: vi.fn(),
      adoptIdentity: vi.fn(),
      discardPendingDraw: vi.fn(),
      completeIdentitySetup: vi.fn(),
      setPreviewDrawCredits: vi.fn(),
    }),
  };
});

import { IdentityPage } from "@/pages/IdentityPage";

describe("IdentityPage onboarding", () => {
  it("keeps the desktop identity panels in equal, shrink-safe columns", () => {
    profileState.identityConfirmed = true;

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/identity"]}>
        <IdentityPage />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-layout="identity-equal-columns"');
    expect(markup).toContain("lg:grid-cols-2");
    expect(markup).not.toContain("minmax(0,0.92fr)");
    expect(markup.match(/min-w-0/g)?.length).toBeGreaterThanOrEqual(4);
    expect(markup).toContain("app-section-offset");
  });

  it("keeps the onboarding reason, return behavior, and primary action discoverable", () => {
    profileState.identityConfirmed = false;

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/identity?return=%2Fquick"]}>
        <IdentityPage />
      </MemoryRouter>,
    );

    expect(markup).toContain(
      "抽取并确认一个匿名身份，用于对战昵称与战绩记录。",
    );
    expect(markup).toContain(">抽取初始身份</button>");
  });

  it("does not show first-run guidance in identity management", () => {
    profileState.identityConfirmed = true;

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/identity"]}>
        <IdentityPage />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("首次游玩需设置匿名身份");
    expect(markup).toContain("当前身份池");
    expect(markup).not.toContain("测试选手池");
    expect(markup).toContain("0胜");
    expect(markup).toContain("0平");
    expect(markup).toContain("0 连胜");
    expect(markup).toContain("胜 1 局或累计负 2 局，可获得 1 次");
  });
});
