import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
} from "@/types/game";
import { t } from "@lingui/core/macro";
import { clearLiveGuessDraftsForRoom } from "@/lib/live-guess-draft";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "cs-guess:realtime-session";
const CLOSING_INTENT_KEY = "cs-guess:realtime-closing-intent";
export const CLOSING_INTENT_TTL_MS = 15 * 60 * 1_000;
const API_ERROR_MESSAGES: Record<string, string> = {
  bad_request: t`提交的信息无效，请检查房间号和对局设置。`,
  room_not_found: t`房间不存在，请检查房间号。`,
  room_full: t`房间已满或对局已经开始。`,
  profile_not_found: t`当前身份已失效，请重新选择身份。`,
  idempotency_conflict: t`请求状态发生冲突，请重新提交。`,
  capacity_reached: t`当前房间数量已达上限，请稍后重试。`,
  rate_limited: t`操作太频繁，请稍后再试。`,
  unauthorized: t`会话已失效，请重新加入房间。`,
  unavailable: t`对战服务暂时不可用，请稍后重试。`,
  internal_error: t`对战服务发生错误，请稍后重试。`,
  network_error: t`无法连接对战服务器，请检查网络后重试。`,
  invalid_response: t`服务器返回了无法识别的会话数据，请刷新后重试。`,
};

type RoomSessionAction = "join" | "create";

const ROOM_SESSION_ERROR_MESSAGES: Record<
  string,
  Record<RoomSessionAction, string>
> = {
  bad_request: {
    join: t`房间号或身份信息无效，请检查后重试。`,
    create: t`房间设置无效，请调整人数、难度或赛制后重试。`,
  },
  room_not_found: {
    join: t`没有找到这个房间，请检查 6 位房间号后重试。`,
    create: t`房间已失效，请重新创建。`,
  },
  room_full: {
    join: t`房间已满或对局已经开始，请向房主确认后重试。`,
    create: t`房间状态已变化，请重新创建。`,
  },
  profile_not_found: {
    join: t`当前身份已失效，请先到身份页重新选择身份。`,
    create: t`当前身份已失效，请先到身份页重新选择身份。`,
  },
  idempotency_conflict: {
    join: t`加入请求与上次操作冲突，请确认房间号后重试。`,
    create: t`创建请求与上次设置冲突，请稍候后重新创建。`,
  },
  capacity_reached: {
    join: t`房间服务当前繁忙，请稍后重新加入。`,
    create: t`当前房间数量已达上限，请稍后重新创建。`,
  },
  rate_limited: {
    join: t`加入操作过于频繁，请稍候后重试。`,
    create: t`创建操作过于频繁，请稍候后重试。`,
  },
  unauthorized: {
    join: t`当前会话已失效，请刷新页面后重新加入。`,
    create: t`当前会话已失效，请刷新页面后重新创建。`,
  },
  unavailable: {
    join: t`对战服务暂时不可用，请稍后重新加入。`,
    create: t`对战服务暂时不可用，请稍后重新创建。`,
  },
  internal_error: {
    join: t`对战服务暂时无法加入房间，请稍后重试。`,
    create: t`对战服务暂时无法创建房间，请稍后重试。`,
  },
  network_error: {
    join: t`无法连接对战服务器，请检查网络后重新加入。`,
    create: t`无法连接对战服务器，请检查网络后重新创建。`,
  },
  invalid_response: {
    join: t`服务器返回了异常数据，请刷新页面后重新加入。`,
    create: t`服务器返回了异常数据，请刷新页面后重新创建。`,
  },
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
  socketIoUrl: string;
  mode: "quick" | "room";
}

export interface StoredRealtimeSession {
  credentials: RealtimeCredentials;
  snapshot: Record<string, unknown>;
  hasAuthoritativeSnapshot: boolean;
  startedAt: number;
}

export interface RealtimeClosingIntent {
  mode: RealtimeCredentials["mode"];
  roomCode: string;
  playerId: string;
  tokenFingerprint: string;
  returnTo: string;
  createdAt: number;
}

function tokenFingerprint(token: string) {
  // This is an identity checksum, not an authentication primitive. Keeping the
  // bearer token out of the tombstone means the realtime session remains the
  // single source of credentials while a refresh can still bind an exit to the
  // exact session that created it.
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function realtimeCredentialsMatch(
  left: RealtimeCredentials | null | undefined,
  right: RealtimeCredentials | null | undefined,
) {
  return Boolean(
    left &&
      right &&
      left.mode === right.mode &&
      left.roomCode === right.roomCode &&
      left.playerId === right.playerId &&
      left.sessionToken === right.sessionToken,
  );
}

function closingIntentMatches(
  intent: RealtimeClosingIntent,
  credentials: RealtimeCredentials,
) {
  return (
    intent.mode === credentials.mode &&
    intent.roomCode === credentials.roomCode &&
    intent.playerId === credentials.playerId &&
    intent.tokenFingerprint === tokenFingerprint(credentials.sessionToken)
  );
}

function safeReturnPath(
  value: string | undefined,
  mode: RealtimeCredentials["mode"],
) {
  const fallback = mode === "quick" ? "/quick" : "/room";
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function saveClosingIntent(
  credentials: RealtimeCredentials,
  returnTo?: string,
) {
  const previous = loadClosingIntent();
  const intent: RealtimeClosingIntent = {
    mode: credentials.mode,
    roomCode: credentials.roomCode,
    playerId: credentials.playerId,
    tokenFingerprint: tokenFingerprint(credentials.sessionToken),
    returnTo: safeReturnPath(returnTo, credentials.mode),
    createdAt:
      previous && closingIntentMatches(previous, credentials)
        ? previous.createdAt
        : Date.now(),
  };
  sessionStorage.setItem(CLOSING_INTENT_KEY, JSON.stringify(intent));
  return intent;
}

export function loadClosingIntent(
  credentials?: RealtimeCredentials,
): RealtimeClosingIntent | null {
  try {
    const raw = sessionStorage.getItem(CLOSING_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RealtimeClosingIntent>;
    const valid =
      (parsed.mode === "quick" || parsed.mode === "room") &&
      typeof parsed.roomCode === "string" &&
      /^CS-\d{6}$/.test(parsed.roomCode) &&
      typeof parsed.playerId === "string" &&
      parsed.playerId.length > 0 &&
      typeof parsed.tokenFingerprint === "string" &&
      parsed.tokenFingerprint.length > 0 &&
      typeof parsed.returnTo === "string" &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt);
    if (
      !valid ||
      Date.now() - Number(parsed.createdAt) > CLOSING_INTENT_TTL_MS
    ) {
      sessionStorage.removeItem(CLOSING_INTENT_KEY);
      return null;
    }
    const intent = parsed as RealtimeClosingIntent;
    return !credentials || closingIntentMatches(intent, credentials)
      ? intent
      : null;
  } catch {
    sessionStorage.removeItem(CLOSING_INTENT_KEY);
    return null;
  }
}

export function clearClosingIntentIfMatches(
  credentials: RealtimeCredentials,
) {
  const intent = loadClosingIntent();
  if (intent && closingIntentMatches(intent, credentials)) {
    sessionStorage.removeItem(CLOSING_INTENT_KEY);
  }
}

export interface SessionResponse {
  room_code: string;
  player_id: string;
  session_token: string;
  socket_io_url: string;
  snapshot: Record<string, unknown>;
}

const AUTHORITATIVE_PHASES = new Set(["waiting", "playing", "finished"]);
const AUTHORITATIVE_VISIBILITIES = new Set(["hidden", "open"]);
const AUTHORITATIVE_DIFFICULTIES = new Set(["easy", "full", "hard"]);
const AUTHORITATIVE_BEST_OF = new Set([1, 3, 5]);

/**
 * A persisted session can outlive frontend schema changes. Only render a live
 * room after the snapshot contains the fields that define its topology and
 * rules; credentials remain usable so an older session can still sync.
 */
export function isAuthoritativeRoomSnapshot(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.seq === "number" &&
    Number.isFinite(source.seq) &&
    typeof source.room_code === "string" &&
    /^CS-\d{6}$/.test(source.room_code) &&
    typeof source.self_player_id === "string" &&
    source.self_player_id.length > 0 &&
    typeof source.host_player_id === "string" &&
    source.host_player_id.length > 0 &&
    AUTHORITATIVE_PHASES.has(String(source.phase)) &&
    AUTHORITATIVE_VISIBILITIES.has(String(source.visibility)) &&
    AUTHORITATIVE_DIFFICULTIES.has(String(source.difficulty)) &&
    AUTHORITATIVE_BEST_OF.has(source.best_of as number) &&
    (source.max_players === 2 || source.max_players === 4) &&
    typeof source.max_guesses === "number" &&
    Number.isInteger(source.max_guesses) &&
    source.max_guesses > 0 &&
    typeof source.round_number === "number" &&
    Number.isInteger(source.round_number) &&
    source.round_number >= 0 &&
    Array.isArray(source.players)
  );
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
  playing_bo1: number;
  playing_bo1_hidden?: number;
  playing_bo1_open?: number;
  playing_bo3: number;
  playing_bo3_hidden?: number;
  playing_bo3_open?: number;
  playing_bo5: number;
  playing_bo5_hidden?: number;
  playing_bo5_open?: number;
  playing_group_bo1: number;
  playing_group_bo1_hidden?: number;
  playing_group_bo1_open?: number;
  playing_group_bo3: number;
  playing_group_bo3_hidden?: number;
  playing_group_bo3_open?: number;
  playing_group_bo5: number;
  playing_group_bo5_hidden?: number;
  playing_group_bo5_open?: number;
  playing_total: number;
  easy: MatchmakingDifficultyCounts;
  full: MatchmakingDifficultyCounts;
  hard: MatchmakingDifficultyCounts;
}

export interface MatchmakingDifficultyCounts {
  bo1_hidden: number;
  bo1_open: number;
  bo3_hidden: number;
  bo3_open: number;
  bo5_hidden: number;
  bo5_open: number;
  group_bo1_hidden: number;
  group_bo1_open: number;
  group_bo3_hidden: number;
  group_bo3_open: number;
  group_bo5_hidden: number;
  group_bo5_open: number;
  total: number;
  playing_bo1: number;
  playing_bo1_hidden: number;
  playing_bo1_open: number;
  playing_bo3: number;
  playing_bo3_hidden: number;
  playing_bo3_open: number;
  playing_bo5: number;
  playing_bo5_hidden: number;
  playing_bo5_open: number;
  playing_group_bo1: number;
  playing_group_bo1_hidden: number;
  playing_group_bo1_open: number;
  playing_group_bo3: number;
  playing_group_bo3_hidden: number;
  playing_group_bo3_open: number;
  playing_group_bo5: number;
  playing_group_bo5_hidden: number;
  playing_group_bo5_open: number;
  playing_total: number;
}

export function queueCountFor(
  counts: MatchmakingQueueCounts,
  partySize: 2 | 4,
  bestOf: BestOf,
  visibility: OpponentVisibility,
  difficulty?: GameDifficulty,
) {
  const prefix = partySize === 4 ? "group_" : "";
  const key =
    `${prefix}bo${bestOf}_${visibility}` as keyof MatchmakingDifficultyCounts;
  return (difficulty ? counts[difficulty][key] : counts[key]) ?? 0;
}

export function playingCountFor(
  counts: MatchmakingQueueCounts,
  partySize: 2 | 4,
  bestOf: BestOf,
  difficulty?: GameDifficulty,
  visibility?: OpponentVisibility,
) {
  const prefix = partySize === 4 ? "playing_group_" : "playing_";
  const key = `${prefix}bo${bestOf}${
    visibility ? `_${visibility}` : ""
  }` as keyof MatchmakingDifficultyCounts;
  return (difficulty ? counts[difficulty][key] : counts[key]) ?? 0;
}

export interface ServerEvent extends Record<string, unknown> {
  type:
    | "snapshot"
    | "player_joined"
    | "player_connection"
    | "player_round_forfeited"
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
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A missing or rejected authenticated session is already unusable on the
 * server. Treating these responses as an idempotent local leave prevents an
 * expired token from trapping the user on a recovery screen. Server and
 * transport failures remain retryable and must keep the exact credentials.
 */
export function isTerminalSessionError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.status === 404 ||
      error.code === "unauthorized" ||
      error.code === "forbidden" ||
      error.code === "room_not_found" ||
      error.code === "profile_not_found")
  );
}

export function roomSessionErrorMessage(
  error: unknown,
  action: RoomSessionAction,
) {
  const fallback =
    action === "join"
      ? t`加入房间失败，请检查房间号后重试。`
      : t`创建房间失败，请检查房间设置后重试。`;
  if (!(error instanceof ApiError)) return fallback;

  const mapped = error.code
    ? ROOM_SESSION_ERROR_MESSAGES[error.code]?.[action]
    : undefined;
  if (mapped) return mapped;

  if (error.status === 404) {
    return action === "join"
      ? ROOM_SESSION_ERROR_MESSAGES.room_not_found.join
      : fallback;
  }
  if (error.status === 503) {
    return ROOM_SESSION_ERROR_MESSAGES.unavailable[action];
  }
  return fallback;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<SessionResponse>;
  return (
    typeof response.room_code === "string" &&
    typeof response.player_id === "string" &&
    typeof response.session_token === "string" &&
    typeof response.socket_io_url === "string" &&
    Boolean(response.snapshot) &&
    typeof response.snapshot === "object"
  );
}

async function postSession(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  profile?: { anonymousId: string; syncToken: string },
): Promise<SessionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(profile ? { "X-Profile-Token": profile.syncToken } : {}),
      },
      body: JSON.stringify({
        ...body,
        ...(profile ? { anonymous_id: profile.anonymousId } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      API_ERROR_MESSAGES.network_error,
      undefined,
      "network_error",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const errorCode =
      typeof payload?.code === "string" ? payload.code : undefined;
    const message =
      (errorCode ? API_ERROR_MESSAGES[errorCode] : undefined) ??
      (response.status === 404
        ? API_ERROR_MESSAGES.room_not_found
        : response.status === 409
          ? t`房间已满或当前状态无法加入。`
          : response.status === 503
            ? API_ERROR_MESSAGES.unavailable
            : t`对战服务器暂时无法完成请求，请稍后重试。`);
    throw new ApiError(message, response.status, errorCode);
  }

  if (!isSessionResponse(payload)) {
    throw new ApiError(
      API_ERROR_MESSAGES.invalid_response,
      response.status,
      "invalid_response",
    );
  }
  return payload;
}

export function createRoom(
  identityId: string,
  visibility: OpponentVisibility,
  maxPlayers: number,
  bestOf: BestOf,
  difficulty: GameDifficulty,
  signal?: AbortSignal,
  profile?: { anonymousId: string; syncToken: string },
) {
  return postSession("/v1/rooms", {
    identity_id: identityId,
    visibility,
    max_players: maxPlayers,
    best_of: bestOf,
    difficulty,
  }, signal, profile);
}

export function joinRoom(
  code: string,
  identityId: string,
  signal?: AbortSignal,
  profile?: { anonymousId: string; syncToken: string },
) {
  return postSession(`/v1/rooms/${encodeURIComponent(code)}/join`, {
    identity_id: identityId,
  }, signal, profile);
}

/**
 * Releases a friend-room reservation acquired by a create/join request.
 *
 * The server uses the same authenticated room cancellation endpoint for
 * waiting quick-match and friend-room reservations. Keep this helper separate
 * so callers cannot accidentally persist quick-match semantics in room UI.
 */
type FriendRoomLeaveCredentials =
  | Pick<SessionResponse, "room_code" | "session_token">
  | Pick<RealtimeCredentials, "roomCode" | "sessionToken">;

export async function leaveRoom(
  credentials: FriendRoomLeaveCredentials,
  timeoutMs = 5_000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const roomCode =
      "room_code" in credentials
        ? credentials.room_code
        : credentials.roomCode;
    const sessionToken =
      "session_token" in credentials
        ? credentials.session_token
        : credentials.sessionToken;
    const url = new URL(
      `${API_BASE}/v1/rooms/${encodeURIComponent(roomCode)}`,
      window.location.origin,
    );
    url.searchParams.set("session_token", sessionToken);
    const result = await fetch(url, {
      method: "DELETE",
      keepalive: true,
      signal: controller.signal,
    });
    if (
      result.status !== 204 &&
      result.status !== 401 &&
      result.status !== 403 &&
      result.status !== 404
    ) {
      throw new ApiError(
        t`退出房间失败，请检查网络后重试。`,
        result.status,
      );
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

export function createQuickMatch(
  identityId: string,
  visibility: OpponentVisibility,
  bestOf: BestOf,
  partySize: 2 | 4,
  difficulty: GameDifficulty,
  signal?: AbortSignal,
  clientRequestId?: string,
  profile?: { anonymousId: string; syncToken: string },
) {
  return postSession("/v1/matches/quick", {
    identity_id: identityId,
    visibility,
    best_of: bestOf,
    party_size: partySize,
    difficulty,
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
  }, signal, profile);
}

export async function cancelQuickMatch(
  credentials: RealtimeCredentials,
  signal?: AbortSignal,
) {
  const url = new URL(
    `${API_BASE}/v1/matches/quick/${encodeURIComponent(credentials.roomCode)}`,
    window.location.origin,
  );
  url.searchParams.set("session_token", credentials.sessionToken);
  let response: Response;
  try {
    response = await fetch(url, { method: "DELETE", signal, keepalive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(t`取消匹配失败，请检查网络后重试。`);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    const message =
      (code ? API_ERROR_MESSAGES[code] : undefined) ??
      (typeof payload?.message === "string"
        ? payload.message
        : response.status === 401 || response.status === 403
          ? t`匹配会话已经失效。`
          : response.status === 404
            ? t`匹配票据已经失效或取消。`
            : t`取消匹配失败，请稍后重试。`);
    throw new ApiError(message, response.status, code);
  }
}

export async function leaveQuickMatch(credentials: RealtimeCredentials) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await cancelQuickMatch(credentials, controller.signal);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function cancelQuickMatchByRequestId(clientRequestId: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `${API_BASE}/v1/matches/quick/request/${encodeURIComponent(clientRequestId)}`,
      {
        method: "DELETE",
        keepalive: true,
        signal: controller.signal,
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new ApiError(t`后台清理未完成，服务器将自动回收匹配票据。`, response.status);
    }
  } finally {
    window.clearTimeout(timeout);
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
    socketIoUrl: response.socket_io_url,
    mode,
  };
  const session = {
    credentials,
    snapshot: response.snapshot,
    hasAuthoritativeSnapshot: isAuthoritativeRoomSnapshot(response.snapshot),
    startedAt: Date.now(),
  };
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
      (value.mode !== "quick" && value.mode !== "room") ||
      typeof value.roomCode !== "string" ||
      !/^CS-\d{6}$/.test(value.roomCode) ||
      typeof value.playerId !== "string" ||
      typeof value.sessionToken !== "string" ||
      typeof value.socketIoUrl !== "string"
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    // A different route must not destroy a valid newer session. Exact-match
    // cleanup relies on this being a non-mutating miss when an old async leave
    // settles after the user has already entered another mode.
    if (value.mode !== mode) return null;
    const startedAt =
      typeof session.startedAt === "number" &&
      Number.isFinite(session.startedAt) &&
      session.startedAt > 0
        ? session.startedAt
        : Date.now();
    const migrated = {
      credentials: value as RealtimeCredentials,
      snapshot:
        session.snapshot &&
        typeof session.snapshot === "object" &&
        !Array.isArray(session.snapshot)
          ? session.snapshot
          : {},
      hasAuthoritativeSnapshot: isAuthoritativeRoomSnapshot(session.snapshot),
      startedAt,
    } satisfies StoredRealtimeSession;
    if (
      session.startedAt !== startedAt ||
      session.hasAuthoritativeSnapshot !== migrated.hasAuthoritativeSnapshot
    ) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return null;
  }
}

export function clearCredentials() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<StoredRealtimeSession>)
      : null;
    const roomCode = parsed?.credentials?.roomCode;
    if (typeof roomCode === "string") {
      clearLiveGuessDraftsForRoom(roomCode);
    }
  } catch {
    // The malformed credential entry is still removed below.
  }
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(CLOSING_INTENT_KEY);
}

export function clearCredentialsIfMatches(
  expected: RealtimeCredentials,
) {
  const session = loadCredentials(expected.mode);
  if (
    session?.credentials.roomCode === expected.roomCode &&
    session.credentials.playerId === expected.playerId &&
    session.credentials.sessionToken === expected.sessionToken
  ) {
    clearLiveGuessDraftsForRoom(expected.roomCode);
    sessionStorage.removeItem(SESSION_KEY);
    clearClosingIntentIfMatches(expected);
  }
}

export function discardQuickMatchCredentials(response: SessionResponse) {
  const session = loadCredentials("quick");
  if (
    session?.credentials.roomCode === response.room_code &&
    session.credentials.sessionToken === response.session_token
  ) {
    clearLiveGuessDraftsForRoom(response.room_code);
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function discardRoomCredentials(response: SessionResponse) {
  const session = loadCredentials("room");
  if (
    session?.credentials.roomCode === response.room_code &&
    session.credentials.sessionToken === response.session_token
  ) {
    clearLiveGuessDraftsForRoom(response.room_code);
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function resolveSocketIoEndpoint(socketIoUrl: string) {
  const fallbackBase = API_BASE || window.location.origin;
  const url = new URL(socketIoUrl || "/socket.io", fallbackBase);
  return { url: url.origin, path: url.pathname || "/socket.io" };
}

export function resolveQueueSocketIoEndpoint() {
  const fallbackBase = API_BASE || window.location.origin;
  const url = new URL("/socket.io", fallbackBase);
  return { url: url.origin, path: url.pathname };
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
