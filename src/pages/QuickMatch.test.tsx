/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickMatch } from "@/pages/QuickMatch";

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    player: { id: "donk", nickname: "donk" },
    profile: {
      stats: {
        wins: 0,
        losses: 0,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
      },
      drawCredits: 0,
      lossesTowardCredit: 0,
    },
    winRate: 0,
    currentPool: "common",
  }),
}));

const emptyDifficulty = {
  bo1_hidden: 0,
  bo1_open: 0,
  bo3_hidden: 0,
  bo3_open: 0,
  bo5_hidden: 0,
  bo5_open: 0,
  group_bo1_hidden: 0,
  group_bo1_open: 0,
  group_bo3_hidden: 0,
  group_bo3_open: 0,
  group_bo5_hidden: 0,
  group_bo5_open: 0,
  total: 0,
  playing_bo1: 0,
  playing_bo1_hidden: 0,
  playing_bo1_open: 0,
  playing_bo3: 0,
  playing_bo3_hidden: 0,
  playing_bo3_open: 0,
  playing_bo5: 0,
  playing_bo5_hidden: 0,
  playing_bo5_open: 0,
  playing_group_bo1: 0,
  playing_group_bo1_hidden: 0,
  playing_group_bo1_open: 0,
  playing_group_bo3: 0,
  playing_group_bo3_hidden: 0,
  playing_group_bo3_open: 0,
  playing_group_bo5: 0,
  playing_group_bo5_hidden: 0,
  playing_group_bo5_open: 0,
  playing_total: 0,
};

vi.mock("@/hooks/use-matchmaking-queue", () => ({
  useMatchmakingQueue: () => ({
    counts: {
      ...emptyDifficulty,
      bo1: 0,
      bo3: 0,
      bo5: 0,
      group_bo1: 0,
      group_bo3: 0,
      group_bo5: 0,
      group_total: 0,
      easy: emptyDifficulty,
      full: emptyDifficulty,
      hard: emptyDifficulty,
    },
    live: false,
  }),
}));

vi.mock("@/components/PlayerIdentity", () => ({
  PlayerIdentity: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" data-testid="identity-entry" disabled={disabled}>
      管理身份
    </button>
  ),
}));

const ticket = {
  room_code: "CS-123456",
  player_id: "player-1",
  session_token: "token-1",
  socket_io_url: "/socket.io",
  snapshot: { phase: "waiting" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

function renderQuickMatch() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/quick"]}>
        <StrictMode>
          <QuickMatch />
        </StrictMode>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("QuickMatch submission lifecycle", () => {
  it("keeps one matchmaking rule entry and only decision-specific field help", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderQuickMatch();

    const helpLabels = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
      (button) => button.getAttribute("aria-label"),
    ).filter((label) => label?.includes("说明") || label === "匹配规则");

    expect(helpLabels).toEqual([
      "匹配规则",
      "对战规模说明",
      "猜测可见性说明",
      "题库难度说明",
      "赛制说明",
    ]);
    expect(helpLabels).not.toContain("对战设置说明");
    expect(helpLabels).not.toContain("题库与赛制说明");
  });

  it("submits once, freezes every setting, and exposes an accessible busy state", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderQuickMatch();
    const form = container.querySelector("form")!;

    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "正在加入队列",
    );
    const frozenControls = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="identity-entry"], [role="group"] button, [role="radiogroup"] button, button[type="submit"]',
    );
    expect(frozenControls.length).toBeGreaterThan(0);
    expect(Array.from(frozenControls).every((button) => button.disabled)).toBe(
      true,
    );
    expect(container.textContent).toContain("1v1 · 简单 ·BO3 · 隐藏");

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      identity_id: "donk",
      party_size: 2,
      visibility: "hidden",
      difficulty: "easy",
      best_of: 3,
      client_request_id: expect.any(String),
    });

    response.resolve(
      new Response(JSON.stringify(ticket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("restores focus to the CTA after an error and clears stale errors on setting changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderQuickMatch();
    const form = container.querySelector("form")!;

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const cta = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement).toBe(cta);

    const groupButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="对战规模"] button',
      ),
    )[1];
    act(() => groupButton.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("cancels and discards a ticket that arrives after unmount", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return response.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderQuickMatch();

    act(() => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      root.unmount();
    });
    response.resolve(
      new Response(JSON.stringify(ticket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          init?.method === "DELETE" &&
          String(url).includes("/v1/matches/quick/CS-123456"),
      ),
    ).toBe(true);
    expect(sessionStorage.length).toBe(0);
  });

  it("uses request-id cleanup when a real fetch abort cannot return the ticket", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderQuickMatch();

    act(() => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      root.unmount();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          init?.method === "DELETE" &&
          String(url).includes("/v1/matches/quick/request/"),
      ),
    ).toBe(true);
  });
});
