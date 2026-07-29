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
  "identity-onboarding": "01 首次进入·身份引导",
  lobby: "02 模式首页",
  "identity-idle": "03 身份管理",
  "identity-rolling": "04 身份抽取·滚动",
  "identity-result": "05 身份抽取·结果",
  "onboarding-rolling": "33 首次身份·滚动",
  "onboarding-result": "34 首次身份·结果",
  "solo-difficulty": "06 单人难度选择",
  "solo-playing": "07 单人·进行中",
  "solo-won": "08 单人·胜利结算",
  "solo-lost": "09 单人·失败结算",
  "daily-loading": "10 每日·加载中",
  "daily-error": "11 每日·加载失败",
  "daily-playing": "12 每日·进行中",
  "daily-won": "13 每日·胜利结算",
  "daily-lost": "14 每日·失败结算",
  "quick-1v1": "15 快速匹配·1v1设置",
  "quick-4p": "16 快速匹配·4人设置",
  "matching-waiting": "17 匹配·等待中",
  "matching-offline": "18 匹配·连接失败",
  "matching-found": "19 匹配·成功进场",
  "room-setup": "20 好友房·加入与创建",
  "live-waiting": "21 好友房·等待开局",
  "live-playing": "22 对战·进行中",
  "live-reconnecting": "23 对战·重连中",
  "live-offline": "24 对战·离线恢复",
  "live-round-win": "25 对战·单局胜利",
  "live-round-loss": "26 对战·单局失败",
  "live-series-win": "27 对战·系列赛胜利",
  "live-series-loss": "28 对战·系列赛失败",
  "live-rematch-invite": "42 重赛·收到邀请",
  "live-rematch-waiting": "43 重赛·等待回应",
  "live-rematch-starting": "44 重赛·正在匹配",
  "live-rematch-declined": "45 重赛·对手拒绝",
  "live-rematch-offline": "46 重赛·对手离线",
  "live-rematch-expired": "47 重赛·邀请超时",
  "live-rematch-cancelled": "48 重赛·邀请取消",
  "solo-result-panel": "29 单人·结算明细",
  "daily-result-panel": "30 每日·结算明细",
  "stats-list": "31 战绩·列表",
  "stats-replay": "32 战绩·回放详情",
  "quick-submitting": "35 快速匹配·提交中",
  "quick-error": "36 快速匹配·提交失败",
  "matching-canceling": "37 匹配·取消中",
  "matching-cancel-error": "38 匹配·取消失败",
  "room-submitting": "39 好友房·创建中",
  "room-error": "40 好友房·创建失败",
  "stats-empty": "41 战绩·空状态",
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
    total: seed * 4 + 18,
    playing_bo1: seed * 3 + 12,
    playing_bo1_hidden: seed * 2 + 8,
    playing_bo1_open: seed + 4,
    playing_bo3: seed * 3 + 18,
    playing_bo3_hidden: seed * 2 + 12,
    playing_bo3_open: seed + 6,
    playing_bo5: seed * 2 + 9,
    playing_bo5_hidden: seed + 6,
    playing_bo5_open: seed + 3,
    playing_group_bo1: seed + 5,
    playing_group_bo1_hidden: seed + 3,
    playing_group_bo1_open: seed + 2,
    playing_group_bo3: seed + 8,
    playing_group_bo3_hidden: seed + 5,
    playing_group_bo3_open: seed + 3,
    playing_group_bo5: seed + 4,
    playing_group_bo5_hidden: seed + 3,
    playing_group_bo5_open: seed + 1,
    playing_total: seed * 9 + 56,
  };
}

function queueCounts(): MatchmakingQueueCounts {
  const easy = difficultyCounts(4);
  const full = difficultyCounts(7);
  const hard = difficultyCounts(11);
  return {
    bo1: 15,
    bo3: 27,
    bo5: 13,
    bo1_hidden: 10,
    bo1_open: 5,
    bo3_hidden: 18,
    bo3_open: 9,
    bo5_hidden: 9,
    bo5_open: 4,
    total: easy.total + full.total + hard.total,
    group_bo1: 8,
    group_bo3: 13,
    group_bo5: 7,
    group_bo1_hidden: 5,
    group_bo1_open: 3,
    group_bo3_hidden: 9,
    group_bo3_open: 4,
    group_bo5_hidden: 5,
    group_bo5_open: 2,
    group_total: 28,
    playing_bo1: 47,
    playing_bo1_hidden: 31,
    playing_bo1_open: 16,
    playing_bo3: 76,
    playing_bo3_hidden: 51,
    playing_bo3_open: 25,
    playing_bo5: 42,
    playing_bo5_hidden: 28,
    playing_bo5_open: 14,
    playing_group_bo1: 18,
    playing_group_bo1_hidden: 12,
    playing_group_bo1_open: 6,
    playing_group_bo3: 29,
    playing_group_bo3_hidden: 19,
    playing_group_bo3_open: 10,
    playing_group_bo5: 16,
    playing_group_bo5_hidden: 11,
    playing_group_bo5_open: 5,
    playing_total: easy.playing_total + full.playing_total + hard.playing_total,
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
              standings: playersInRoom,
            },
            {
              round_number: 2,
              mystery_id: "donk",
              winner_player_id: selfWon ? "audit-self" : "audit-rival",
              finish_reason: "solved",
              standings: playersInRoom,
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
  document.title = `审查｜${AUDIT_LABELS[audit] ?? audit}`;
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
      ? "实时连接暂时不可用，请检查网络后重试。"
      : reconnecting
        ? "连接中断，正在尝试恢复对局。"
        : "",
  });
}
