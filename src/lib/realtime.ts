import type { BestOf, OpponentVisibility } from "@/types/game";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "cs-guess:realtime-session";
const API_ERROR_MESSAGES: Record<string, string> = {
  bad_request: "提交的信息无效，请检查房间号和对局设置。",
  room_not_found: "房间不存在，请检查房间号。",
  room_full: "房间已满或对局已经开始。",
  capacity_reached: "当前房间数量已达上限，请稍后重试。",
  rate_limited: "操作太频繁，请稍后再试。",
  unauthorized: "会话已失效，请重新加入房间。",
  unavailable: "对战服务暂时不可用，请稍后重试。",
  internal_error: "对战服务发生错误，请稍后重试。",
};

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "closed";

export interface RealtimeCredentials {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  websocketUrl: string;
  mode: "quick" | "room";
}

interface StoredRealtimeSession {
  credentials: RealtimeCredentials;
  snapshot: Record<string, unknown>;
}

export interface SessionResponse {
  room_code: string;
  player_id: string;
  session_token: string;
  websocket_url: string;
  snapshot: Record<string, unknown>;
}

export interface MatchmakingQueueCounts {
  bo1: number;
  bo3: number;
  bo5: number;
  bo1_hidden: number;
  bo1_open: number;
  bo3_hidden: number;
  bo3_open: number;
  bo5_hidden: number;
  bo5_open: number;
  total: number;
  group_bo1: number;
  group_bo3: number;
  group_bo5: number;
  group_bo1_hidden: number;
  group_bo1_open: number;
  group_bo3_hidden: number;
  group_bo3_open: number;
  group_bo5_hidden: number;
  group_bo5_open: number;
  group_total: number;
}

export function queueCountFor(
  counts: MatchmakingQueueCounts,
  partySize: 2 | 4,
  bestOf: BestOf,
  visibility: OpponentVisibility,
) {
  const prefix = partySize === 4 ? "group_" : "";
  const key =
    `${prefix}bo${bestOf}_${visibility}` as keyof MatchmakingQueueCounts;
  return counts[key];
}

export interface ServerEvent extends Record<string, unknown> {
  type:
    | "snapshot"
    | "player_joined"
    | "player_connection"
    | "round_started"
    | "guess_accepted"
    | "opponent_progress"
    | "visibility_changed"
    | "round_finished"
    | "ack"
    | "error";
  seq?: number;
}

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<SessionResponse>;
  return (
    typeof response.room_code === "string" &&
    typeof response.player_id === "string" &&
    typeof response.session_token === "string" &&
    typeof response.websocket_url === "string" &&
    Boolean(response.snapshot) &&
    typeof response.snapshot === "object"
  );
}

async function postSession(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SessionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError("无法连接对战服务器，请确认后端已启动后重试。");
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const errorCode =
      typeof payload?.code === "string" ? payload.code : undefined;
    const message =
      (errorCode ? API_ERROR_MESSAGES[errorCode] : undefined) ??
      (typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : response.status === 404
            ? "房间不存在，请检查房间号。"
            : response.status === 409
              ? "房间已满或当前状态无法加入。"
              : "对战服务器暂时无法完成请求，请稍后重试。");
    throw new ApiError(message, response.status);
  }

  if (!isSessionResponse(payload)) {
    throw new ApiError("服务器返回了无法识别的会话数据，请刷新后重试。");
  }
  return payload;
}

export function createRoom(
  identityId: string,
  visibility: OpponentVisibility,
  maxPlayers: number,
  bestOf: BestOf,
) {
  return postSession("/v1/rooms", {
    identity_id: identityId,
    visibility,
    max_players: maxPlayers,
    best_of: bestOf,
  });
}

export function joinRoom(code: string, identityId: string) {
  return postSession(`/v1/rooms/${encodeURIComponent(code)}/join`, {
    identity_id: identityId,
  });
}

export function createQuickMatch(
  identityId: string,
  visibility: OpponentVisibility,
  bestOf: BestOf,
  partySize: 2 | 4,
  signal?: AbortSignal,
) {
  return postSession("/v1/matches/quick", {
    identity_id: identityId,
    visibility,
    best_of: bestOf,
    party_size: partySize,
  }, signal);
}

export async function cancelQuickMatch(credentials: RealtimeCredentials) {
  const url = new URL(
    `${API_BASE}/v1/matches/quick/${encodeURIComponent(credentials.roomCode)}`,
    window.location.origin,
  );
  url.searchParams.set("session_token", credentials.sessionToken);
  let response: Response;
  try {
    response = await fetch(url, { method: "DELETE" });
  } catch {
    throw new ApiError("取消匹配失败，请检查网络后重试。");
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? "匹配会话已经失效。"
        : "取消匹配失败，请稍后重试。",
      response.status,
    );
  }
}

export function saveCredentials(
  response: SessionResponse,
  mode: RealtimeCredentials["mode"],
) {
  const credentials: RealtimeCredentials = {
    roomCode: response.room_code,
    playerId: response.player_id,
    sessionToken: response.session_token,
    websocketUrl: response.websocket_url,
    mode,
  };
  const session = { credentials, snapshot: response.snapshot };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function loadCredentials(mode: RealtimeCredentials["mode"]) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<StoredRealtimeSession>;
    const value = session.credentials;
    if (
      !value ||
      value.mode !== mode ||
      typeof value.roomCode !== "string" ||
      !/^CS-\d{6}$/.test(value.roomCode) ||
      typeof value.playerId !== "string" ||
      typeof value.sessionToken !== "string" ||
      typeof value.websocketUrl !== "string"
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return {
      credentials: value as RealtimeCredentials,
      snapshot:
        session.snapshot &&
        typeof session.snapshot === "object" &&
        !Array.isArray(session.snapshot)
          ? session.snapshot
          : {},
    } satisfies StoredRealtimeSession;
  } catch {
    return null;
  }
}

export function clearCredentials() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function resolveWebSocketUrl(
  websocketUrl: string,
  roomCode: string,
  sessionToken: string,
) {
  const fallbackBase = API_BASE || window.location.origin;
  const url = new URL(
    websocketUrl || `/v1/rooms/${roomCode}/ws`,
    fallbackBase,
  );
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  url.searchParams.set("session_token", sessionToken);
  return url.toString();
}

export function resolveQueueWebSocketUrl() {
  const fallbackBase = API_BASE || window.location.origin;
  const url = new URL("/v1/matches/queue/ws", fallbackBase);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  return url.toString();
}

export function readString(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function readNumber(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function readRecord(
  source: Record<string, unknown> | undefined,
  key: string,
) {
  const value = source?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readRecords(
  source: Record<string, unknown> | undefined,
  key: string,
) {
  const value = source?.[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}
