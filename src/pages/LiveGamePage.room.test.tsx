/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveGamePage } from "@/pages/LiveGamePage";
import {
  loadCredentials,
  saveClosingIntent,
} from "@/lib/realtime";

const mocks = vi.hoisted(() => ({
  recordRound: vi.fn(),
  celebrationProps: null as Record<string, unknown> | null,
  battleContextProps: null as Record<string, unknown> | null,
  playerSearchProps: null as Record<string, any> | null,
  realtime: {
    connection: "connected",
    offlineReason: null as
      | "reconnect_timeout"
      | "session_invalid"
      | "profile_invalid"
      | "configuration"
      | null,
    snapshot: {} as Record<string, unknown>,
    events: [] as Array<Record<string, unknown>>,
    error: "",
    retry: vi.fn(),
    close: vi.fn(),
    setError: vi.fn(),
    send: vi.fn(
      (
        _type: string,
        _payload?: Record<string, unknown>,
        _callback?: (accepted: boolean) => void,
      ) => "request-default",
    ),
  },
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({ recordRound: mocks.recordRound }),
}));

vi.mock("@/hooks/use-realtime-room", () => ({
  useRealtimeRoom: () => mocks.realtime,
}));

vi.mock("@/components/BattleContext", () => ({
  BattleContext: (props: Record<string, unknown>) => {
    mocks.battleContextProps = props;
    return <div data-testid="battle-context" />;
  },
}));

vi.mock("@/components/GuessTable", () => ({
  GuessTable: () => <div data-testid="guess-table" />,
}));

vi.mock("@/components/PlayerSearch", () => ({
  PlayerSearch: (props: Record<string, any>) => {
    mocks.playerSearchProps = props;
    return <div data-testid="player-search" />;
  },
}));

vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: (props: Record<string, unknown>) => {
    mocks.celebrationProps = props;
    return <div data-testid="celebration-overlay" />;
  },
}));

vi.mock("@/components/InfoTip", () => ({
  InfoTip: ({ children }: { children: React.ReactNode }) => (
    <span hidden>{children}</span>
  ),
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

function roomSnapshot({
  selfPlayerId = "player-1",
  hostPlayerId = "player-1",
  maxPlayers = 4,
  players = [
    {
      player_id: "player-1",
      seat_index: 0,
      display_name: "donk",
      connected: true,
    },
  ],
}: {
  selfPlayerId?: string;
  hostPlayerId?: string;
  maxPlayers?: number;
  players?: Array<Record<string, unknown>>;
} = {}) {
  return {
    seq: 1,
    phase: "waiting",
    room_code: "CS-123456",
    self_player_id: selfPlayerId,
    host_player_id: hostPlayerId,
    max_players: maxPlayers,
    max_guesses: 8,
    best_of: 3,
    difficulty: "hard",
    visibility: "open",
    round_number: 0,
    players,
  };
}

function storeRoomSession() {
  sessionStorage.setItem(
    "cs-guess:realtime-session",
    JSON.stringify({
      credentials: {
        roomCode: "CS-123456",
        playerId: "player-1",
        sessionToken: "secret-token",
        socketIoUrl: "/socket.io",
        mode: "room",
      },
      snapshot: mocks.realtime.snapshot,
      startedAt: Date.now(),
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPage(
  initialEntry:
    | string
    | { pathname: string; state?: Record<string, unknown> } =
    "/play/room",
) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <LiveGamePage mode="room" />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

function findLink(text: string) {
  return Array.from(container.querySelectorAll("a")).find(
    (link) => link.textContent?.trim() === text,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  sessionStorage.clear();
  mocks.realtime.connection = "connected";
  mocks.realtime.offlineReason = null;
  mocks.realtime.snapshot = roomSnapshot();
  mocks.realtime.events = [];
  mocks.realtime.error = "";
  mocks.realtime.retry.mockClear();
  mocks.realtime.close.mockClear();
  mocks.realtime.send.mockClear();
  mocks.realtime.send.mockReturnValue("request-default");
  mocks.recordRound.mockClear();
  mocks.celebrationProps = null;
  mocks.playerSearchProps = null;
  storeRoomSession();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LiveGamePage friend-room waiting state", () => {
  it("focuses the game heading when match-found navigation requests handoff", () => {
    renderPage({
      pathname: "/play/room",
      state: { focusGameHeading: true },
    });

    const title = container.querySelector<HTMLHeadingElement>("h1");
    expect(title?.textContent).toContain("好友房间");
    expect(title?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(title);
  });

  it("renders a dedicated waiting lobby without mounting the active battle UI", () => {
    renderPage();

    const lobby = container.querySelector(
      '[aria-label="好友房设置与成员"]',
    );
    expect(lobby).not.toBeNull();
    expect(lobby?.textContent).toContain("房间成员");
    expect(lobby?.textContent).toContain("1 / 4");
    expect(lobby?.querySelectorAll('[aria-label="房间席位"] > li')).toHaveLength(
      4,
    );
    expect(lobby?.textContent).toContain("等待加入");
    expect(findButton("开始本轮")).toBeTruthy();

    expect(container.querySelector("[data-testid='battle-context']")).toBeNull();
    expect(container.querySelector("[data-testid='guess-table']")).toBeNull();
    expect(container.querySelector("[data-testid='player-search']")).toBeNull();
    expect(container.textContent).not.toContain("神秘选手");
    expect(container.textContent).not.toContain("WAITING FOR ROUND");
  });

  it("hides answer and legend chrome during play and restores it after the round", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({ maxPlayers: 2 }),
      phase: "playing",
      round_number: 1,
      deadline_unix_ms: Date.now() + 60_000,
    };
    storeRoomSession();
    renderPage();

    expect(container.textContent).not.toContain("神秘选手");
    expect(container.textContent).not.toContain("结果图例");
    expect(container.textContent).not.toContain("SERVER AUTHORITATIVE");

    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      phase: "finished",
      winner_player_id: "player-1",
      mystery_id: "donk",
      series_status: "active",
    };
    renderPage();

    expect(container.textContent).toContain("神秘选手");
    expect(container.textContent).toContain("结果图例");
    expect(container.textContent).toContain("Major 参赛");
    expect(container.textContent).toContain("Major 冠军");
  });

  it("restores result focus after review but focuses the closing shell after exit", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
    mocks.realtime.snapshot = {
      ...roomSnapshot({ maxPlayers: 2 }),
      phase: "finished",
      round_number: 1,
      winner_player_id: "player-1",
      series_winner_player_id: "player-1",
      series_status: "completed",
      mystery_id: "donk",
    };
    storeRoomSession();
    renderPage();

    const closeAutoFocus = mocks.celebrationProps
      ?.onCloseAutoFocus as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    act(() => {
      (mocks.celebrationProps?.onClose as (() => void) | undefined)?.();
    });
    const reviewEvent = { preventDefault: vi.fn() };
    act(() => closeAutoFocus?.(reviewEvent));
    expect(reviewEvent.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLHeadingElement>("h1"),
    );

    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      round_number: 2,
    };
    storeRoomSession();
    renderPage();
    const exitAutoFocus = mocks.celebrationProps
      ?.onCloseAutoFocus as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    act(() => {
      (mocks.celebrationProps?.onExit as (() => void) | undefined)?.();
    });
    const exitEvent = { preventDefault: vi.fn() };
    act(() => exitAutoFocus?.(exitEvent));

    const closingTitle = document.body.querySelector<HTMLHeadingElement>(
      '[role="dialog"] h2',
    );
    expect(exitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(closingTitle?.textContent).toContain("正在完成退出");
    expect(closingTitle?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(closingTitle);
  });

  it("restores a room-and-round scoped search draft and clears it after an accepted guess", async () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot(),
      phase: "playing",
      round_number: 2,
      deadline_unix_ms: Date.now() + 60_000,
      own_guesses: [],
      opponent_progress: [],
    };
    storeRoomSession();
    const key = "cs-guess:live-guess-draft:CS-123456:round:2";
    sessionStorage.setItem(
      key,
      JSON.stringify({ query: "don", selectedId: "donk" }),
    );
    renderPage();
    await flush();

    expect(mocks.playerSearchProps?.query).toBe("don");
    expect(mocks.playerSearchProps?.selectedPlayer?.id).toBe("donk");

    act(() => mocks.playerSearchProps?.onQueryChange("donk"));
    expect(JSON.parse(sessionStorage.getItem(key) ?? "{}")).toMatchObject({
      query: "donk",
      selectedId: "donk",
    });

    act(() => {
      void mocks.playerSearchProps?.onSubmit("donk");
    });
    expect(mocks.realtime.send).toHaveBeenLastCalledWith(
      "guess",
      { player_id: "donk" },
      expect.any(Function),
    );
    expect(sessionStorage.getItem(key)).not.toBeNull();

    mocks.realtime.events = [
      {
        type: "guess_accepted",
        seq: 2,
        request_id: "request-default",
        player_id: "donk",
        guess_number: 1,
      },
    ];
    renderPage();
    await flush();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mocks.playerSearchProps?.query).toBe("");
  });

  it("retains the authoritative live draft when send or acknowledgement fails", async () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot(),
      phase: "playing",
      round_number: 2,
      deadline_unix_ms: Date.now() + 60_000,
      own_guesses: [],
      opponent_progress: [],
    };
    storeRoomSession();
    const key = "cs-guess:live-guess-draft:CS-123456:round:2";
    sessionStorage.setItem(
      key,
      JSON.stringify({ query: "donk", selectedId: "donk" }),
    );
    renderPage();
    await flush();

    mocks.realtime.send.mockReturnValueOnce(false as never);
    let sendFailed!: Promise<boolean>;
    act(() => {
      sendFailed = mocks.playerSearchProps?.onSubmit("donk");
    });
    await expect(sendFailed).resolves.toBe(false);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(mocks.playerSearchProps?.query).toBe("donk");

    let acknowledge: ((accepted: boolean) => void) | undefined;
    mocks.realtime.send.mockImplementationOnce(
      (
        _type: string,
        _payload?: Record<string, unknown>,
        callback?: (accepted: boolean) => void,
      ) => {
        acknowledge = callback;
        return "request-rejected";
      },
    );
    let rejected!: Promise<boolean>;
    act(() => {
      rejected = mocks.playerSearchProps?.onSubmit("donk");
    });
    act(() => acknowledge?.(false));
    await expect(rejected).resolves.toBe(false);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(mocks.playerSearchProps?.selectedPlayer?.id).toBe("donk");
  });

  it("single-flights a guess and ignores a late old acknowledgement after the round changes", async () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot(),
      phase: "playing",
      round_number: 2,
      deadline_unix_ms: Date.now() + 60_000,
      own_guesses: [],
      opponent_progress: [],
    };
    storeRoomSession();
    const oldKey = "cs-guess:live-guess-draft:CS-123456:round:2";
    sessionStorage.setItem(
      oldKey,
      JSON.stringify({ query: "donk", selectedId: "donk" }),
    );
    let acknowledge: ((accepted: boolean) => void) | undefined;
    mocks.realtime.send.mockImplementationOnce(
      (
        _type: string,
        _payload?: Record<string, unknown>,
        callback?: (accepted: boolean) => void,
      ) => {
        acknowledge = callback;
        return "request-old-round";
      },
    );
    renderPage();
    await flush();

    let first!: Promise<boolean>;
    let duplicate!: boolean;
    act(() => {
      first = mocks.playerSearchProps?.onSubmit("donk");
      duplicate = mocks.playerSearchProps?.onSubmit("donk");
    });
    expect(duplicate).toBe(false);
    expect(mocks.realtime.send).toHaveBeenCalledTimes(1);

    const newKey = "cs-guess:live-guess-draft:CS-123456:round:3";
    sessionStorage.setItem(
      newKey,
      JSON.stringify({ query: "zywoo", selectedId: "zywoo" }),
    );
    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      seq: 2,
      round_number: 3,
    };
    renderPage();
    await flush();
    await expect(first).resolves.toBe(false);

    act(() => acknowledge?.(true));
    await flush();
    expect(sessionStorage.getItem(newKey)).not.toBeNull();
    expect(mocks.playerSearchProps?.query).toBe("zywoo");
    expect(mocks.playerSearchProps?.selectedPlayer?.id).toBe("zywoo");
  });

  it("renders a neutral connection shell before the first authoritative snapshot", () => {
    mocks.realtime.connection = "connecting";
    mocks.realtime.snapshot = {};
    storeRoomSession();
    renderPage();

    expect(container.textContent).toContain("正在连接");
    expect(container.textContent).toContain("正在获取服务器确认的房间设置");
    expect(container.textContent).toContain("ROOM · CS-123456");
    expect(findButton("重试连接")).toBeTruthy();
    expect(findButton("退出房间")).toBeTruthy();
    expect(container.querySelector("[data-testid='battle-context']")).toBeNull();
    expect(container.querySelector("[data-testid='guess-table']")).toBeNull();
    expect(container.querySelector("[data-testid='player-search']")).toBeNull();
    expect(container.textContent).not.toContain("BO3");
    expect(container.textContent).not.toContain("0 / 8");
    expect(container.textContent).not.toContain("等待玩家准备");
    expect(container.querySelectorAll("[role='status']")).toHaveLength(1);
    expect(
      container.querySelector("[role='status']")?.textContent,
    ).toBe("正在连接");
  });

  it("reserves recovery wording for an actual reconnect and keeps offline recovery actionable", () => {
    mocks.realtime.snapshot = {};
    mocks.realtime.connection = "reconnecting";
    storeRoomSession();
    renderPage();

    expect(container.textContent).toContain("正在重连");
    expect(container.textContent).toContain("连接恢复后会重新同步房间");
    expect(container.textContent).not.toContain("正在连接对战服务器");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    mocks.realtime.connection = "offline";
    mocks.realtime.error =
      "连接超时，无法恢复实时连接。你可以立即重试或安全退出。";
    renderPage();

    expect(container.textContent).toContain("实时连接不可用");
    expect(container.textContent).toContain("尚未取得可用的房间状态");
    expect(
      document.body.querySelector("[role='alertdialog']")?.textContent,
    ).toContain("连接超时");
    expect(
      document.body.querySelectorAll('[role="alertdialog"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(findButton("重试连接")).toBeTruthy();
  });

  it("announces an in-room reconnect once while keeping its visual retry action", () => {
    mocks.realtime.connection = "reconnecting";
    mocks.realtime.error = "实时连接中断，正在自动重连。";
    renderPage();

    const connectionStatuses = Array.from(
      container.querySelectorAll('[role="status"]'),
    ).filter((node) => node.textContent?.includes("连接中断"));
    expect(connectionStatuses).toHaveLength(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "实时连接中断，正在自动重连。",
    );
    expect(findButton("立即重连")).toBeTruthy();
  });

  it.each([204, 401, 403, 404])(
    "leaves explicitly on DELETE %s, clears the exact session, and replaces the route",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(null, { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderPage();

      act(() => findLink("模式大厅")?.click());
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(url.pathname).toBe("/v1/rooms/CS-123456");
      expect(url.searchParams.get("session_token")).toBe("secret-token");
      expect(init).toMatchObject({ method: "DELETE", keepalive: true });
      expect(mocks.realtime.close).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("cs-guess:realtime-session")).toBeNull();
      expect(
        container.querySelector('[data-testid="location"]')?.textContent,
      ).toBe("/");
    },
  );

  it("keeps the live session and offers retry when leaving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    renderPage();

    act(() => findLink("模式大厅")?.click());
    await flush();

    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("退出房间失败，凭证已保留");
    expect(findButton("重试退出")).toBeTruthy();
    expect(mocks.realtime.close).toHaveBeenCalled();
    expect(sessionStorage.getItem("cs-guess:realtime-session")).not.toBeNull();
    expect(
      sessionStorage.getItem("cs-guess:realtime-closing-intent"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/play/room");
  });

  it.each([200, 201])(
    "rejects unexpected successful-looking leave status %s and keeps the session",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );
      renderPage();

      act(() => findLink("模式大厅")?.click());
      await flush();

      expect(
        document.body.querySelector('[role="alertdialog"]')?.textContent,
      ).toContain("退出房间失败，凭证已保留");
      expect(mocks.realtime.close).toHaveBeenCalled();
      expect(
        sessionStorage.getItem("cs-guess:realtime-session"),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="location"]')?.textContent,
      ).toBe("/play/room");
    },
  );

  it("does not leave the server room merely because the page unmounts", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    act(() => root.unmount());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("cs-guess:realtime-session")).not.toBeNull();
  });

  it("resumes an exact persisted exit after refresh without reconnecting the old room", async () => {
    const credentials = loadCredentials("room")!.credentials;
    saveClosingIntent(credentials, "/");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    expect(document.body.textContent).toContain("正在完成退出");
    expect(container.textContent).not.toContain("凭证已保存");
    expect(
      container.querySelector("[data-testid='guess-table']"),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="好友房设置与成员"]'),
    ).not.toBeNull();
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("cs-guess:realtime-session")).toBeNull();
    expect(
      sessionStorage.getItem("cs-guess:realtime-closing-intent"),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/");
  });

  it("clears an old exit after a late success without navigating over a newer session", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    renderPage();

    act(() => findLink("模式大厅")?.click());
    sessionStorage.setItem(
      "cs-guess:realtime-session",
      JSON.stringify({
        credentials: {
          roomCode: "CS-654321",
          playerId: "player-new",
          sessionToken: "new-token",
          socketIoUrl: "/socket.io",
          mode: "room",
        },
        snapshot: roomSnapshot({
          selfPlayerId: "player-new",
          hostPlayerId: "player-new",
        }),
        startedAt: Date.now(),
      }),
    );
    pending.resolve(new Response(null, { status: 204 }));
    await flush();

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/play/room");
    expect(loadCredentials("room")?.credentials.sessionToken).toBe(
      "new-token",
    );
  });

  it("finishes exact cleanup but never navigates after the page unmounts", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    renderPage();

    act(() => findLink("模式大厅")?.click());
    act(() => root.unmount());
    pending.resolve(new Response(null, { status: 204 }));
    await flush();

    expect(sessionStorage.getItem("cs-guess:realtime-session")).toBeNull();
    expect(
      sessionStorage.getItem("cs-guess:realtime-closing-intent"),
    ).toBeNull();
  });

  it("replaces a direct live-room visit without credentials before rendering a recovery shell", () => {
    sessionStorage.clear();
    renderPage();

    expect(container.textContent).not.toContain("凭证已保存");
    expect(container.textContent).not.toContain("正在连接");
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/room");
  });

  it("replaces a direct live-quick visit without credentials before rendering a recovery shell", () => {
    sessionStorage.clear();
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/play/quick"]}>
          <LiveGamePage mode="quick" />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("凭证已保存");
    expect(container.textContent).not.toContain("正在连接");
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/quick");
  });

  it("copies the room code with success feedback and falls back to selection copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderPage();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="复制房间号 CS-123456"]',
        )
        ?.click(),
    );
    await flush();

    expect(writeText).toHaveBeenCalledWith("CS-123456");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(
      Array.from(
        container.querySelectorAll('[aria-live="polite"]'),
      ).some((node) => node.textContent === "房间号已复制"),
    ).toBe(
      true,
    );
  });

  it("prefers the native clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderPage();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="复制房间号 CS-123456"]',
        )
        ?.click(),
    );
    await flush();

    expect(writeText).toHaveBeenCalledWith("CS-123456");
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain("房间号已复制");
  });

  it("announces copy failure when neither clipboard path works", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    renderPage();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="复制房间号 CS-123456"]',
        )
        ?.click(),
    );
    await flush();

    expect(
      Array.from(
        container.querySelectorAll('[aria-live="polite"]'),
      ).some(
        (node) => node.textContent === "复制失败，请手动复制房间号",
      ),
    ).toBe(
      true,
    );
  });

  it("shows a centralized rules summary, the stable host, and updates after host transfer", () => {
    const players = [
      {
        player_id: "player-1",
        seat_index: 0,
        display_name: "donk",
        connected: true,
      },
      {
        player_id: "player-2",
        seat_index: 1,
        display_name: "m0NESY",
        connected: true,
      },
    ];
    mocks.realtime.snapshot = roomSnapshot({ players });
    renderPage();

    const summary = container.querySelector(
      '[aria-label="好友房设置与成员"]',
    )!;
    expect(summary.textContent).toContain("4 人 · 明牌 · 困难 · BO3");
    expect(
      summary.querySelector('[data-player-id="player-1"]')?.textContent,
    ).toContain("donk房主");
    expect(
      summary.querySelector('[data-player-id="player-2"]')?.textContent,
    ).not.toContain("房主");

    mocks.realtime.snapshot = roomSnapshot({
      selfPlayerId: "player-2",
      hostPlayerId: "player-2",
      players: [players[1]],
    });
    renderPage();

    const transferred = container.querySelector(
      '[aria-label="好友房设置与成员"]',
    )!;
    expect(
      transferred.querySelector('[data-player-id="player-2"]')?.textContent,
    ).toContain("m0NESY房主");
  });

  it("explains every disabled start state and never promises automatic start", () => {
    renderPage();
    let start = findButton("开始本轮")!;
    expect(start.disabled).toBe(true);
    expect(container.textContent).toContain("还需 3 位成员连接");
    expect(container.textContent).not.toContain("自动开始");

    mocks.realtime.snapshot = roomSnapshot({
      selfPlayerId: "player-1",
      hostPlayerId: "player-2",
      players: [
        {
          player_id: "player-1",
          seat_index: 0,
          display_name: "donk",
          connected: true,
        },
        {
          player_id: "player-2",
          seat_index: 1,
          display_name: "m0NESY",
          connected: true,
        },
      ],
    });
    renderPage();
    start = findButton("开始本轮")!;
    expect(start.disabled).toBe(true);
    expect(container.textContent).toContain("仅房主可以开始");

    mocks.realtime.connection = "connecting";
    renderPage();
    expect(container.textContent).toContain("正在连接服务器");
  });

  it("requires every fixed room seat and reports the exact four-player readiness", () => {
    const players = [
      {
        player_id: "player-1",
        seat_index: 0,
        display_name: "donk",
        connected: true,
      },
      {
        player_id: "player-2",
        seat_index: 1,
        display_name: "m0NESY",
        connected: true,
      },
    ];
    mocks.realtime.snapshot = roomSnapshot({ players });
    renderPage();

    expect(findButton("开始本轮")?.disabled).toBe(true);
    expect(container.textContent).toContain("还需 2 位成员连接");
    expect(container.textContent).not.toContain("成员已就位");

    mocks.realtime.snapshot = roomSnapshot({
      players: [
        ...players,
        {
          player_id: "player-3",
          seat_index: 2,
          display_name: "ZywOo",
          connected: true,
        },
        {
          player_id: "player-4",
          seat_index: 3,
          display_name: "sh1ro",
          connected: true,
        },
      ],
    });
    renderPage();

    expect(findButton("开始本轮")?.disabled).toBe(false);
    expect(container.textContent).toContain("房主可以开始本轮");
  });

  it("single-flights the host start request and preserves ack errors for retry", () => {
    mocks.realtime.snapshot = roomSnapshot({
      maxPlayers: 2,
      players: [
        {
          player_id: "player-1",
          seat_index: 0,
          display_name: "donk",
          connected: true,
        },
        {
          player_id: "player-2",
          seat_index: 1,
          display_name: "m0NESY",
          connected: true,
        },
      ],
    });
    renderPage();
    const start = findButton("开始本轮")!;

    act(() => {
      start.click();
      start.click();
    });

    expect(mocks.realtime.send).toHaveBeenCalledTimes(1);
    expect(mocks.realtime.send.mock.calls[0]?.[0]).toBe("start_round");
    expect(findButton("正在开始")?.disabled).toBe(true);
    expect(container.textContent).toContain("正在通知所有成员");

    mocks.realtime.error = "服务器未接受本次操作，请重试。";
    renderPage();
    expect(
      document.body.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("服务器未接受本次操作，请重试。");
  });

  it("recovers after consecutive identical start ack failures", () => {
    const callbacks: Array<(accepted: boolean) => void> = [];
    mocks.realtime.snapshot = roomSnapshot({
      maxPlayers: 2,
      players: [
        {
          player_id: "player-1",
          seat_index: 0,
          display_name: "donk",
          connected: true,
        },
        {
          player_id: "player-2",
          seat_index: 1,
          display_name: "m0NESY",
          connected: true,
        },
      ],
    });
    mocks.realtime.send.mockImplementation(
      (
        _type: string,
        _payload?: Record<string, unknown>,
        callback?: (accepted: boolean) => void,
      ) => {
        if (callback) callbacks.push(callback);
        return "start-request";
      },
    );
    renderPage();

    act(() => findButton("开始本轮")?.click());
    expect(mocks.realtime.send).toHaveBeenCalledTimes(1);
    expect(findButton("正在开始")?.disabled).toBe(true);

    act(() => callbacks[0]?.(false));
    mocks.realtime.error = "服务器未接受本次操作，请重试。";
    renderPage();
    expect(findButton("开始本轮")?.disabled).toBe(false);

    act(() => findButton("开始本轮")?.click());
    expect(mocks.realtime.send).toHaveBeenCalledTimes(2);
    expect(findButton("正在开始")?.disabled).toBe(true);

    act(() => callbacks[1]?.(false));
    renderPage();
    expect(findButton("开始本轮")?.disabled).toBe(false);

    act(() => findButton("开始本轮")?.click());
    expect(mocks.realtime.send).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["disconnect_forfeit", "disconnect_forfeit"],
    ["solved", "solved"],
  ] as const)(
    "passes the authoritative %s finish reason into the result dialog",
    (finishReason, expected) => {
      mocks.realtime.snapshot = {
        ...roomSnapshot({
          players: [
            {
              player_id: "player-1",
              seat_index: 0,
              display_name: "donk",
              connected: true,
              score: 1,
            },
            {
              player_id: "player-2",
              seat_index: 1,
              display_name: "m0NESY",
              connected: false,
              score: 0,
            },
          ],
        }),
        phase: "finished",
        round_number: 1,
        winner_player_id: "player-1",
        finish_reason: finishReason,
        mystery_id: "donk",
      };
      renderPage();

      expect(container.querySelector('[data-testid="celebration-overlay"]')).toBeTruthy();
      expect(mocks.celebrationProps?.finishReason).toBe(expected);
    },
  );

  it("uses the neutral legacy result path when an old snapshot has no reason", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot(),
      phase: "finished",
      winner_player_id: "player-1",
      mystery_id: "donk",
    };
    renderPage();

    expect(mocks.celebrationProps?.finishReason).toBeUndefined();
  });

  it("persists a viewed result per room and result identity without affecting a new round", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot(),
      phase: "finished",
      round_number: 1,
      winner_player_id: "player-1",
      finish_reason: "solved",
      mystery_id: "donk",
    };
    renderPage();
    expect(container.querySelector('[data-testid="celebration-overlay"]')).toBeTruthy();

    act(() => {
      (mocks.celebrationProps?.onClose as (() => void) | undefined)?.();
    });
    expect(container.querySelector('[data-testid="celebration-overlay"]')).toBeFalsy();

    act(() => root.unmount());
    root = createRoot(container);
    mocks.celebrationProps = null;
    renderPage();
    expect(container.querySelector('[data-testid="celebration-overlay"]')).toBeFalsy();

    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      round_number: 2,
      mystery_id: "m0nesy",
    };
    renderPage();
    expect(container.querySelector('[data-testid="celebration-overlay"]')).toBeTruthy();
  });

  it("uses the authoritative friend-room countdown and removes the racing manual next-round action", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: true,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
          },
        ],
      }),
      phase: "finished",
      round_number: 1,
      winner_player_id: "player-1",
      finish_reason: "solved",
      mystery_id: "donk",
      series_status: "active",
      next_round_unix_ms: Date.now() + 4_000,
    };
    renderPage();

    expect(container.textContent).toContain("秒后自动开始");
    expect(findButton("开始下一轮")).toBeUndefined();
    expect(mocks.celebrationProps?.nextRoundPaused).toBe(false);
  });

  it("renders an abandoned four-player series with retained final standings and no winner", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: true,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
          },
          {
            player_id: "player-4",
            seat_index: 3,
            display_name: "sh1ro",
            connected: true,
          },
        ],
      }),
      phase: "finished",
      round_number: 2,
      finish_reason: "member_left",
      series_status: "abandoned",
      series_finish_reason: "member_left_abandoned",
      mystery_id: "donk",
      series_final_standings: [
        {
          player_id: "player-1",
          display_name: "donk",
          seat_index: 0,
          score: 1,
          left_series: false,
        },
        {
          player_id: "player-2",
          display_name: "m0NESY",
          seat_index: 1,
          score: 1,
          left_series: false,
        },
        {
          player_id: "player-3",
          display_name: "ZywOo",
          seat_index: 2,
          score: 0,
          left_series: true,
        },
        {
          player_id: "player-4",
          display_name: "sh1ro",
          seat_index: 3,
          score: 0,
          left_series: false,
        },
      ],
    };
    renderPage();

    expect(mocks.celebrationProps).toMatchObject({
      outcome: "draw",
      seriesComplete: true,
      seriesStatus: "abandoned",
      seriesFinishReason: "member_left_abandoned",
      finishReason: "member_left",
    });
    expect(mocks.celebrationProps?.standings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ZywOo（已离开）" }),
      ]),
    );
    expect(container.textContent).toContain("SERIES ABANDONED");
    expect(findButton("返回模式大厅")).toBeTruthy();
  });

  it("renders an authoritative per-round series review and safely labels old snapshots", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: true,
            score: 2,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
            score: 1,
          },
        ],
      }),
      phase: "finished",
      round_number: 3,
      winner_player_id: "player-1",
      series_winner_player_id: "player-1",
      finish_reason: "solved",
      series_status: "completed",
      series_finish_reason: "score_limit",
      mystery_id: "donk",
      round_results: [
        {
          round_number: 1,
          mystery_id: "m0nesy",
          finish_reason: "solved",
          winner_player_id: "player-2",
          standings: [
            {
              player_id: "player-1",
              display_name: "donk",
              seat_index: 0,
              score: 0,
              rank: 2,
            },
            {
              player_id: "player-2",
              display_name: "m0NESY",
              seat_index: 1,
              score: 1,
              rank: 1,
            },
          ],
        },
        {
          round_number: 2,
          mystery_id: "donk",
          finish_reason: "solved",
          winner_player_id: "player-1",
          standings: [
            {
              player_id: "player-1",
              display_name: "donk",
              seat_index: 0,
              score: 1,
              rank: 1,
            },
            {
              player_id: "player-2",
              display_name: "m0NESY",
              seat_index: 1,
              score: 1,
              rank: 1,
            },
          ],
        },
      ],
    };
    renderPage();

    expect(container.textContent).toContain("各轮回顾");
    expect(container.textContent).toContain("2 轮");
    expect(container.textContent).toContain("m0NESY 获胜");
    expect(container.textContent).toContain("第 2 轮");

    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      round_results: undefined,
    };
    renderPage();
    expect(container.textContent).toContain(
      "此对局来自旧版本，未包含逐轮记录",
    );
  });

  it("lets only the friend-room host request an idempotent server restart", async () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: true,
            score: 1,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
            score: 0,
          },
        ],
      }),
      phase: "finished",
      winner_player_id: "player-1",
      series_winner_player_id: "player-1",
      series_status: "completed",
      mystery_id: "donk",
    };
    renderPage();

    act(() => findButton("开始下一场")?.click());
    expect(mocks.realtime.send).toHaveBeenCalledTimes(1);
    expect(mocks.realtime.send.mock.calls[0]?.[0]).toBe("restart_series");
    expect(findButton("正在重置")).toBeTruthy();

    act(() => findButton("正在重置")?.click());
    expect(mocks.realtime.send).toHaveBeenCalledTimes(1);

    const ack = mocks.realtime.send.mock.calls[0]?.[2] as
      | ((accepted: boolean) => void)
      | undefined;
    act(() => ack?.(false));
    await flush();
    expect(findButton("开始下一场")).toBeTruthy();

    act(() => root.unmount());
    root = createRoot(container);
    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      self_player_id: "player-2",
    };
    mocks.realtime.send.mockClear();
    renderPage();
    expect(findButton("开始下一场")).toBeUndefined();
    expect(container.textContent).toContain("等待房主开始下一场");
  });

  it("disables every terminal restart action while offline and explains recovery", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: true,
            score: 1,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
            score: 0,
          },
        ],
      }),
      phase: "finished",
      winner_player_id: "player-1",
      series_winner_player_id: "player-1",
      series_status: "completed",
      mystery_id: "donk",
    };
    mocks.realtime.connection = "offline";
    mocks.realtime.offlineReason = "reconnect_timeout";
    mocks.realtime.error = "连接超时，无法恢复实时连接。";
    renderPage();

    expect(findButton("开始下一场")?.disabled).toBe(true);
    expect(container.textContent).toContain("恢复连接后可开始下一场");
    expect(mocks.celebrationProps).toMatchObject({
      rematchDisabled: true,
      rematchDisabledReason: "恢复连接后可再次对战",
    });
    act(() => findButton("开始下一场")?.click());
    expect(mocks.realtime.send).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain("连接需要处理");

    mocks.realtime.connection = "connected";
    mocks.realtime.offlineReason = null;
    mocks.realtime.error = "";
    renderPage();
    expect(
      document.body.querySelector('[role="alertdialog"]'),
    ).toBeNull();
    expect(findButton("查看对局")).toBeTruthy();
  });

  it("replaces a fatal room session with a clean join entry", () => {
    mocks.realtime.connection = "offline";
    mocks.realtime.offlineReason = "session_invalid";
    mocks.realtime.error = "会话已失效，请退出后重新加入。";
    renderPage();

    expect(findButton("立即重连")).toBeUndefined();
    act(() => findButton("重新加入房间")?.click());

    expect(mocks.realtime.close).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/room");
  });

  it("moves the host marker and restart CTA when a terminal snapshot transfers authority", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        selfPlayerId: "player-2",
        hostPlayerId: "player-1",
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: false,
            forfeited_this_round: true,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
            score: 1,
          },
        ],
      }),
      phase: "finished",
      series_status: "completed",
      series_winner_player_id: "player-2",
      mystery_id: "donk",
    };
    renderPage();
    expect(findButton("开始下一场")).toBeUndefined();
    expect(mocks.battleContextProps?.hostPlayerId).toBe("player-1");

    mocks.realtime.snapshot = {
      ...mocks.realtime.snapshot,
      seq: 2,
      host_player_id: "player-2",
      players: [
        {
          player_id: "player-2",
          seat_index: 1,
          display_name: "m0NESY",
          connected: true,
          score: 1,
        },
      ],
    };
    renderPage();

    expect(mocks.battleContextProps?.hostPlayerId).toBe("player-2");
    expect(findButton("开始下一场")).toBeTruthy();
    act(() => findButton("开始下一场")?.click());
    expect(mocks.realtime.send.mock.calls.at(-1)?.[0]).toBe("restart_series");
  });

  it("applies host authority from the terminal event before the final snapshot arrives", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({
        selfPlayerId: "player-2",
        hostPlayerId: "player-1",
        maxPlayers: 2,
        players: [
          {
            player_id: "player-1",
            seat_index: 0,
            display_name: "donk",
            connected: false,
            forfeited_this_round: true,
          },
          {
            player_id: "player-2",
            seat_index: 1,
            display_name: "m0NESY",
            connected: true,
            score: 1,
          },
        ],
      }),
      seq: 1,
      phase: "finished",
      series_status: "active",
      mystery_id: "donk",
    };
    mocks.realtime.events = [
      {
        type: "round_finished",
        seq: 2,
        round_number: 1,
        host_player_id: "player-2",
        winner_player_id: "player-2",
        series_winner_player_id: "player-2",
        series_status: "completed",
        series_finish_reason: "member_left_forfeit",
        finish_reason: "disconnect_forfeit",
        mystery_id: "donk",
        scores: [{ player_id: "player-2", score: 1 }],
      },
    ];
    renderPage();

    expect(mocks.battleContextProps?.hostPlayerId).toBe("player-2");
    expect(findButton("开始下一场")).toBeTruthy();
  });

  it("marks a BO1 draw as an authoritative tiebreak instead of a completed series", () => {
    mocks.realtime.snapshot = {
      ...roomSnapshot({ maxPlayers: 2 }),
      best_of: 1,
      phase: "finished",
      round_number: 1,
      finish_reason: "max_guesses",
      series_status: "active",
      next_round_unix_ms: Date.now() + 4_000,
      mystery_id: "donk",
    };
    renderPage();

    expect(container.textContent).toContain("本轮平局，继续加赛");
    expect(mocks.celebrationProps).toMatchObject({
      seriesComplete: false,
      tiebreak: true,
    });
    expect(findButton("返回模式大厅")).toBeUndefined();
  });
});
