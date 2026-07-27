import { useCallback, useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";

import {
  resolveWebSocketUrl,
  type RealtimeCredentials,
  type ServerEvent,
} from "@/lib/realtime";
import {
  connectionStateValue,
  realtimeConnectionMachine,
} from "@/machines/realtime-connection-machine";
import { useDebugStore } from "@/stores/debug-store";

const MAX_RECONNECT_DELAY = 15_000;
const BASE_RECONNECT_DELAY = 500;

function reconnectDelay(attempt: number) {
  const exponential = Math.min(
    MAX_RECONNECT_DELAY,
    BASE_RECONNECT_DELAY * 2 ** attempt,
  );
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

export function useRealtimeRoom(
  credentials: RealtimeCredentials | null,
  initialSnapshot?: Record<string, unknown>,
) {
  const [connectionSnapshot, sendConnection] = useMachine(
    realtimeConnectionMachine,
  );
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>(
    initialSnapshot ?? {},
  );
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const reconnectAttemptRef = useRef(0);
  const lastSeqRef = useRef(-1);
  const manuallyClosedRef = useRef(false);
  const generationRef = useRef(0);
  const debugOverride = useDebugStore((state) => state.realtime);
  const connection = connectionStateValue(connectionSnapshot.value);

  const connect = useCallback(() => {
    if (!credentials) {
      sendConnection({ type: "FATAL_CLOSE" });
      return;
    }

    window.clearTimeout(reconnectTimerRef.current);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    socketRef.current?.close(1000, "connection-replaced");
    sendConnection({
      type:
        reconnectAttemptRef.current > 0 ? "TRANSIENT_CLOSE" : "CONNECT",
    });

    let socket: WebSocket;
    try {
      socket = new WebSocket(
        resolveWebSocketUrl(
          credentials.websocketUrl,
          credentials.roomCode,
          credentials.sessionToken,
        ),
      );
    } catch {
      sendConnection({ type: "FATAL_CLOSE" });
      setError("实时连接地址无效，请返回大厅后重新加入。");
      return;
    }
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (generation !== generationRef.current) return;
      reconnectAttemptRef.current = 0;
      sendConnection({ type: "OPEN" });
      setError("");
    });

    socket.addEventListener("message", (message) => {
      if (generation !== generationRef.current) return;
      let event: ServerEvent;
      try {
        event = JSON.parse(String(message.data)) as ServerEvent;
      } catch {
        return;
      }

      if (!event || typeof event.type !== "string") return;
      if (typeof event.seq === "number") {
        if (event.seq <= lastSeqRef.current) return;
        lastSeqRef.current = event.seq;
      }

      if (event.type === "snapshot") {
        const next =
          event.snapshot &&
          typeof event.snapshot === "object" &&
          !Array.isArray(event.snapshot)
            ? (event.snapshot as Record<string, unknown>)
            : event;
        setSnapshot(next);
      } else {
        setEvents((current) => [...current.slice(-99), event]);
      }

      if (event.type === "error") {
        const message =
          typeof event.message === "string"
            ? event.message
            : "服务器拒绝了本次操作，请稍后重试。";
        setError(message);
      } else {
        setError("");
      }
    });

    socket.addEventListener("close", (closeEvent) => {
      if (generation !== generationRef.current) return;
      if (manuallyClosedRef.current) {
        sendConnection({ type: "MANUAL_CLOSE" });
        return;
      }
      if (
        closeEvent.code === 1003 ||
        closeEvent.code === 1008 ||
        closeEvent.code === 4001 ||
        closeEvent.code === 4003
      ) {
        sendConnection({ type: "FATAL_CLOSE" });
        setError("会话已失效，请返回大厅后重新加入。");
        return;
      }

      sendConnection({ type: "TRANSIENT_CLOSE" });
      const attempt = reconnectAttemptRef.current++;
      reconnectTimerRef.current = window.setTimeout(
        connect,
        reconnectDelay(attempt),
      );
    });

    socket.addEventListener("error", () => {
      if (generation !== generationRef.current) return;
      setError("实时连接中断，正在自动重连。");
    });
  }, [credentials, sendConnection]);

  useEffect(() => {
    manuallyClosedRef.current = false;
    lastSeqRef.current = -1;
    reconnectAttemptRef.current = 0;
    setSnapshot(initialSnapshot ?? {});
    setEvents([]);
    connect();

    return () => {
      manuallyClosedRef.current = true;
      generationRef.current += 1;
      window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "page-unmounted");
    };
  }, [connect, initialSnapshot]);

  const send = useCallback(
    (type: "start_round" | "guess" | "set_visibility", payload = {}) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setError("实时连接尚未恢复，请稍后重试。");
        return false;
      }

      socket.send(
        JSON.stringify({
          type,
          request_id: crypto.randomUUID(),
          ...payload,
        }),
      );
      return true;
    },
    [],
  );

  const retry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    sendConnection({ type: "CONNECT" });
    connect();
  }, [connect, sendConnection]);

  return {
    connection: debugOverride?.connection ?? connection,
    snapshot: debugOverride?.snapshot
      ? { ...snapshot, ...debugOverride.snapshot }
      : snapshot,
    events: debugOverride?.events ?? events,
    error: debugOverride?.error ?? error,
    setError,
    send,
    retry,
  };
}
