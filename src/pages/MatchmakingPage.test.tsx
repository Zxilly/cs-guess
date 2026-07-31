/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchmakingPage } from "@/pages/MatchmakingPage";
import {
  loadCredentials,
  saveClosingIntent,
} from "@/lib/realtime";

const mocks = vi.hoisted(() => {
  const difficulty = {
    bo1_hidden: 1,
    bo1_open: 0,
    bo3_hidden: 2,
    bo3_open: 0,
    bo5_hidden: 3,
    bo5_open: 0,
    group_bo1_hidden: 0,
    group_bo1_open: 0,
    group_bo3_hidden: 0,
    group_bo3_open: 0,
    group_bo5_hidden: 0,
    group_bo5_open: 0,
    playing_bo1_hidden: 4,
    playing_bo1_open: 0,
    playing_bo3_hidden: 5,
    playing_bo3_open: 0,
    playing_bo5_hidden: 6,
    playing_bo5_open: 0,
    playing_group_bo1_hidden: 0,
    playing_group_bo1_open: 0,
    playing_group_bo3_hidden: 0,
    playing_group_bo3_open: 0,
    playing_group_bo5_hidden: 0,
    playing_group_bo5_open: 0,
  };
  return {
    matchFoundProps: null as Record<string, unknown> | null,
    queue: {
      live: true,
      counts: {
        easy: difficulty,
        full: difficulty,
        hard: difficulty,
      },
    },
    realtime: {
    connection: "reconnecting",
    offlineReason: null as
      | "reconnect_timeout"
      | "session_invalid"
      | "profile_invalid"
      | "configuration"
      | null,
      snapshot: {
        phase: "waiting",
        best_of: 3,
        max_players: 2,
        visibility: "hidden",
        difficulty: "easy",
        players: [
          { player_id: "player-1", display_name: "donk" },
        ],
      },
      events: [] as Array<Record<string, unknown>>,
      error: "实时连接中断，正在自动重连。",
      retry: vi.fn(),
      close: vi.fn(),
      setError: vi.fn(),
      send: vi.fn(),
    },
  };
});

vi.mock("@/hooks/use-matchmaking-queue", () => ({
  useMatchmakingQueue: () => mocks.queue,
}));

vi.mock("@/hooks/use-realtime-room", () => ({
  useRealtimeRoom: () => mocks.realtime,
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    player: { id: "donk", nickname: "donk" },
  }),
}));

vi.mock("@/components/MatchFoundOverlay", () => ({
  MatchFoundOverlay: (props: Record<string, unknown>) => {
    mocks.matchFoundProps = props;
    return <div role="dialog">匹配成功覆盖层</div>;
  },
}));

let container: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output
      data-testid="location"
      data-focus-game-heading={
        typeof location.state === "object" &&
        location.state !== null &&
        "focusGameHeading" in location.state &&
        location.state.focusGameHeading === true
          ? "true"
          : "false"
      }
    >
      {location.pathname}
    </output>
  );
}

function storeSession(startedAt = Date.now()) {
  sessionStorage.setItem(
    "cs-guess:realtime-session",
    JSON.stringify({
      credentials: {
        roomCode: "CS-123456",
        playerId: "player-1",
        sessionToken: "token-1",
        socketIoUrl: "/socket.io",
        mode: "quick",
      },
      snapshot: mocks.realtime.snapshot,
      startedAt,
    }),
  );
}

function renderPage() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/matching"]}>
        <StrictMode>
          <MatchmakingPage />
          <LocationProbe />
        </StrictMode>
      </MemoryRouter>,
    );
  });
}

function findButton(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false }),
  );
  sessionStorage.clear();
  mocks.queue.live = true;
  mocks.matchFoundProps = null;
  mocks.realtime.connection = "reconnecting";
  mocks.realtime.offlineReason = null;
  mocks.realtime.error = "实时连接中断，正在自动重连。";
  mocks.realtime.events = [];
  mocks.realtime.snapshot = {
    phase: "waiting",
    best_of: 3,
    max_players: 2,
    visibility: "hidden",
    difficulty: "easy",
    players: [{ player_id: "player-1", display_name: "donk" }],
  };
  mocks.realtime.retry.mockClear();
  mocks.realtime.close.mockClear();
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

describe("MatchmakingPage", () => {
  it("separates public telemetry from room connection and shows identity and totals", () => {
    storeSession();
    renderPage();

    expect(container.textContent).toContain("当前身份");
    expect(container.textContent).toContain("donk");
    expect(container.textContent).toContain("公共队列数据");
    expect(container.textContent).toContain("房间正在重连");
    expect(container.textContent).not.toContain("房间已连接");
    expect(document.body.textContent).toContain(
      "实时连接中断，正在自动重连。",
    );
    expect(container.textContent).toContain("当前条件等待总数");
    expect(container.textContent).toContain("当前条件游戏中总数");
    expect(container.textContent).toContain("6");
    expect(container.textContent).toContain("15");
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
      "00:",
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="matching-queue-summary"]',
      )?.getAttribute("aria-live"),
    ).toBe("off");
  });

  it.each([
    [
      "offline",
      "连接超时，无法恢复实时连接。你可以立即重试或安全退出。",
      "连接超时",
    ],
    [
      "offline",
      "会话已失效，请退出后重新加入。",
      "会话已失效",
    ],
  ])(
    "uses one alert and no connection status for a terminal %s state",
    (connection, error, expected) => {
      mocks.realtime.connection = connection;
      mocks.realtime.error = error;
      storeSession();
      renderPage();

      expect(
        document.body.querySelectorAll('[role="alertdialog"]'),
      ).toHaveLength(1);
      expect(
        document.body.querySelector('[role="alertdialog"]')?.textContent,
      ).toContain(expected);
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
      expect(
        container.querySelector(
          '[data-testid="matching-connection-status"]',
        )?.getAttribute("aria-live"),
      ).toBe("off");
      if (expected === "会话已失效") {
        expect(document.body.textContent).toContain("清除失效会话并返回");
        expect(document.body.textContent).not.toContain("重试房间连接");
        expect(document.body.textContent).not.toContain("安全返回");
      } else {
        expect(document.body.textContent).toContain("重试连接");
        expect(document.body.textContent).toContain("安全返回");
      }
    },
  );

  it("switches reconnecting, timeout, and recovered states without stale live regions", () => {
    storeSession();
    renderPage();

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(
      document.body.querySelectorAll('[role="alertdialog"]'),
    ).toHaveLength(0);

    mocks.realtime.connection = "offline";
    mocks.realtime.error =
      "连接超时，无法恢复实时连接。你可以立即重试或安全退出。";
    renderPage();

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(
      document.body.querySelectorAll('[role="alertdialog"]'),
    ).toHaveLength(1);

    const persistentCancelButton = findButton("取消匹配")!;
    act(() => persistentCancelButton.focus());
    mocks.realtime.connection = "connected";
    mocks.realtime.error = "";
    renderPage();

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      document.body.querySelectorAll('[role="alertdialog"]'),
    ).toHaveLength(0);
    expect(persistentCancelButton.isConnected).toBe(true);
    expect(
      container.querySelector(
        '[data-testid="matching-connection-status"]',
      )?.textContent,
    ).toContain("房间已连接");
  });

  it("does not replay the connected announcement when only queue counts change", () => {
    mocks.realtime.error = "";
    mocks.realtime.connection = "connected";
    storeSession();
    renderPage();

    const connectionStatus = container.querySelector(
      '[data-testid="matching-connection-status"]',
    );
    const initialConnectionCopy = connectionStatus?.textContent;
    const queueSummary = container.querySelector(
      '[data-testid="matching-queue-summary"]',
    );
    expect(connectionStatus?.getAttribute("aria-live")).toBe("polite");
    expect(queueSummary?.getAttribute("aria-live")).toBe("off");

    const previousWaiting = mocks.queue.counts.easy.bo1_hidden;
    act(() => {
      mocks.queue.counts.easy.bo1_hidden = 17;
      renderPage();
    });

    expect(
      container.querySelector(
        '[data-testid="matching-connection-status"]',
      ),
    ).toBe(connectionStatus);
    expect(connectionStatus?.textContent).toBe(initialConnectionCopy);
    expect(queueSummary?.textContent).toContain("22");
    mocks.queue.counts.easy.bo1_hidden = previousWaiting;
  });

  it("continues elapsed time from persisted startedAt and exposes timeout recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T00:11:05Z"));
    mocks.realtime.error = "";
    mocks.realtime.connection = "connected";
    storeSession(new Date("2026-07-28T00:00:00Z").getTime());
    renderPage();

    expect(container.textContent).toContain("11:05");
    expect(document.body.textContent).toContain("等待已超过 10 分钟");
    expect(document.body.textContent).toContain("重试连接");
    expect(document.body.textContent).toContain("安全返回");
  });

  it("gives cancellation a synchronous single decision over match-found", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    storeSession();
    renderPage();
    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("取消匹配"),
    )!;

    act(() => {
      cancelButton.click();
      cancelButton.click();
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("section")?.getAttribute("aria-busy"),
    ).toBe("true");

    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      phase: "playing",
      players: [
        { player_id: "player-1", display_name: "donk" },
        { player_id: "player-2", display_name: "m0NESY" },
      ],
    };
    renderPage();
    expect(
      document.body.querySelectorAll('[role="dialog"]'),
    ).toHaveLength(1);

    response.resolve(new Response(null, { status: 204 }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.realtime.close).toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps the ticket tombstone after failure without resuming the room socket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    storeSession();
    renderPage();
    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("取消匹配"),
    )!;

    await act(async () => {
      cancelButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("对战服务暂时不可用");
    expect(document.activeElement?.textContent).toContain("未能退出匹配");
    expect(
      sessionStorage.getItem("cs-guess:realtime-session"),
    ).not.toBeNull();
    expect(
      sessionStorage.getItem("cs-guess:realtime-closing-intent"),
    ).not.toBeNull();
    expect(mocks.realtime.close).toHaveBeenCalled();
  });

  it("resumes a persisted cancellation after refresh and clears both records", async () => {
    storeSession();
    const credentials = loadCredentials("quick")!.credentials;
    saveClosingIntent(credentials, "/quick?difficulty=easy");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    expect(container.textContent).toContain("正在完成退出");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("cs-guess:realtime-session")).toBeNull();
    expect(
      sessionStorage.getItem("cs-guess:realtime-closing-intent"),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/quick");
  });

  it("clears a fatal ticket and replaces the route instead of retrying its token", () => {
    mocks.realtime.connection = "offline";
    mocks.realtime.offlineReason = "session_invalid";
    mocks.realtime.error = "会话已失效，请退出后重新加入。";
    storeSession();
    renderPage();

    expect(findButton("重试房间连接")).toBeUndefined();
    expect(document.activeElement?.textContent).toContain(
      "当前匹配会话已失效",
    );

    act(() => findButton("清除失效会话并返回")?.click());

    expect(mocks.realtime.close).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/quick");
  });

  it("keeps offline and cancellation failures inside one alert", async () => {
    mocks.realtime.connection = "offline";
    mocks.realtime.offlineReason = "reconnect_timeout";
    mocks.realtime.error = "连接超时，无法恢复实时连接。";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    storeSession();
    renderPage();

    await act(async () => {
      findButton("安全返回")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.body.querySelectorAll('[role="alertdialog"]'),
    ).toHaveLength(1);
    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("对战服务暂时不可用");
  });

  it("uses an immediate reduced-motion transition after match found", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    mocks.realtime.error = "";
    mocks.realtime.connection = "connected";
    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      phase: "playing",
    };
    storeSession();
    renderPage();

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/matching");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/play/quick");
    expect(
      container
        .querySelector('[data-testid="location"]')
        ?.getAttribute("data-focus-game-heading"),
    ).toBe("true");
  });

  it("marks the CTA navigation target as the next focus destination", () => {
    mocks.realtime.error = "";
    mocks.realtime.connection = "connected";
    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      phase: "playing",
    };
    storeSession();
    renderPage();

    act(() => {
      (
        mocks.matchFoundProps?.onEnter as (() => void) | undefined
      )?.();
    });

    const location = container.querySelector('[data-testid="location"]');
    expect(location?.textContent).toBe("/play/quick");
    expect(location?.getAttribute("data-focus-game-heading")).toBe("true");
  });
});
