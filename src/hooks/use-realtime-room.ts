import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMachine } from "@xstate/react";
import { io, type Socket } from "socket.io-client";

import {
  clearCredentialsIfMatches,
  isAuthoritativeRoomSnapshot,
  resolveSocketIoEndpoint,
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
export const REALTIME_RECONNECT_TIMEOUT_MS = 30_000;

export type RealtimeOfflineReason =
  | "reconnect_timeout"
  | "session_invalid"
  | "profile_invalid"
  | "configuration"
  | null;

interface RealtimeAck {
  accepted: boolean;
  error?: string;
  snapshot?: Record<string, unknown>;
}

interface OwnedSocket {
  socket: Socket;
  generation: number;
  disposed: boolean;
  syncAttempt: number;
  reconnectDeadlineTimer: ReturnType<typeof setTimeout> | null;
  sync: () => void;
  detach: () => void;
}

function isDuplicateRealtimeEvent(
  current: readonly ServerEvent[],
  next: ServerEvent,
) {
  const requestId =
    typeof next.request_id === "string" ? next.request_id : undefined;
  if (
    requestId &&
    current.some(
      (event) =>
        event.type === next.type && event.request_id === requestId,
    )
  ) {
    return true;
  }

  if (next.type !== "opponent_progress") return false;
  const playerId =
    typeof next.player_id === "string" ? next.player_id : undefined;
  const guessNumber =
    typeof next.guess_number === "number" ? next.guess_number : undefined;
  if (!playerId || guessNumber === undefined) return false;
  const roundStartIndex = current.findLastIndex(
    (event) => event.type === "round_started",
  );
  return current
    .slice(Math.max(0, roundStartIndex))
    .some(
      (event) =>
        event.type === "opponent_progress" &&
        event.player_id === playerId &&
        event.guess_number === guessNumber,
    );
}

export function parseRealtimeAck(value: unknown): RealtimeAck | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Error
  ) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (typeof source.accepted !== "boolean") return null;
  return {
    accepted: source.accepted,
    error: typeof source.error === "string" ? source.error : undefined,
    snapshot:
      source.snapshot &&
      typeof source.snapshot === "object" &&
      !Array.isArray(source.snapshot)
        ? (source.snapshot as Record<string, unknown>)
        : undefined,
  };
}

export function socketIoAckResult(
  args: readonly unknown[],
): { error: unknown; value: unknown } {
  if (args.length >= 2) {
    return { error: args[0], value: args[1] };
  }
  const value = args[0];
  return {
    error: value instanceof Error ? value : null,
    value,
  };
}

export function realtimeEventErrorMessage(event: ServerEvent) {
  if (event.code === "round_forfeited") {
    return "本轮已判负，等待下一轮。";
  }
  return typeof event.message === "string"
    ? event.message
    : "服务器拒绝了本次操作，请稍后重试。";
}

export function fatalRealtimeConnectReason(
  value: unknown,
): Exclude<RealtimeOfflineReason, "reconnect_timeout" | null> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const data =
    source.data && typeof source.data === "object"
      ? (source.data as Record<string, unknown>)
      : {};
  const text = [source.message, source.code, data.message, data.code]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (
    /(profile_not_found|identity.{0,24}(invalid|expired|missing)|invalid.{0,24}identity)/.test(
      text,
    )
  ) {
    return "profile_invalid";
  }
  if (
    /(unauthor|forbidden|invalid.{0,24}(token|session)|session.{0,24}(expired|invalid))/.test(
      text,
    )
  ) {
    return "session_invalid";
  }
  return null;
}

export function isFatalRealtimeConnectError(value: unknown) {
  return fatalRealtimeConnectReason(value) !== null;
}

function useRealtimeRoomConnection(
  credentials: RealtimeCredentials | null,
  initialSnapshot?: Record<string, unknown>,
  disabled = false,
) {
  const [connectionSnapshot, sendConnection] = useMachine(
    realtimeConnectionMachine,
  );
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>(
    initialSnapshot ?? {},
  );
  const [hasAuthoritativeSnapshot, setHasAuthoritativeSnapshot] = useState(
    () => isAuthoritativeRoomSnapshot(initialSnapshot),
  );
  const hasAuthoritativeSnapshotRef = useRef(
    isAuthoritativeRoomSnapshot(initialSnapshot),
  );
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [error, setError] = useState("");
  const [offlineReason, setOfflineReason] =
    useState<RealtimeOfflineReason>(null);
  const ownerRef = useRef<OwnedSocket | null>(null);
  const lastSeqRef = useRef(-1);
  const generationRef = useRef(0);
  const everConnectedRef = useRef(false);
  const debugOverride = useDebugStore((state) => state.realtime);
  const connection = connectionStateValue(connectionSnapshot.value);

  const retire = useCallback((owner: OwnedSocket, disconnect: boolean) => {
    if (owner.disposed) return;
    owner.disposed = true;
    if (owner.reconnectDeadlineTimer !== null) {
      clearTimeout(owner.reconnectDeadlineTimer);
      owner.reconnectDeadlineTimer = null;
    }
    owner.detach();
    if (ownerRef.current === owner) ownerRef.current = null;
    if (disconnect) {
      owner.socket.disconnect();
    }
  }, []);

  const connect = useCallback(() => {
    if (disabled) return;

    if (!credentials) {
      setOfflineReason("session_invalid");
      sendConnection({ type: "FATAL_CLOSE" });
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const previous = ownerRef.current;
    if (previous) retire(previous, true);
    sendConnection({ type: "CONNECT" });

    let socket: Socket;
    try {
      const endpoint = resolveSocketIoEndpoint(credentials.socketIoUrl);
      socket = io(`${endpoint.url}/room`, {
        path: endpoint.path,
        // The room hook owns this lifecycle. A dedicated manager guarantees
        // socket.disconnect() also releases its Engine.IO transport without
        // disturbing the independent public queue connection.
        forceNew: true,
        auth: {
          room_code: credentials.roomCode,
          session_token: credentials.sessionToken,
        },
        // Keep polling available so restrictive/mobile networks can establish
        // a session before Engine.IO upgrades to WebSocket.
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: BASE_RECONNECT_DELAY,
        reconnectionDelayMax: MAX_RECONNECT_DELAY,
        randomizationFactor: 0.25,
        ackTimeout: 2_000,
        retries: 2,
      });
    } catch {
      setOfflineReason("configuration");
      clearCredentialsIfMatches(credentials);
      sendConnection({ type: "FATAL_CLOSE" });
      setError("实时连接地址无效，请返回大厅后重新加入。");
      return;
    }
    const owner: OwnedSocket = {
      socket,
      generation,
      disposed: false,
      syncAttempt: 0,
      reconnectDeadlineTimer: null,
      sync: () => undefined,
      detach: () => undefined,
    };
    const isCurrent = () =>
      !owner.disposed &&
      ownerRef.current === owner &&
      generation === generationRef.current;

    const requestSync = () => {
      if (!isCurrent() || !socket.connected) return;
      const attempt = ++owner.syncAttempt;
      socket.emit(
        "sync",
        (...args: unknown[]) => {
          if (!isCurrent() || attempt !== owner.syncAttempt) return;
          const ack = socketIoAckResult(args);
          if (ack.error) {
            setError("状态同步失败，请重试。");
            return;
          }
          const parsed = parseRealtimeAck(ack.value);
          if (!parsed) {
            setError("服务器返回了无法识别的同步响应，请重试。");
            return;
          }
          if (!parsed.accepted) {
            const reason =
              parsed.error === "profile_not_found"
                ? "profile_invalid"
                : parsed.error === "unauthorized" ||
                    parsed.error === "forbidden"
                  ? "session_invalid"
                  : null;
            setError(
              reason === "profile_invalid"
                ? "当前身份已失效，请重新设置身份。"
                : reason === "session_invalid"
                ? "会话已失效，请退出后重新加入。"
                : "状态同步失败，请重试。",
            );
            if (reason) {
              retire(owner, true);
              setOfflineReason(reason);
              clearCredentialsIfMatches(credentials);
              sendConnection({ type: "FATAL_CLOSE" });
            }
            return;
          }
          const next = parsed.snapshot;
          if (!next || !isAuthoritativeRoomSnapshot(next)) {
            setError("服务器返回的房间状态不完整，请重试。");
            return;
          }
          const seq = next.seq;
          if (
            typeof seq === "number" &&
            hasAuthoritativeSnapshotRef.current &&
            seq <= lastSeqRef.current
          ) {
            return;
          }
          if (typeof seq === "number") lastSeqRef.current = seq;
          setSnapshot(next);
          hasAuthoritativeSnapshotRef.current = true;
          setHasAuthoritativeSnapshot(true);
          setError("");
        },
      );
    };
    owner.sync = requestSync;

    const clearReconnectDeadline = () => {
      if (owner.reconnectDeadlineTimer === null) return;
      clearTimeout(owner.reconnectDeadlineTimer);
      owner.reconnectDeadlineTimer = null;
    };

    const armReconnectDeadline = () => {
      if (!isCurrent() || owner.reconnectDeadlineTimer !== null) return;
      owner.reconnectDeadlineTimer = setTimeout(() => {
        owner.reconnectDeadlineTimer = null;
        if (!isCurrent() || socket.connected) return;
        retire(owner, true);
        setOfflineReason("reconnect_timeout");
        sendConnection({ type: "FATAL_CLOSE" });
        setError(
          "连接超时，无法恢复实时连接。你可以立即重试或安全退出。",
        );
      }, REALTIME_RECONNECT_TIMEOUT_MS);
    };

    const handleConnect = () => {
      if (!isCurrent()) return;
      clearReconnectDeadline();
      everConnectedRef.current = true;
      setOfflineReason(null);
      sendConnection({ type: "OPEN" });
      setError("");
      requestSync();
    };

    const handleMessage = (event: ServerEvent) => {
      if (!isCurrent()) return;
      if (!event || typeof event.type !== "string") return;

      if (event.type === "snapshot") {
        const next =
          event.snapshot &&
          typeof event.snapshot === "object" &&
          !Array.isArray(event.snapshot)
            ? (event.snapshot as Record<string, unknown>)
            : event;
        if (isAuthoritativeRoomSnapshot(next)) {
          const nextSeq =
            typeof next.seq === "number" ? next.seq : event.seq;
          if (
            typeof nextSeq === "number" &&
            hasAuthoritativeSnapshotRef.current &&
            nextSeq <= lastSeqRef.current
          ) {
            return;
          }
          if (typeof nextSeq === "number") lastSeqRef.current = nextSeq;
          setSnapshot(next);
          hasAuthoritativeSnapshotRef.current = true;
          setHasAuthoritativeSnapshot(true);
        } else {
          setError("服务器返回的房间状态不完整，请重试。");
        }
      } else {
        if (typeof event.seq === "number") {
          if (event.seq <= lastSeqRef.current) return;
          lastSeqRef.current = event.seq;
        }
        setEvents((current) =>
          isDuplicateRealtimeEvent(current, event)
            ? current
            : [...current.slice(-99), event],
        );
      }

      if (event.type === "error") {
        setError(realtimeEventErrorMessage(event));
      } else {
        setError("");
      }
    };

    const handleDisconnect = (reason: string) => {
      if (!isCurrent()) return;
      if (reason === "io server disconnect") {
        retire(owner, true);
        setOfflineReason("session_invalid");
        clearCredentialsIfMatches(credentials);
        sendConnection({ type: "FATAL_CLOSE" });
        setError("会话已失效，请退出后重新加入。");
        return;
      }

      sendConnection({ type: "TRANSIENT_CLOSE" });
      setError("实时连接中断，正在自动重连。");
      armReconnectDeadline();
    };

    const handleConnectError = (connectError: unknown) => {
      if (!isCurrent()) return;
      const fatalReason = fatalRealtimeConnectReason(connectError);
      if (fatalReason) {
        retire(owner, true);
        setOfflineReason(fatalReason);
        clearCredentialsIfMatches(credentials);
        sendConnection({ type: "FATAL_CLOSE" });
        setError(
          fatalReason === "profile_invalid"
            ? "当前身份已失效，请重新设置身份。"
            : "会话已失效，请退出后重新加入。",
        );
        return;
      }
      if (everConnectedRef.current) {
        sendConnection({ type: "TRANSIENT_CLOSE" });
        setError("实时连接中断，正在自动重连。");
        armReconnectDeadline();
      } else {
        // The manager is still performing its initial connection attempts.
        // Keep this neutral: no prior connection has been lost or restored.
        setError("");
      }
    };
    owner.detach = () => {
      socket.off("connect", handleConnect);
      socket.off("message", handleMessage);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
    };
    ownerRef.current = owner;
    socket.on("connect", handleConnect);
    socket.on("message", handleMessage);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    return owner;
  }, [
    credentials,
    disabled,
    retire,
    sendConnection,
  ]);

  useEffect(() => {
    if (disabled) return;

    const initialSeq = initialSnapshot?.seq;
    lastSeqRef.current =
      typeof initialSeq === "number" && Number.isFinite(initialSeq)
        ? initialSeq
        : -1;
    everConnectedRef.current = false;
    setSnapshot(initialSnapshot ?? {});
    const initialIsAuthoritative =
      isAuthoritativeRoomSnapshot(initialSnapshot);
    hasAuthoritativeSnapshotRef.current = initialIsAuthoritative;
    setHasAuthoritativeSnapshot(initialIsAuthoritative);
    setEvents([]);
    setError("");
    setOfflineReason(null);
    const owner = connect();

    return () => {
      generationRef.current += 1;
      if (owner) retire(owner, true);
    };
  }, [connect, disabled, initialSnapshot, retire]);

  const send = useCallback(
    (
      type:
        | "start_round"
        | "guess"
        | "set_visibility"
        | "restart_series"
        | "request_rematch"
        | "respond_rematch"
        | "cancel_rematch",
      payload = {},
      onAcknowledged?: (accepted: boolean) => void,
    ) => {
      const socket = ownerRef.current?.socket;
      if (!socket?.connected) {
        setError("实时连接尚未恢复，请稍后重试。");
        onAcknowledged?.(false);
        return false;
      }

      const requestId = crypto.randomUUID();
      socket.emit(
        "command",
        { type, request_id: requestId, ...payload },
        (...args: unknown[]) => {
          const ack = socketIoAckResult(args);
          if (ack.error) {
            setError("指令未确认，请重试。");
            onAcknowledged?.(false);
            return;
          }
          const parsed = parseRealtimeAck(ack.value);
          if (!parsed) {
            setError("服务器返回了无法识别的指令响应，请重试。");
            onAcknowledged?.(false);
          } else if (!parsed.accepted) {
            setError(
              parsed.error === "rate_limited"
                ? "操作太频繁，请稍后再试。"
                : "服务器未接受本次操作，请重试。",
            );
            onAcknowledged?.(false);
          } else {
            onAcknowledged?.(true);
          }
        },
      );
      return requestId;
    },
    [],
  );

  const retry = useCallback(() => {
    if (
      offlineReason === "session_invalid" ||
      offlineReason === "profile_invalid" ||
      offlineReason === "configuration"
    ) {
      return;
    }
    setError("");
    const owner = ownerRef.current;
    if (owner && !owner.disposed) {
      if (owner.socket.connected) {
        sendConnection({ type: "OPEN" });
        owner.sync();
      } else if (owner.socket.active) {
        sendConnection({
          type: everConnectedRef.current ? "TRANSIENT_CLOSE" : "CONNECT",
        });
        owner.socket.connect();
      } else {
        connect();
      }
      return;
    }
    connect();
  }, [connect, offlineReason, sendConnection]);

  const close = useCallback(() => {
    generationRef.current += 1;
    const owner = ownerRef.current;
    if (owner) retire(owner, true);
    sendConnection({ type: "MANUAL_CLOSE" });
  }, [retire, sendConnection]);

  const effectiveSnapshot = debugOverride?.snapshot
    ? { ...snapshot, ...debugOverride.snapshot }
    : snapshot;

  return {
    connection: debugOverride?.connection ?? connection,
    snapshot: effectiveSnapshot,
    hasAuthoritativeSnapshot: isAuthoritativeRoomSnapshot(effectiveSnapshot)
      ? true
      : hasAuthoritativeSnapshot,
    events: debugOverride?.events ?? events,
    error: debugOverride?.error ?? error,
    offlineReason,
    setError,
    send,
    retry,
    close,
  };
}

type RealtimeRoomState = ReturnType<typeof useRealtimeRoomConnection>;

const RealtimeRoomContext = createContext<RealtimeRoomState | undefined>(
  undefined,
);

export function RealtimeRoomProvider({
  children,
  credentials,
  initialSnapshot,
  enabled = true,
}: {
  children: ReactNode;
  credentials: RealtimeCredentials | null;
  initialSnapshot?: Record<string, unknown>;
  enabled?: boolean;
}) {
  const realtime = useRealtimeRoomConnection(
    credentials,
    initialSnapshot,
    !enabled,
  );
  return createElement(
    RealtimeRoomContext.Provider,
    { value: realtime },
    children,
  );
}

export function useRealtimeRoom(
  credentials: RealtimeCredentials | null,
  initialSnapshot?: Record<string, unknown>,
) {
  const scopedRealtime = useContext(RealtimeRoomContext);
  const localRealtime = useRealtimeRoomConnection(
    scopedRealtime ? null : credentials,
    scopedRealtime ? undefined : initialSnapshot,
    Boolean(scopedRealtime),
  );
  return scopedRealtime ?? localRealtime;
}
