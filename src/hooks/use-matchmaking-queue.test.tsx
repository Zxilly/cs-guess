/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MatchmakingQueueProvider,
  useMatchmakingQueue,
} from "@/hooks/use-matchmaking-queue";
import { useDebugStore } from "@/stores/debug-store";

type SocketEvent =
  | "connect"
  | "queue_counts"
  | "disconnect"
  | "connect_error";
type SocketHandler = (...args: unknown[]) => void;

const socketIo = vi.hoisted(() => ({
  io: vi.fn(),
  msgpackParser: { protocol: 5 },
}));

vi.mock("socket.io-client", () => ({
  io: socketIo.io,
}));
vi.mock("socket.io-msgpack-parser", () => socketIo.msgpackParser);

class MockSocket {
  connected = false;
  active = true;
  disconnectCalls = 0;
  readonly handlers = new Map<SocketEvent, Set<SocketHandler>>();

  on(event: SocketEvent, handler: SocketHandler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  off(event: SocketEvent, handler: SocketHandler) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: SocketEvent, ...args: unknown[]) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(...args);
    }
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.connected = false;
    this.active = false;
    this.emit("disconnect", "io client disconnect");
    return this;
  }

  listenerCount() {
    return [...this.handlers.values()].reduce(
      (total, handlers) => total + handlers.size,
      0,
    );
  }
}

let container: HTMLDivElement;
let root: Root;
let sockets: MockSocket[];

function QueueProbe() {
  const queue = useMatchmakingQueue();
  return (
    <output data-testid="live">
      {queue.live ? "live" : "offline"}:{queue.counts.bo1}
    </output>
  );
}

function QuickQueueProbe() {
  return <QueueProbe />;
}

function MatchingQueueProbe() {
  return <QueueProbe />;
}

function renderQueue(strict = false) {
  act(() => {
    const queue = (
      <MatchmakingQueueProvider>
        <QueueProbe />
      </MatchmakingQueueProvider>
    );
    root.render(
      strict ? (
        <StrictMode>{queue}</StrictMode>
      ) : (
        queue
      ),
    );
  });
}

function renderQueuePage(page: "quick" | "matching") {
  act(() => {
    root.render(
      <MatchmakingQueueProvider>
        {page === "quick" ? <QuickQueueProbe /> : <MatchingQueueProbe />}
      </MatchmakingQueueProvider>,
    );
  });
}

function dispatchWindowEvent(name: "online") {
  act(() => {
    window.dispatchEvent(new Event(name));
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useDebugStore.getState().reset();
  sockets = [];
  socketIo.io.mockReset();
  socketIo.io.mockImplementation(() => {
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
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

describe("useMatchmakingQueue socket ownership", () => {
  it("uses the MsgPack parser for public queue telemetry", () => {
    renderQueue();

    expect(socketIo.io).toHaveBeenCalledWith(
      expect.stringContaining("/queue"),
      expect.objectContaining({ parser: socketIo.msgpackParser }),
    );
  });

  it("reuses the initial connecting socket when the browser reports online", () => {
    renderQueue();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.active).toBe(true);

    dispatchWindowEvent("online");

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.disconnectCalls).toBe(0);
  });

  it("reuses a reconnecting socket on a visible visibility event", () => {
    renderQueue();
    const socket = sockets[0]!;
    socket.connected = false;
    socket.active = true;

    setHidden(false);

    expect(sockets).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(0);
  });

  it("rebuilds after the owned socket was explicitly disconnected", () => {
    renderQueue();
    const first = sockets[0]!;

    act(() => {
      first.disconnect();
    });
    dispatchWindowEvent("online");

    expect(sockets).toHaveLength(2);
    expect(first.listenerCount()).toBe(0);
    expect(sockets[1]?.listenerCount()).toBe(4);
  });

  it("keeps StrictMode setup-cleanup-setup free of concurrent sockets", () => {
    renderQueue(true);

    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.disconnectCalls).toBe(1);
    expect(sockets[0]?.listenerCount()).toBe(0);
    expect(sockets[1]?.disconnectCalls).toBe(0);
    expect(sockets[1]?.listenerCount()).toBe(4);
  });

  it("removes every callback and closes the owned socket on unmount", () => {
    renderQueue();
    const socket = sockets[0]!;

    act(() => root.unmount());

    expect(socket.disconnectCalls).toBe(1);
    expect(socket.listenerCount()).toBe(0);

    socket.emit("connect");
    socket.emit("queue_counts", {});
    socket.emit("connect_error");
    socket.emit("disconnect");

    expect(sockets).toHaveLength(1);
  });

  it("allows only the latest generation to update live state", () => {
    renderQueue();
    const first = sockets[0]!;

    setHidden(true);
    setHidden(false);
    const latest = sockets[1]!;

    act(() => {
      first.emit("connect");
      first.emit("queue_counts", queueCounts(7));
    });
    expect(container.textContent).toBe("offline:0");

    act(() => {
      latest.connected = true;
      latest.emit("connect");
      latest.emit("queue_counts", queueCounts(9));
    });
    expect(container.textContent).toBe("live:9");
    expect(first.listenerCount()).toBe(0);
  });

  it("keeps the connected public queue snapshot across the quick-to-matching handoff", () => {
    renderQueuePage("quick");
    const socket = sockets[0]!;

    act(() => {
      socket.connected = true;
      socket.emit("connect");
      socket.emit("queue_counts", queueCounts(9));
    });
    expect(container.textContent).toBe("live:9");

    renderQueuePage("matching");

    expect(sockets).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(0);
    expect(container.textContent).toBe("live:9");
  });
});

function queueCounts(bo1: number) {
  const difficulty = { playing_bo1_hidden: 0, playing_bo1_open: 0 };
  return {
    bo1,
    bo3: 0,
    bo5: 0,
    bo1_hidden: 0,
    bo1_open: 0,
    bo3_hidden: 0,
    bo3_open: 0,
    bo5_hidden: 0,
    bo5_open: 0,
    total: 0,
    group_bo1: 0,
    group_bo3: 0,
    group_bo5: 0,
    group_bo1_hidden: 0,
    group_bo1_open: 0,
    group_bo3_hidden: 0,
    group_bo3_open: 0,
    group_bo5_hidden: 0,
    group_bo5_open: 0,
    group_total: 0,
    playing_bo1: 0,
    playing_bo3: 0,
    playing_bo5: 0,
    playing_group_bo1: 0,
    playing_group_bo3: 0,
    playing_group_bo5: 0,
    playing_total: 0,
    easy: difficulty,
    full: difficulty,
    hard: difficulty,
  };
}
