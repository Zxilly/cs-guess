/** @vitest-environment jsdom */

import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  fatalRealtimeConnectReason,
  isFatalRealtimeConnectError,
  parseRealtimeAck,
  REALTIME_RECONNECT_TIMEOUT_MS,
  RealtimeRoomProvider,
  realtimeEventErrorMessage,
  socketIoAckResult,
  useRealtimeRoom,
} from "@/hooks/use-realtime-room";
import type { RealtimeCredentials } from "@/lib/realtime";
import { loadCredentials, saveCredentials } from "@/lib/realtime";
import { useDebugStore } from "@/stores/debug-store";

type SocketHandler = (...args: any[]) => void;

const socketIo = vi.hoisted(() => ({ io: vi.fn() }));

vi.mock("socket.io-client", () => ({
  io: socketIo.io,
}));

class MockSocket {
  connected = false;
  active = true;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly handlers = new Map<string, Set<SocketHandler>>();
  readonly syncCallbacks: SocketHandler[] = [];

  on(event: string, handler: SocketHandler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  off(event: string, handler: SocketHandler) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]) {
    if (event === "sync") {
      const callback = args.at(-1);
      if (typeof callback === "function") this.syncCallbacks.push(callback);
    }
    return this;
  }

  trigger(event: string, ...args: any[]) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(...args);
    }
  }

  connect() {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.connected = false;
    this.active = false;
    this.trigger("disconnect", "io client disconnect");
    return this;
  }

  listenerCount() {
    return [...this.handlers.values()].reduce(
      (total, handlers) => total + handlers.size,
      0,
    );
  }
}

describe("parseRealtimeAck", () => {
  it.each([null, undefined, [], "accepted", 1, true])(
    "rejects a non-object acknowledgement without throwing: %s",
    (value) => {
      expect(() => parseRealtimeAck(value)).not.toThrow();
      expect(parseRealtimeAck(value)).toBeNull();
    },
  );

  it.each([
    {},
    { accepted: "true" },
    { accepted: null },
    { error: "rate_limited" },
  ])("rejects a malformed acknowledgement: %o", (value) => {
    expect(() => parseRealtimeAck(value)).not.toThrow();
    expect(parseRealtimeAck(value)).toBeNull();
  });

  it("keeps only a valid accepted flag, error code, and object snapshot", () => {
    expect(
      parseRealtimeAck({
        accepted: true,
        error: 404,
        snapshot: { seq: 12, phase: "playing" },
      }),
    ).toEqual({
      accepted: true,
      error: undefined,
      snapshot: { seq: 12, phase: "playing" },
    });
    expect(
      parseRealtimeAck({
        accepted: false,
        error: "rate_limited",
        snapshot: [],
      }),
    ).toEqual({
      accepted: false,
      error: "rate_limited",
      snapshot: undefined,
    });
  });
});

describe("socketIoAckResult", () => {
  const accepted = { accepted: true, snapshot: { seq: 2 } };

  it("accepts Socket.IO's legacy single acknowledgement argument", () => {
    expect(socketIoAckResult([accepted])).toEqual({
      error: null,
      value: accepted,
    });
  });

  it("accepts the error-first callback used by ackTimeout and retries", () => {
    expect(socketIoAckResult([null, accepted])).toEqual({
      error: null,
      value: accepted,
    });
  });

  it("keeps timeout errors separate from acknowledgement payloads", () => {
    const error = new Error("operation has timed out");
    expect(socketIoAckResult([error])).toEqual({
      error,
      value: error,
    });
    expect(socketIoAckResult([error, undefined])).toEqual({
      error,
      value: undefined,
    });
  });
});

describe("realtimeEventErrorMessage", () => {
  it("never leaks the protocol's English round-forfeit message", () => {
    expect(
      realtimeEventErrorMessage({
        type: "error",
        code: "round_forfeited",
        message: "the reconnect window expired for this round",
      }),
    ).toBe("本轮已判负，等待下一轮。");
  });
});

describe("isFatalRealtimeConnectError", () => {
  it("recognizes authorization failures without treating ordinary transport errors as fatal", () => {
    expect(
      isFatalRealtimeConnectError({
        message: "connect rejected",
        data: { code: "unauthorized" },
      }),
    ).toBe(true);
    expect(
      isFatalRealtimeConnectError(new Error("websocket transport failed")),
    ).toBe(false);
    expect(
      fatalRealtimeConnectReason({
        data: { code: "profile_not_found" },
      }),
    ).toBe("profile_invalid");
  });
});

const credentialsA: RealtimeCredentials = {
  roomCode: "CS-123456",
  playerId: "self",
  sessionToken: "token-a",
  socketIoUrl: "/socket.io",
  mode: "room",
};
const credentialsB: RealtimeCredentials = {
  ...credentialsA,
  sessionToken: "token-b",
};

function authoritativeSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return {
    seq: 1,
    room_code: "CS-123456",
    phase: "waiting",
    self_player_id: "self",
    host_player_id: "self",
    max_players: 2,
    max_guesses: 8,
    best_of: 3,
    difficulty: "hard",
    visibility: "hidden",
    round_number: 0,
    players: [],
    own_guesses: [],
    opponent_progress: [],
    ...overrides,
  };
}

const QUICK_FLOW_INITIAL_SNAPSHOT = authoritativeSnapshot();

let container: HTMLDivElement;
let root: Root;
let sockets: MockSocket[];
let latestRealtime: ReturnType<typeof useRealtimeRoom> | null;
let snapshotIdentities: Array<Record<string, unknown>>;

function RealtimeProbe({
  credentials = credentialsA,
  initialSnapshot = {},
}: {
  credentials?: RealtimeCredentials;
  initialSnapshot?: Record<string, unknown>;
}) {
  const realtime = useRealtimeRoom(credentials, initialSnapshot);
  latestRealtime = realtime;
  useEffect(() => {
    snapshotIdentities.push(realtime.snapshot);
  }, [realtime.snapshot]);
  return (
    <output>
      {realtime.connection}:{realtime.hasAuthoritativeSnapshot ? "ready" : "pending"}:
      {String(realtime.snapshot.phase ?? "none")}:{realtime.offlineReason ?? "none"}:
      {realtime.error}
    </output>
  );
}

function MatchingRealtimeProbe() {
  return <RealtimeProbe initialSnapshot={QUICK_FLOW_INITIAL_SNAPSHOT} />;
}

function LiveGameRealtimeProbe() {
  return <RealtimeProbe initialSnapshot={QUICK_FLOW_INITIAL_SNAPSHOT} />;
}

function renderProbe({
  credentials = credentialsA,
  initialSnapshot = {},
  strict = false,
}: {
  credentials?: RealtimeCredentials;
  initialSnapshot?: Record<string, unknown>;
  strict?: boolean;
} = {}) {
  act(() => {
    root.render(
      strict ? (
        <StrictMode>
          <RealtimeProbe
            credentials={credentials}
            initialSnapshot={initialSnapshot}
          />
        </StrictMode>
      ) : (
        <RealtimeProbe
          credentials={credentials}
          initialSnapshot={initialSnapshot}
        />
      ),
    );
  });
}

function renderQuickFlowPage(page: "matching" | "playing") {
  act(() => {
    root.render(
      <RealtimeRoomProvider
        credentials={credentialsA}
        initialSnapshot={QUICK_FLOW_INITIAL_SNAPSHOT}
      >
        {page === "matching" ? (
          <MatchingRealtimeProbe />
        ) : (
          <LiveGameRealtimeProbe />
        )}
      </RealtimeRoomProvider>,
    );
  });
}

function connectSocket(socket: MockSocket) {
  act(() => {
    socket.connected = true;
    socket.trigger("connect");
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  useDebugStore.getState().reset();
  sockets = [];
  latestRealtime = null;
  snapshotIdentities = [];
  socketIo.io.mockReset();
  socketIo.io.mockImplementation(() => {
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useRealtimeRoom socket ownership and synchronization", () => {
  it("survives StrictMode setup-cleanup-setup with exactly one owned socket", () => {
    renderProbe({ strict: true });

    expect(socketIo.io).toHaveBeenCalledWith(
      expect.stringContaining("/room"),
      expect.objectContaining({ forceNew: true }),
    );
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.disconnectCalls).toBe(1);
    expect(sockets[0]?.listenerCount()).toBe(0);
    expect(sockets[1]?.disconnectCalls).toBe(0);
    expect(sockets[1]?.listenerCount()).toBe(4);
  });

  it("keeps the connected room socket and snapshot across matching-to-game handoff", () => {
    renderQuickFlowPage("matching");
    const socket = sockets[0]!;
    connectSocket(socket);

    act(() => {
      socket.syncCallbacks[0]?.(
        null,
        {
          accepted: true,
          snapshot: authoritativeSnapshot({ seq: 3, phase: "playing" }),
        },
      );
    });
    expect(container.textContent).toContain("connected:ready:playing");

    renderQuickFlowPage("playing");

    expect(sockets).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(0);
    expect(container.textContent).toContain("connected:ready:playing");
  });

  it("ignores a delayed sync acknowledgement from an older credential generation", () => {
    renderProbe();
    const first = sockets[0]!;
    connectSocket(first);
    const delayedAck = first.syncCallbacks[0]!;

    renderProbe({ credentials: credentialsB });
    const second = sockets[1]!;
    connectSocket(second);
    act(() => {
      second.syncCallbacks[0]?.(
        null,
        {
          accepted: true,
          snapshot: authoritativeSnapshot({ seq: 3, phase: "playing" }),
        },
      );
      delayedAck(null, {
        accepted: true,
        snapshot: authoritativeSnapshot({ seq: 8, phase: "finished" }),
      });
    });

    expect(container.textContent).toContain("ready:playing");
    expect(container.textContent).not.toContain("finished");
    expect(first.listenerCount()).toBe(0);
  });

  it("treats unauthorized connection failures as fatal and stops that manager", () => {
    saveCredentials(
      {
        room_code: credentialsA.roomCode,
        player_id: credentialsA.playerId,
        session_token: credentialsA.sessionToken,
        socket_io_url: credentialsA.socketIoUrl,
        snapshot: {},
      },
      "room",
    );
    renderProbe();
    const socket = sockets[0]!;

    act(() => {
      socket.trigger("connect_error", {
        data: { code: "unauthorized" },
      });
    });

    expect(container.textContent).toContain("offline:pending");
    expect(container.textContent).toContain("session_invalid");
    expect(container.textContent).toContain("会话已失效");
    expect(socket.disconnectCalls).toBe(1);
    expect(socket.listenerCount()).toBe(0);
    expect(loadCredentials("room")).toBeNull();

    act(() => latestRealtime?.retry());
    expect(sockets).toHaveLength(1);
  });

  it("fully retires the current owner after an authoritative server disconnect", () => {
    vi.useFakeTimers();
    try {
      saveCredentials(
        {
          room_code: credentialsA.roomCode,
          player_id: credentialsA.playerId,
          session_token: credentialsA.sessionToken,
          socket_io_url: credentialsA.socketIoUrl,
          snapshot: {},
        },
        "room",
      );
      renderProbe();
      const socket = sockets[0]!;
      connectSocket(socket);
      act(() => {
        socket.connected = false;
        socket.trigger("disconnect", "transport close");
        socket.trigger("disconnect", "io server disconnect");
      });

      expect(container.textContent).toContain("offline:pending");
      expect(container.textContent).toContain("session_invalid");
      expect(socket.disconnectCalls).toBe(1);
      expect(socket.listenerCount()).toBe(0);
      expect(loadCredentials("room")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(REALTIME_RECONNECT_TIMEOUT_MS);
        socket.trigger("connect");
        socket.trigger("message", {
          type: "snapshot",
          snapshot: authoritativeSnapshot({ seq: 99, phase: "finished" }),
        });
      });
      expect(container.textContent).not.toContain("finished");
      expect(sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never clears a newer credential generation after an old socket becomes fatal", () => {
    renderProbe();
    const oldSocket = sockets[0]!;
    saveCredentials(
      {
        room_code: credentialsB.roomCode,
        player_id: credentialsB.playerId,
        session_token: credentialsB.sessionToken,
        socket_io_url: credentialsB.socketIoUrl,
        snapshot: {},
      },
      "room",
    );

    act(() => {
      oldSocket.trigger("connect_error", {
        data: { code: "forbidden" },
      });
    });

    expect(loadCredentials("room")?.credentials.sessionToken).toBe(
      credentialsB.sessionToken,
    );
  });

  it("treats an invalid Socket.IO endpoint as fatal, clears only that session, and never retries it", () => {
    const invalidCredentials = {
      ...credentialsA,
      socketIoUrl: "http://[",
    };
    saveCredentials(
      {
        room_code: invalidCredentials.roomCode,
        player_id: invalidCredentials.playerId,
        session_token: invalidCredentials.sessionToken,
        socket_io_url: invalidCredentials.socketIoUrl,
        snapshot: {},
      },
      "room",
    );

    renderProbe({ credentials: invalidCredentials });

    expect(container.textContent).toContain("configuration");
    expect(container.textContent).toContain("实时连接地址无效");
    expect(loadCredentials("room")).toBeNull();
    expect(sockets).toHaveLength(0);

    act(() => latestRealtime?.retry());
    expect(sockets).toHaveLength(0);
  });

  it("does not clear a newer stored session when an old endpoint is invalid", () => {
    saveCredentials(
      {
        room_code: credentialsB.roomCode,
        player_id: credentialsB.playerId,
        session_token: credentialsB.sessionToken,
        socket_io_url: credentialsB.socketIoUrl,
        snapshot: {},
      },
      "room",
    );

    renderProbe({
      credentials: {
        ...credentialsA,
        socketIoUrl: "http://[",
      },
    });

    expect(container.textContent).toContain("configuration");
    expect(loadCredentials("room")?.credentials.sessionToken).toBe(
      credentialsB.sessionToken,
    );
  });

  it("handles null, malformed, and error-first sync acknowledgements without accepting them", () => {
    renderProbe();
    const socket = sockets[0]!;
    connectSocket(socket);

    act(() => socket.syncCallbacks[0]?.(null));
    expect(container.textContent).toContain("无法识别的同步响应");
    expect(container.textContent).toContain("pending:none");

    act(() => latestRealtime?.retry());
    act(() => socket.syncCallbacks[1]?.(null, { accepted: "yes" }));
    expect(container.textContent).toContain("无法识别的同步响应");

    act(() => latestRealtime?.retry());
    act(() =>
      socket.syncCallbacks[2]?.(
        new Error("operation has timed out"),
        undefined,
      ),
    );
    expect(container.textContent).toContain("状态同步失败");
    expect(container.textContent).toContain("pending:none");
  });

  it("accepts a validated error-first acknowledgement and exposes authoritative readiness", () => {
    renderProbe();
    const socket = sockets[0]!;
    connectSocket(socket);

    act(() => {
      socket.syncCallbacks[0]?.(null, {
        accepted: true,
        snapshot: authoritativeSnapshot({ seq: 2, phase: "playing" }),
      });
    });

    expect(container.textContent).toContain("connected:ready:playing");
  });

  it("accepts the first authoritative sync even when a malformed cached value used the same sequence", () => {
    renderProbe({ initialSnapshot: { seq: 4, phase: "waiting" } });
    const socket = sockets[0]!;
    connectSocket(socket);

    act(() => {
      socket.syncCallbacks[0]?.(null, {
        accepted: true,
        snapshot: authoritativeSnapshot({ seq: 4, phase: "playing" }),
      });
    });

    expect(container.textContent).toContain("connected:ready:playing");
  });

  it("does not reapply an authoritative sync with the same sequence or snapshot identity", () => {
    const initial = authoritativeSnapshot({ seq: 4, phase: "playing" });
    renderProbe({ initialSnapshot: initial });
    const socket = sockets[0]!;
    connectSocket(socket);
    const before = latestRealtime?.snapshot;
    const beforeIdentities = snapshotIdentities.length;

    act(() => {
      socket.syncCallbacks[0]?.(null, {
        accepted: true,
        snapshot: authoritativeSnapshot({ seq: 4, phase: "finished" }),
      });
    });

    expect(latestRealtime?.snapshot).toBe(before);
    expect(latestRealtime?.snapshot.phase).toBe("playing");
    expect(snapshotIdentities).toHaveLength(beforeIdentities);

    act(() => {
      socket.trigger("message", {
        type: "snapshot",
        seq: 5,
        snapshot: authoritativeSnapshot({ seq: 5, phase: "finished" }),
      });
    });
    expect(latestRealtime?.snapshot.phase).toBe("finished");
    expect(snapshotIdentities).toHaveLength(beforeIdentities + 1);
  });

  it("deduplicates retried guess events by request and round-local progress identity", () => {
    renderProbe({
      initialSnapshot: authoritativeSnapshot({ seq: 1, phase: "playing" }),
    });
    const socket = sockets[0]!;

    act(() => {
      socket.trigger("message", {
        type: "guess_accepted",
        seq: 2,
        request_id: "request-1",
        player_id: "donk",
        guess_number: 1,
      });
      // Defend against older servers which generated a fresh sequence for
      // the same Socket.IO retry.
      socket.trigger("message", {
        type: "guess_accepted",
        seq: 3,
        request_id: "request-1",
        player_id: "donk",
        guess_number: 1,
      });
      socket.trigger("message", {
        type: "opponent_progress",
        seq: 4,
        player_id: "opponent",
        guess_number: 1,
      });
      socket.trigger("message", {
        type: "opponent_progress",
        seq: 5,
        player_id: "opponent",
        guess_number: 1,
      });
    });

    expect(latestRealtime?.events.map((event) => event.type)).toEqual([
      "guess_accepted",
      "opponent_progress",
    ]);

    act(() => {
      socket.trigger("message", {
        type: "round_started",
        seq: 6,
        round_number: 2,
        deadline_unix_ms: Date.now() + 60_000,
      });
      socket.trigger("message", {
        type: "opponent_progress",
        seq: 7,
        player_id: "opponent",
        guess_number: 1,
      });
    });
    expect(
      latestRealtime?.events.filter(
        (event) => event.type === "opponent_progress",
      ),
    ).toHaveLength(2);
  });

  it("keeps a validated cached room visible and does not let malformed events poison sequencing", () => {
    renderProbe({
      initialSnapshot: authoritativeSnapshot({ seq: 4 }),
    });
    const socket = sockets[0]!;
    connectSocket(socket);

    act(() => {
      socket.syncCallbacks[0]?.(null, {
        accepted: true,
        snapshot: { seq: 99, phase: "playing" },
      });
    });
    expect(container.textContent).toContain("ready:waiting");

    act(() => {
      socket.trigger("message", {
        type: "snapshot",
        seq: 100,
        snapshot: { seq: 100, phase: "finished" },
      });
      socket.trigger("message", {
        type: "snapshot",
        seq: 5,
        snapshot: authoritativeSnapshot({ seq: 5, phase: "playing" }),
      });
    });
    expect(container.textContent).toContain("ready:playing");
  });

  it("retries through the active manager without creating a second socket", () => {
    renderProbe();
    const socket = sockets[0]!;

    act(() => socket.trigger("connect_error", new Error("offline")));
    act(() => latestRealtime?.retry());

    expect(sockets).toHaveLength(1);
    expect(socket.connectCalls).toBe(1);
    expect(socket.disconnectCalls).toBe(0);
  });

  it("recovers a short transport interruption before the shared reconnect deadline", () => {
    vi.useFakeTimers();
    try {
      renderProbe({
        initialSnapshot: authoritativeSnapshot({ phase: "playing" }),
      });
      const socket = sockets[0]!;
      connectSocket(socket);

      act(() => {
        socket.connected = false;
        socket.trigger("disconnect", "transport close");
      });
      expect(container.textContent).toContain("reconnecting:ready");

      act(() => {
        vi.advanceTimersByTime(REALTIME_RECONNECT_TIMEOUT_MS - 1);
        socket.connected = true;
        socket.trigger("connect");
      });
      expect(container.textContent).toContain("connected:ready");

      act(() => vi.advanceTimersByTime(REALTIME_RECONNECT_TIMEOUT_MS));
      expect(container.textContent).toContain("connected:ready");
      expect(container.textContent).not.toContain("连接超时");
      expect(socket.disconnectCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an endless reconnect after 30 seconds and retries with a new generation", () => {
    vi.useFakeTimers();
    try {
      renderProbe({
        initialSnapshot: authoritativeSnapshot({ phase: "playing" }),
      });
      const first = sockets[0]!;
      connectSocket(first);

      act(() => {
        first.connected = false;
        first.trigger("disconnect", "transport close");
        first.trigger("connect_error", new Error("offline"));
        vi.advanceTimersByTime(REALTIME_RECONNECT_TIMEOUT_MS - 1);
      });
      expect(container.textContent).toContain("reconnecting:ready");

      act(() => vi.advanceTimersByTime(1));
      expect(container.textContent).toContain("offline:ready");
      expect(container.textContent).toContain("reconnect_timeout");
      expect(container.textContent).toContain("连接超时");
      expect(first.disconnectCalls).toBe(1);
      expect(first.listenerCount()).toBe(0);

      act(() => latestRealtime?.retry());
      expect(sockets).toHaveLength(2);
      expect(container.textContent).toContain("connecting:ready");
      expect(container.textContent).not.toContain("连接超时");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans the reconnect deadline when the hook unmounts", () => {
    vi.useFakeTimers();
    try {
      renderProbe();
      const socket = sockets[0]!;
      connectSocket(socket);
      act(() => {
        socket.connected = false;
        socket.trigger("disconnect", "transport close");
        root.unmount();
        vi.advanceTimersByTime(REALTIME_RECONNECT_TIMEOUT_MS);
      });

      expect(socket.disconnectCalls).toBe(1);
      expect(socket.listenerCount()).toBe(0);
      expect(sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes every listener and closes the owned socket on unmount", () => {
    renderProbe();
    const socket = sockets[0]!;

    act(() => root.unmount());

    expect(socket.disconnectCalls).toBe(1);
    expect(socket.listenerCount()).toBe(0);
    socket.trigger("connect");
    socket.trigger("message", {
      type: "snapshot",
      snapshot: authoritativeSnapshot(),
    });
    socket.trigger("connect_error", new Error("offline"));
    expect(sockets).toHaveLength(1);
  });
});
