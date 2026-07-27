import { useEffect, useRef, useState } from "react";

import {
  resolveQueueWebSocketUrl,
  type MatchmakingQueueCounts,
} from "@/lib/realtime";
import { useDebugStore } from "@/stores/debug-store";

const EMPTY_COUNTS: MatchmakingQueueCounts = {
  bo1: 0,
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
};

function isQueueCounts(value: unknown): value is MatchmakingQueueCounts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Partial<MatchmakingQueueCounts>;
  return [
    counts.bo1,
    counts.bo3,
    counts.bo5,
    counts.bo1_hidden,
    counts.bo1_open,
    counts.bo3_hidden,
    counts.bo3_open,
    counts.bo5_hidden,
    counts.bo5_open,
    counts.total,
    counts.group_bo1,
    counts.group_bo3,
    counts.group_bo5,
    counts.group_bo1_hidden,
    counts.group_bo1_open,
    counts.group_bo3_hidden,
    counts.group_bo3_open,
    counts.group_bo5_hidden,
    counts.group_bo5_open,
    counts.group_total,
    counts.playing_bo1,
    counts.playing_bo3,
    counts.playing_bo5,
    counts.playing_group_bo1,
    counts.playing_group_bo3,
    counts.playing_group_bo5,
    counts.playing_total,
  ].every(
    (count) => typeof count === "number" && Number.isFinite(count) && count >= 0,
  );
}

export function useMatchmakingQueue() {
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [live, setLive] = useState(false);
  const retryRef = useRef<number | undefined>(undefined);
  const debugCounts = useDebugStore((state) => state.queueCounts);
  const debugLive = useDebugStore((state) => state.queueLive);

  useEffect(() => {
    let closed = false;
    let attempts = 0;
    let socket: WebSocket | undefined;

    function connect() {
      if (
        closed ||
        document.hidden ||
        socket?.readyState === WebSocket.CONNECTING ||
        socket?.readyState === WebSocket.OPEN
      ) {
        return;
      }
      const nextSocket = new WebSocket(resolveQueueWebSocketUrl());
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket) return;
        attempts = 0;
        setLive(true);
      });
      nextSocket.addEventListener("message", (message) => {
        if (socket !== nextSocket) return;
        try {
          const payload = JSON.parse(String(message.data)) as {
            type?: string;
            counts?: unknown;
          };
          if (payload.type === "queue_counts" && isQueueCounts(payload.counts)) {
            setCounts(payload.counts);
          }
        } catch {
          // Ignore malformed public telemetry and wait for the next broadcast.
        }
      });
      nextSocket.addEventListener("close", () => {
        if (socket !== nextSocket) return;
        socket = undefined;
        setLive(false);
        if (closed || document.hidden || !navigator.onLine) return;
        const baseDelay = Math.min(10_000, 500 * 2 ** attempts);
        const delay = baseDelay * (0.75 + Math.random() * 0.5);
        attempts += 1;
        retryRef.current = window.setTimeout(connect, delay);
      });
      nextSocket.addEventListener("error", () => nextSocket.close());
    }

    function handleVisibilityChange() {
      window.clearTimeout(retryRef.current);
      if (document.hidden) {
        socket?.close(1000, "page-hidden");
        setLive(false);
      } else {
        connect();
      }
    }

    function handleOnline() {
      attempts = 0;
      connect();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      socket?.close(1000, "page-unmounted");
    };
  }, []);

  return {
    counts: debugCounts ?? counts,
    live: debugLive ?? live,
  };
}
