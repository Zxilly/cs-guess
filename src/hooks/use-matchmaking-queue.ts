import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import * as msgpackParser from "socket.io-msgpack-parser";

import {
  resolveQueueSocketIoEndpoint,
  type MatchmakingDifficultyCounts,
  type MatchmakingQueueCounts,
} from "@/lib/realtime";
import { useDebugStore } from "@/stores/debug-store";

const EMPTY_DIFFICULTY_COUNTS: MatchmakingDifficultyCounts = {
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
  playing_bo1_hidden: 0,
  playing_bo1_open: 0,
  playing_bo3_hidden: 0,
  playing_bo3_open: 0,
  playing_bo5_hidden: 0,
  playing_bo5_open: 0,
  playing_group_bo1_hidden: 0,
  playing_group_bo1_open: 0,
  playing_group_bo3_hidden: 0,
  playing_group_bo3_open: 0,
  playing_group_bo5_hidden: 0,
  playing_group_bo5_open: 0,
};

const EMPTY_COUNTS: MatchmakingQueueCounts = {
  easy: { ...EMPTY_DIFFICULTY_COUNTS },
  full: { ...EMPTY_DIFFICULTY_COUNTS },
  hard: { ...EMPTY_DIFFICULTY_COUNTS },
};

const DIFFICULTY_COUNT_KEYS = Object.keys(
  EMPTY_DIFFICULTY_COUNTS,
) as (keyof MatchmakingDifficultyCounts)[];

interface MatchmakingQueueState {
  counts: MatchmakingQueueCounts;
  live: boolean;
}

const MatchmakingQueueContext =
  createContext<MatchmakingQueueState | null>(null);

function isDifficultyCounts(value: unknown): value is MatchmakingDifficultyCounts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Partial<MatchmakingDifficultyCounts>;
  return DIFFICULTY_COUNT_KEYS.every(
    (key) =>
      typeof counts[key] === "number" &&
      Number.isFinite(counts[key]) &&
      counts[key] >= 0,
  );
}

function isQueueCounts(value: unknown): value is MatchmakingQueueCounts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Partial<MatchmakingQueueCounts>;
  return (
    isDifficultyCounts(counts.easy) &&
    isDifficultyCounts(counts.full) &&
    isDifficultyCounts(counts.hard)
  );
}

function useMatchmakingQueueConnection(
  enabled: boolean,
): MatchmakingQueueState {
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [live, setLive] = useState(false);
  const debugCounts = useDebugStore((state) => state.queueCounts);
  const debugLive = useDebugStore((state) => state.queueLive);

  useEffect(() => {
    if (!enabled) return;

    let closed = false;
    let generation = 0;

    interface OwnedSocket {
      socket: Socket;
      generation: number;
      disposed: boolean;
      detach: () => void;
    }

    let ownedSocket: OwnedSocket | undefined;
    const createdSockets = new Set<OwnedSocket>();

    function isCurrent(owner: OwnedSocket) {
      return (
        !closed &&
        !owner.disposed &&
        ownedSocket === owner &&
        generation === owner.generation
      );
    }

    function retire(owner: OwnedSocket, disconnect: boolean) {
      if (owner.disposed) return;
      owner.disposed = true;
      owner.detach();
      if (ownedSocket === owner) {
        ownedSocket = undefined;
      }
      if (disconnect) {
        owner.socket.disconnect();
      }
    }

    function connect() {
      if (closed || document.hidden) {
        return;
      }

      if (ownedSocket) {
        // `active` stays true while Socket.IO is initially connecting or is
        // waiting for a managed reconnect. Reuse that manager instead of
        // creating an orphan that can reconnect behind the current socket.
        if (ownedSocket.socket.connected || ownedSocket.socket.active) {
          return;
        }
        retire(ownedSocket, true);
      }

      const endpoint = resolveQueueSocketIoEndpoint();
      const nextSocket = io(`${endpoint.url}/queue`, {
        path: endpoint.path,
        parser: msgpackParser,
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 10_000,
        randomizationFactor: 0.25,
      });

      const owner: OwnedSocket = {
        socket: nextSocket,
        generation: ++generation,
        disposed: false,
        detach: () => undefined,
      };
      const handleConnect = () => {
        if (!isCurrent(owner)) return;
        setLive(true);
      };
      const handleCounts = (counts: unknown) => {
        if (!isCurrent(owner)) return;
        try {
          if (isQueueCounts(counts)) {
            setCounts(counts);
          }
        } catch {
          // Ignore malformed public telemetry and wait for the next broadcast.
        }
      };
      const handleDisconnect = () => {
        if (!isCurrent(owner)) return;
        setLive(false);
        if (!nextSocket.active) {
          retire(owner, false);
        }
      };
      const handleConnectError = () => {
        if (!isCurrent(owner)) return;
        setLive(false);
      };
      owner.detach = () => {
        nextSocket.off("connect", handleConnect);
        nextSocket.off("queue_counts", handleCounts);
        nextSocket.off("disconnect", handleDisconnect);
        nextSocket.off("connect_error", handleConnectError);
      };
      ownedSocket = owner;
      createdSockets.add(owner);

      nextSocket.on("connect", handleConnect);
      nextSocket.on("queue_counts", handleCounts);
      nextSocket.on("disconnect", handleDisconnect);
      nextSocket.on("connect_error", handleConnectError);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        if (ownedSocket) {
          retire(ownedSocket, true);
        }
        setLive(false);
      } else {
        connect();
      }
    }

    function handleOnline() {
      connect();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    connect();
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      for (const owner of createdSockets) {
        retire(owner, true);
      }
      createdSockets.clear();
    };
  }, [enabled]);

  return {
    counts: debugCounts ?? counts,
    live: debugLive ?? live,
  };
}

export function MatchmakingQueueProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const queue = useMatchmakingQueueConnection(enabled);
  return createElement(
    MatchmakingQueueContext.Provider,
    { value: queue },
    children,
  );
}

export function useMatchmakingQueue() {
  const queue = useContext(MatchmakingQueueContext);
  if (!queue) {
    throw new Error(
      "useMatchmakingQueue must be used within MatchmakingQueueProvider",
    );
  }
  return queue;
}
