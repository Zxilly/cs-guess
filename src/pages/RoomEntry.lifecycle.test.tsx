/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomEntry } from "@/pages/RoomEntry";

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
let router: ReturnType<typeof createMemoryRouter>;

function renderRoomEntry(strict = false) {
  router = createMemoryRouter(
    [
      { path: "/room", element: <RoomEntry /> },
      { path: "/play/room", element: <p>房间等待页</p> },
    ],
    { initialEntries: ["/room"] },
  );
  act(() => {
    root.render(
      strict ? (
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>
      ) : (
        <RouterProvider router={router} />
      ),
    );
  });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RoomEntry submission lifecycle", () => {
  it.each(["join", "create"] as const)(
    "still submits %s after StrictMode replays the mount effect",
    async (kind) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(ticket), {
          status: kind === "join" ? 200 : 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderRoomEntry(true);

      if (kind === "join") {
        const input = container.querySelector<HTMLInputElement>(
          'input[name="roomCode"]',
        )!;
        act(() => setInput(input, "654321"));
        act(() =>
          container
            .querySelector("form")
            ?.dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            ),
        );
      } else {
        act(() =>
          container
            .querySelector<HTMLButtonElement>(
              '[data-testid="create-room-button"]',
            )
            ?.click(),
        );
      }
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(router.state.location.pathname).toBe("/play/room");
      expect(router.state.historyAction).toBe("REPLACE");
    },
  );

  it("single-flights join against double submit and create, freezes the snapshot, then replaces", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderRoomEntry();
    const form = container.querySelector("form")!;
    const input = container.querySelector<HTMLInputElement>(
      'input[name="roomCode"]',
    )!;
    act(() => setInput(input, "654321"));

    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="create-room-button"]',
        )
        ?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain("donk 加入 CS-654321");
    expect(input.disabled).toBe(true);
    const frozenButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="identity-entry"], form button[type="submit"], section [role="group"] button, section [role="radiogroup"] button, [data-testid="create-room-button"]',
    );
    expect(frozenButtons.length).toBeGreaterThan(1);
    expect(Array.from(frozenButtons).every((button) => button.disabled)).toBe(
      true,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/v1/rooms/CS-654321/join");
    expect(JSON.parse(String(init.body))).toEqual({ identity_id: "donk" });

    response.resolve(
      new Response(JSON.stringify(ticket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await flush();

    expect(router.state.location.pathname).toBe("/play/room");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(sessionStorage.length).toBe(1);
  });

  it("single-flights create and keeps all submitted settings in its busy summary", () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderRoomEntry();
    const createButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="create-room-button"]',
    )!;

    act(() => {
      createButton.click();
      createButton.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain("donk 创建 4 人 · 简单 · BO3 · 隐藏猜测");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      identity_id: "donk",
      visibility: "hidden",
      max_players: 4,
      best_of: 3,
      difficulty: "easy",
    });
  });

  it("focuses error dialogs and restores the matching control after recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "room_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderRoomEntry();
    const form = container.querySelector("form")!;
    const input = container.querySelector<HTMLInputElement>(
      'input[name="roomCode"]',
    )!;
    act(() => setInput(input, "654321"));

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain(
      "没有找到这个房间，请检查 6 位房间号后重试。",
    );
    expect(document.activeElement?.textContent).toContain("未能加入房间");
    const checkRoomButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("检查房间号"))!;
    act(() => checkRoomButton.click());
    await flush();
    expect(document.activeElement).toBe(input);
    act(() => setInput(input, "123456"));
    expect(
      document.body.querySelector('[role="alertdialog"]'),
    ).toBeNull();

    const createButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="create-room-button"]',
    )!;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain(
      "对战服务暂时不可用，请稍后重新创建。",
    );
    expect(document.activeElement?.textContent).toContain("未能创建房间");
    const returnButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("返回设置"))!;
    act(() => returnButton.click());
    await flush();
    expect(document.activeElement).toBe(createButton);

    const visibilityButton = container.querySelector<HTMLButtonElement>(
      '[role="group"][aria-label="对手猜测显示方式"] button:nth-child(2)',
    )!;
    act(() => visibilityButton.click());
    expect(
      document.body.querySelector('[role="alertdialog"]'),
    ).toBeNull();
  });

  it("times out after 15 seconds, unlocks join, and restores input focus", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderRoomEntry();
    const form = container.querySelector("form")!;
    const input = container.querySelector<HTMLInputElement>(
      'input[name="roomCode"]',
    )!;
    act(() => setInput(input, "654321"));
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("加入房间超时");
    expect(input.disabled).toBe(false);
    const checkRoomButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("检查房间号"))!;
    act(() => checkRoomButton.click());
    await flush();
    expect(document.activeElement).toBe(input);
  });

  it("aborts silently and compensates a late room without persisting or navigating", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return response.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderRoomEntry();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="create-room-button"]',
        )!
        .click();
      root.unmount();
    });
    response.resolve(
      new Response(JSON.stringify(ticket), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await flush();

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          init?.method === "DELETE" &&
          String(url).includes("/v1/rooms/CS-123456"),
      ),
    ).toBe(true);
    expect(sessionStorage.length).toBe(0);
    expect(router.state.location.pathname).toBe("/room");
  });
});
