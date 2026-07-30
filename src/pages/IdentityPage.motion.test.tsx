/** @vitest-environment jsdom */

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const currentPlayer = {
    id: "donk",
    nickname: "Current",
    name: "Current Player",
    countryCode: "CN",
    nationality: "China",
    age: 24,
    team: "Test",
    role: "Rifler",
    majorAppearances: 1,
    majorWins: 0,
    imageUrl: "https://example.com/current.webp",
  };
  const candidate = {
    ...currentPlayer,
    id: "m0nesy",
    nickname: "Candidate",
    name: "Candidate Player",
    imageUrl: "https://example.com/candidate.webp",
  };
  return {
    identityConfirmed: false,
    drawCredits: 1,
    pendingDraw: undefined as
      | {
          poolId: "common";
          itemIds: readonly string[];
          winnerId: string;
          winnerIndex: number;
          createdAt: number;
        }
      | undefined,
    currentPlayer,
    candidate,
    spendDrawCredit: vi.fn(),
  };
});

vi.mock("@/data/players", () => ({
  players: [mocks.currentPlayer, mocks.candidate],
}));

vi.mock("@/hooks/use-anonymous-profile", () => {
  const pool = {
    id: "common" as const,
    label: "Major 参赛池",
    unlockWins: 0,
    description: "测试选手池",
  };

  return {
    IDENTITY_POOLS: [pool],
    playersInPool: () => [mocks.currentPlayer, mocks.candidate],
    useAnonymousProfile: () => ({
      profile: {
        identityConfirmed: mocks.identityConfirmed,
        drawCredits: mocks.drawCredits,
        pendingDraw: mocks.pendingDraw,
        stats: {
          wins: 0,
          losses: 0,
          draws: 0,
          currentStreak: 0,
          bestStreak: 0,
        },
      },
      player: mocks.currentPlayer,
      currentPool: "common",
      winRate: 0,
      spendDrawCredit: mocks.spendDrawCredit,
      adoptIdentity: vi.fn(),
      discardPendingDraw: vi.fn(),
      completeIdentitySetup: vi.fn(),
      setPreviewDrawCredits: vi.fn(),
    }),
  };
});

import { IdentityPage } from "@/pages/IdentityPage";

let container: HTMLDivElement;
let root: Root;
let pendingImageDecodes: number;
let preloadImages: Array<{ src: string }>;

function renderPage(reducedMotion: boolean, strict = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        reducedMotion && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  const page = (
    <MemoryRouter initialEntries={["/identity"]}>
      <IdentityPage />
    </MemoryRouter>
  );
  act(() => {
    root.render(strict ? <StrictMode>{page}</StrictMode> : page);
  });
}

function findButton(label: string) {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(label),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  pendingImageDecodes = 0;
  preloadImages = [];
  vi.stubGlobal(
    "Image",
    class {
      decoding = "auto";
      referrerPolicy = "";
      src = "";

      decode() {
        pendingImageDecodes += 1;
        return new Promise<void>(() => {});
      }

      constructor() {
        preloadImages.push(this);
      }
    },
  );
  mocks.identityConfirmed = false;
  mocks.drawCredits = 1;
  mocks.pendingDraw = undefined;
  mocks.spendDrawCredit.mockClear();
  mocks.spendDrawCredit.mockImplementation(
    async (_poolId: "common") => {
      const pendingDraw = {
        poolId: "common" as const,
        itemIds: Array.from({ length: 29 }, () => mocks.candidate.id),
        winnerId: mocks.candidate.id,
        winnerIndex: 23,
        createdAt: Date.now(),
      };
      mocks.pendingDraw = pendingDraw;
      mocks.drawCredits -= 1;
      return pendingDraw;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("IdentityPage reduced-motion draw state", () => {
  it("restores a charged onboarding draw after a reload", async () => {
    mocks.drawCredits = 0;
    mocks.pendingDraw = {
      poolId: "common",
      itemIds: Array.from({ length: 29 }, () => mocks.candidate.id),
      winnerId: mocks.candidate.id,
      winnerIndex: 23,
      createdAt: 101,
    };
    renderPage(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "抽取结果：Candidate",
    );
    expect(findButton("确认身份并进入大厅")).toBeTruthy();
  });

  it("reveals and announces immediately, then focuses confirmation", async () => {
    renderPage(true);

    await act(async () => {
      findButton("抽取初始身份")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const liveResult = document.querySelector('[role="status"]');
    const confirm = findButton("确认身份并进入大厅");
    expect(liveResult?.textContent).toBe("抽取结果：Candidate");
    expect(
      document.querySelector('[data-slot="identity-draw-result-shell"] > p')
        ?.className,
    ).toContain("invisible");
    expect(confirm).toBeTruthy();
    expect(document.activeElement).toBe(confirm);
    expect(
      document
        .querySelector(".identity-roulette-track")
        ?.getAttribute("data-rolling"),
    ).toBe("false");
    expect(
      document.querySelector(
        ".identity-roulette-card [data-slot='player-avatar-placeholder']",
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(".identity-roulette-card img")?.className,
    ).toContain("opacity-0");
    expect(pendingImageDecodes).toBeGreaterThan(0);
  });

  it("makes a non-onboarding pool ready before requesting a server draw", async () => {
    mocks.identityConfirmed = true;
    renderPage(true);

    await act(async () => {
      await Promise.resolve();
    });

    const drawButton = findButton("抽取 · 消耗 1 次");
    expect(drawButton).toBeTruthy();
    expect(drawButton?.getAttribute("aria-disabled")).toBe("false");
    expect(pendingImageDecodes).toBe(0);
    expect(document.body.textContent).not.toContain("正在准备头像");
  });

  it("preloads the server-selected onboarding sequence in StrictMode", async () => {
    renderPage(true, true);

    await act(async () => {
      findButton("抽取初始身份")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preloadImages.length).toBeGreaterThanOrEqual(1);
    expect(preloadImages.at(-1)?.src).toBe(
      "https://example.com/candidate.webp",
    );
  });

  it("preloads the server-selected regular sequence in StrictMode", async () => {
    mocks.identityConfirmed = true;
    renderPage(true, true);

    await act(async () => {
      findButton("抽取 · 消耗 1 次")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preloadImages.length).toBeGreaterThanOrEqual(1);
    expect(preloadImages.at(-1)?.src).toBe(
      "https://example.com/candidate.webp",
    );
    expect(findButton("使用新身份")).toBeTruthy();
  });

  it("focuses and re-announces every reduced-motion reroll result", async () => {
    mocks.identityConfirmed = true;
    mocks.drawCredits = 3;
    renderPage(true);

    await act(async () => {
      await Promise.resolve();
      findButton("抽取 · 消耗 1 次")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstConfirm = findButton("使用新身份");
    const firstAnnouncement = document
      .querySelector('[role="status"]')
      ?.getAttribute("aria-label");
    expect(document.activeElement).toBe(firstConfirm);

    await act(async () => {
      const reroll = findButton("重抽 · 2");
      reroll?.focus();
      reroll?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const nextConfirm = findButton("使用新身份");
    const nextAnnouncement = document
      .querySelector('[role="status"]')
      ?.getAttribute("aria-label");
    expect(nextAnnouncement).not.toBe(firstAnnouncement);
    expect(nextAnnouncement).toContain("Candidate");
    expect(document.activeElement).toBe(nextConfirm);
  });

  it("preserves the normal three-second roulette before revealing", async () => {
    vi.useFakeTimers();
    renderPage(false);

    await act(async () => {
      findButton("抽取初始身份")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("锁定中…");
    expect(
      findButton("确认身份并进入大厅")
        ?.closest('[data-slot="identity-draw-result-content"]')
        ?.hasAttribute("inert"),
    ).toBe(true);
    expect(
      document
        .querySelector(".identity-roulette-track")
        ?.getAttribute("data-rolling"),
    ).toBe("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_099);
    });
    expect(document.body.textContent).toContain("锁定中…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "抽取结果：Candidate",
    );
    expect(document.activeElement).toBe(
      findButton("确认身份并进入大厅"),
    );
  });
});
