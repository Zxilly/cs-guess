import { t } from "@lingui/core/macro";
import { players } from "@/data/players";
import {
  debugPatchAnonymousProfile,
  getAnonymousProfileSnapshot,
} from "@/hooks/use-anonymous-profile";
import type {
  MatchmakingDifficultyCounts,
  MatchmakingQueueCounts,
  StoredRealtimeSession,
} from "@/lib/realtime";
import { useDebugStore } from "@/stores/debug-store";

const AUDIT_ROOM_CODES: Record<string, string> = {
  "matching-waiting": "CS-910001",
  "matching-offline": "CS-910002",
  "matching-found": "CS-910003",
  "matching-canceling": "CS-910004",
  "matching-cancel-error": "CS-910005",
  "live-waiting": "CS-920001",
  "live-playing": "CS-920002",
  "live-reconnecting": "CS-920003",
  "live-offline": "CS-920004",
  "live-round-win": "CS-920005",
  "live-round-loss": "CS-920006",
  "live-series-win": "CS-920007",
  "live-series-loss": "CS-920008",
  "live-rematch-invite": "CS-920009",
  "live-rematch-waiting": "CS-920010",
  "live-rematch-starting": "CS-920011",
  "live-rematch-declined": "CS-920012",
  "live-rematch-offline": "CS-920013",
  "live-rematch-expired": "CS-920014",
  "live-rematch-cancelled": "CS-920015",
};

const AUDIT_LABELS: Record<string, string> = {
  "identity-onboarding": t`01 首次进入·身份引导`,
  lobby: t`02 模式首页`,
  "identity-idle": t`03 身份管理`,
  "identity-rolling": t`04 身份抽取·滚动`,
  "identity-result": t`05 身份抽取·结果`,
  "onboarding-rolling": t`33 首次身份·滚动`,
  "onboarding-result": t`34 首次身份·结果`,
  "solo-difficulty": t`06 单人难度选择`,
  "solo-playing": t`07 单人·进行中`,
  "solo-won": t`08 单人·胜利结算`,
  "solo-lost": t`09 单人·失败结算`,
  "daily-loading": t`10 每日·加载中`,
  "daily-error": t`11 每日·加载失败`,
  "daily-playing": t`12 每日·进行中`,
  "daily-won": t`13 每日·胜利结算`,
  "daily-lost": t`14 每日·失败结算`,
  "quick-1v1": t`15 快速匹配·1v1设置`,
  "quick-4p": t`16 快速匹配·4人设置`,
  "matching-waiting": t`17 匹配·等待中`,
  "matching-offline": t`18 匹配·连接失败`,
  "matching-found": t`19 匹配·成功进场`,
  "room-setup": t`20 好友房·加入与创建`,
  "live-waiting": t`21 好友房·等待开局`,
  "live-playing": t`22 对战·进行中`,
  "live-reconnecting": t`23 对战·重连中`,
  "live-offline": t`24 对战·离线恢复`,
  "live-round-win": t`25 对战·单局胜利`,
  "live-round-loss": t`26 对战·单局失败`,
  "live-series-win": t`27 对战·系列赛胜利`,
  "live-series-loss": t`28 对战·系列赛失败`,
  "live-rematch-invite": t`42 重赛·收到邀请`,
  "live-rematch-waiting": t`43 重赛·等待回应`,
  "live-rematch-starting": t`44 重赛·正在匹配`,
  "live-rematch-declined": t`45 重赛·对手拒绝`,
  "live-rematch-offline": t`46 重赛·对手离线`,
  "live-rematch-expired": t`47 重赛·邀请超时`,
  "live-rematch-cancelled": t`48 重赛·邀请取消`,
  "solo-result-panel": t`29 单人·结算明细`,
  "daily-result-panel": t`30 每日·结算明细`,
  "stats-list": t`31 战绩·列表`,
  "stats-replay": t`32 战绩·回放详情`,
  "quick-submitting": t`35 快速匹配·提交中`,
  "quick-error": t`36 快速匹配·提交失败`,
  "matching-canceling": t`37 匹配·取消中`,
  "matching-cancel-error": t`38 匹配·取消失败`,
  "room-submitting": t`39 好友房·创建中`,
  "room-error": t`40 好友房·创建失败`,
  "stats-empty": t`41 战绩·空状态`,
};

function difficultyCounts(seed: number): MatchmakingDifficultyCounts {
  return {
    bo1_hidden: seed + 2,
    bo1_open: seed + 1,
    bo3_hidden: seed + 5,
    bo3_open: seed + 3,
    bo5_hidden: seed + 2,
    bo5_open: seed,
    group_bo1_hidden: seed + 1,
    group_bo1_open: seed,
    group_bo3_hidden: seed + 2,
    group_bo3_open: seed + 1,
    group_bo5_hidden: seed + 1,
    group_bo5_open: seed,
    playing_bo1_hidden: seed * 2 + 8,
    playing_bo1_open: seed + 4,
    playing_bo3_hidden: seed * 2 + 12,
    playing_bo3_open: seed + 6,
    playing_bo5_hidden: seed + 6,
    playing_bo5_open: seed + 3,
    playing_group_bo1_hidden: seed + 3,
    playing_group_bo1_open: seed + 2,
    playing_group_bo3_hidden: seed + 5,
    playing_group_bo3_open: seed + 3,
    playing_group_bo5_hidden: seed + 3,
    playing_group_bo5_open: seed + 1,
  };
}

function queueCounts(): MatchmakingQueueCounts {
  const easy = difficultyCounts(4);
  const full = difficultyCounts(7);
  const hard = difficultyCounts(11);
  return {
    easy,
    full,
    hard,
  };
}

function realtimeSnapshot(audit: string, roomCode: string) {
  const profile = getAnonymousProfileSnapshot();
  const selfName =
    players.find((player) => player.id === profile.playerId)?.nickname ??
    "Attacker";
  const waiting = audit === "matching-waiting" ||
    audit === "matching-offline" ||
    audit === "matching-canceling" ||
    audit === "matching-cancel-error" ||
    audit === "live-waiting";
  const found = audit === "matching-found";
  const rematchAudit = audit.includes("rematch-");
  const finished =
    audit.includes("round-") || audit.includes("series-") || rematchAudit;
  const seriesFinished = audit.includes("series-") || rematchAudit;
  const selfWon = audit.includes("win") || rematchAudit;
  const hasRoundProgress = audit === "live-playing" || finished;
  const playersInRoom = [
    {
      player_id: "audit-self",
      seat_index: 0,
      display_name: selfName,
      connected: true,
      forfeited_this_round: false,
      guess_count: hasRoundProgress ? 3 : 0,
      score: finished && selfWon ? 1 : 0,
    },
    {
      player_id: "audit-rival",
      seat_index: 1,
      display_name: "ZywOo",
      connected: true,
      forfeited_this_round: false,
      guess_count: hasRoundProgress ? 5 : 0,
      score: finished && !selfWon ? 1 : 0,
    },
  ];
  const visiblePlayers = waiting && !found
    ? playersInRoom.slice(0, audit === "live-waiting" ? 2 : 1)
    : playersInRoom;

  const rematch = (() => {
    if (!rematchAudit) return undefined;
    const incoming = audit === "live-rematch-invite";
    const status = audit.replace("live-rematch-", "");
    const resolvedStatus =
      status === "waiting" || status === "invite"
        ? "pending"
        : status === "offline"
          ? "opponent_offline"
          : status;
    return {
      invitation_id: `audit-rematch-${status}`,
      requester_player_id: incoming ? "audit-rival" : "audit-self",
      status: resolvedStatus,
      expires_at_unix_ms: Date.now() + 18_000,
      responses: playersInRoom.map((player) => ({
        player_id: player.player_id,
        display_name: player.display_name,
        decision:
          resolvedStatus === "starting"
            ? "accepted"
            : incoming
              ? player.player_id === "audit-rival"
                ? "accepted"
                : "pending"
              : player.player_id === "audit-self"
                ? "accepted"
                : resolvedStatus === "declined"
                  ? "declined"
                  : "pending",
      })),
    };
  })();

  return {
    seq: 42,
    phase: finished ? "finished" : found ? "playing" : waiting ? "waiting" : "playing",
    room_code: roomCode,
    self_player_id: "audit-self",
    host_player_id: "audit-self",
    max_players: 2,
    max_guesses: 10,
    best_of: 3,
    difficulty: "hard",
    visibility: "hidden",
    round_number: finished ? 2 : 1,
    deadline_unix_ms: Date.now() + 3_600_000,
    players: visiblePlayers,
    series_status: seriesFinished ? "completed" : "active",
    ...(rematch ? { rematch } : {}),
    ...(finished
      ? {
          winner_player_id: selfWon ? "audit-self" : "audit-rival",
          mystery_id: "donk",
          finish_reason: "solved",
        }
      : {}),
    ...(seriesFinished
      ? {
          series_winner_player_id: selfWon ? "audit-self" : "audit-rival",
          series_finish_reason: "score_limit",
          series_final_standings: playersInRoom.map((player, index) => ({
            ...player,
            rank: selfWon ? index + 1 : 2 - index,
          })),
          round_results: [
            {
              round_number: 1,
              mystery_id: "zywoo",
              winner_player_id: "audit-rival",
              finish_reason: "solved",
              standings: playersInRoom.map((player) => ({
                ...player,
                guess_count: player.player_id === "audit-rival" ? 5 : 3,
              })),
            },
            {
              round_number: 2,
              mystery_id: "donk",
              winner_player_id: selfWon ? "audit-self" : "audit-rival",
              finish_reason: "solved",
              standings: playersInRoom.map((player) => ({
                ...player,
                guess_count:
                  player.player_id === "audit-self" ? 3 : 5,
              })),
            },
          ],
        }
      : {}),
  };
}

export function installAuditState() {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const audit = params.get("audit");
  if (!audit) return;

  document.documentElement.dataset.audit = audit;
  document.title = t`审查｜${AUDIT_LABELS[audit] ?? audit}`;
  const profile = getAnonymousProfileSnapshot();
  if (!profile.identityConfirmed) {
    debugPatchAnonymousProfile({ identityConfirmed: true });
  }

  useDebugStore.getState().setQueue(queueCounts(), true);

  const roomCode = AUDIT_ROOM_CODES[audit];
  if (!roomCode) return;
  const mode = audit.startsWith("live-") &&
    window.location.pathname.includes("/room")
    ? "room"
    : "quick";
  const snapshot = realtimeSnapshot(audit, roomCode);
  const session: StoredRealtimeSession = {
    credentials: {
      roomCode,
      playerId: "audit-self",
      sessionToken: `audit-token-${audit}`,
      socketIoUrl: "/socket.io",
      mode,
    },
    snapshot,
    hasAuthoritativeSnapshot: true,
    startedAt: Date.now(),
  };
  sessionStorage.setItem(
    "cs-guess:realtime-session",
    JSON.stringify(session),
  );
  const offline = audit === "matching-offline" || audit === "live-offline";
  const reconnecting = audit === "live-reconnecting";
  useDebugStore.getState().setRealtime({
    connection: offline
      ? "offline"
      : reconnecting
        ? "reconnecting"
        : "connected",
    snapshot,
    events: [],
    error: offline
      ? t`实时连接暂时不可用，请检查网络后重试。`
      : reconnecting
        ? t`连接中断，正在尝试恢复对局。`
        : "",
  });
}
