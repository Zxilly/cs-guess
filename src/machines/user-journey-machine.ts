import { assign, setup, type SnapshotFrom } from "xstate";

import type { GameDifficulty } from "@/types/game";

interface UserJourneyContext {
  returnTo: string;
  difficulty: GameDifficulty;
}

export function normalizeIdentityReturnTo(value: string | null | undefined) {
  if (value === "/play/room") return "/room";
  if (value === "/play/quick" || value === "/matching") return "/quick";
  if (
    value?.match(
      /^\/quick\?(?:difficulty=(easy|full|hard)|players=4&difficulty=(easy|full|hard))$/,
    )
  ) {
    return value;
  }
  if (
    value === "/" ||
    value === "/room" ||
    value === "/quick" ||
    value === "/quick?players=4" ||
    value === "/play/daily" ||
    value === "/solo" ||
    value === "/play/solo?difficulty=easy" ||
    value === "/play/solo?difficulty=full" ||
    value === "/play/solo?difficulty=hard" ||
    value === "/stats"
  ) {
    return value;
  }
  return "/";
}

export type UserJourneyEvent =
  | {
      type: "BOOT";
      identityConfirmed: boolean;
      returnTo?: string;
    }
  | { type: "IDENTITY_CONFIRMED" }
  | { type: "OPEN_DAILY" }
  | { type: "DAILY_READY" }
  | { type: "LOAD_FAILED" }
  | { type: "RETRY" }
  | { type: "ROUND_WON" }
  | { type: "ROUND_LOST" }
  | { type: "OPEN_SOLO" }
  | { type: "SELECT_DIFFICULTY"; difficulty: GameDifficulty }
  | { type: "PLAY_AGAIN" }
  | { type: "CHANGE_DIFFICULTY" }
  | { type: "OPEN_QUICK" }
  | { type: "START_MATCHING" }
  | { type: "MATCH_REQUEST_ACCEPTED" }
  | { type: "MATCH_REQUEST_FAILED" }
  | { type: "CANCEL_MATCHING" }
  | { type: "CANCEL_FAILED" }
  | { type: "MATCH_CANCELLED" }
  | { type: "MATCH_FOUND" }
  | { type: "ENTER_MATCH" }
  | { type: "ROUND_STARTED" }
  | { type: "ROUND_FINISHED" }
  | { type: "NEXT_ROUND" }
  | { type: "SERIES_FINISHED" }
  | { type: "OPEN_ROOM" }
  | { type: "SUBMIT_ROOM" }
  | { type: "ROOM_REQUEST_FAILED" }
  | { type: "ROOM_READY" }
  | { type: "CONNECT_REALTIME" }
  | { type: "SOCKET_CONNECTED" }
  | { type: "CONNECTION_LOST" }
  | { type: "CONNECTION_RESTORED" }
  | { type: "SESSION_EXPIRED" }
  | { type: "RETRY_CONNECTION" }
  | { type: "LEAVE_REALTIME" }
  | { type: "OPEN_IDENTITY" }
  | { type: "IDENTITY_DONE" }
  | { type: "OPEN_STATS" }
  | { type: "BEGIN_DRAW" }
  | { type: "DRAW_REVEALED" }
  | { type: "KEEP_IDENTITY" }
  | { type: "REROLL_IDENTITY" }
  | { type: "OPEN_REPLAY" }
  | { type: "CLOSE_REPLAY" }
  | { type: "EXIT_TO_LOBBY" };

export const userJourneyMachine = setup({
  types: {
    context: {} as UserJourneyContext,
    events: {} as UserJourneyEvent,
  },
  actions: {
    rememberReturnTo: assign({
      returnTo: ({ event }) =>
        event.type === "BOOT"
          ? normalizeIdentityReturnTo(event.returnTo)
          : "/",
    }),
    rememberDifficulty: assign({
      difficulty: ({ event }) =>
        event.type === "SELECT_DIFFICULTY" ? event.difficulty : "easy",
    }),
  },
  guards: {
    needsOnboarding: ({ event }) =>
      event.type === "BOOT" && !event.identityConfirmed,
    returnsToDaily: ({ context }) => context.returnTo === "/play/daily",
    returnsToSolo: ({ context }) =>
      context.returnTo === "/solo" ||
      context.returnTo.startsWith("/play/solo"),
    returnsToQuick: ({ context }) => context.returnTo.startsWith("/quick"),
    returnsToRoom: ({ context }) =>
      context.returnTo === "/room" || context.returnTo === "/play/room",
    returnsToStats: ({ context }) => context.returnTo === "/stats",
  },
}).createMachine({
  id: "user-journey",
  type: "parallel",
  context: {
    returnTo: "/",
    difficulty: "easy",
  },
  states: {
    experience: {
      initial: "checkingIdentity",
      on: {
        EXIT_TO_LOBBY: ".lobby",
      },
      states: {
        checkingIdentity: {
          on: {
            BOOT: [
              {
                guard: "needsOnboarding",
                target: "onboarding",
                actions: "rememberReturnTo",
              },
              {
                target: "lobby",
                actions: "rememberReturnTo",
              },
            ],
          },
        },
        onboarding: {
          initial: "idle",
          on: {
            IDENTITY_CONFIRMED: [
              {
                guard: "returnsToDaily",
                target: "daily.loading",
              },
              {
                guard: "returnsToSolo",
                target: "solo.selectingDifficulty",
              },
              {
                guard: "returnsToQuick",
                target: "quick.setup",
              },
              {
                guard: "returnsToRoom",
                target: "room.setup",
              },
              {
                guard: "returnsToStats",
                target: "stats",
              },
              { target: "lobby" },
            ],
          },
          states: {
            idle: {
              on: {
                BEGIN_DRAW: "rolling",
              },
            },
            rolling: {
              on: {
                DRAW_REVEALED: "result",
              },
            },
            result: {},
          },
        },
        lobby: {
          on: {
            OPEN_DAILY: "daily.loading",
            OPEN_SOLO: "solo.selectingDifficulty",
            OPEN_QUICK: "quick.setup",
            OPEN_ROOM: "room.setup",
            OPEN_IDENTITY: "identity",
            OPEN_STATS: "stats",
          },
        },
        identity: {
          initial: "idle",
          on: {
            IDENTITY_DONE: "lobby",
          },
          states: {
            idle: {
              on: {
                BEGIN_DRAW: "rolling",
              },
            },
            rolling: {
              on: {
                DRAW_REVEALED: "result",
              },
            },
            result: {
              on: {
                KEEP_IDENTITY: "idle",
                REROLL_IDENTITY: "rolling",
              },
            },
          },
        },
        stats: {
          initial: "list",
          states: {
            list: {
              on: {
                OPEN_REPLAY: "replay",
              },
            },
            replay: {
              on: {
                CLOSE_REPLAY: "list",
              },
            },
          },
        },
        daily: {
          initial: "loading",
          states: {
            loading: {
              on: {
                DAILY_READY: "playing",
                LOAD_FAILED: "error",
              },
            },
            error: {
              on: {
                RETRY: "loading",
              },
            },
            playing: {
              on: {
                ROUND_WON: "won",
                ROUND_LOST: "lost",
              },
            },
            won: {},
            lost: {},
          },
        },
        solo: {
          initial: "selectingDifficulty",
          states: {
            selectingDifficulty: {
              on: {
                SELECT_DIFFICULTY: {
                  target: "playing",
                  actions: "rememberDifficulty",
                },
              },
            },
            playing: {
              on: {
                ROUND_WON: "won",
                ROUND_LOST: "lost",
                CHANGE_DIFFICULTY: "selectingDifficulty",
              },
            },
            won: {
              on: {
                PLAY_AGAIN: "playing",
                CHANGE_DIFFICULTY: "selectingDifficulty",
              },
            },
            lost: {
              on: {
                PLAY_AGAIN: "playing",
                CHANGE_DIFFICULTY: "selectingDifficulty",
              },
            },
          },
        },
        quick: {
          initial: "setup",
          states: {
            setup: {
              on: {
                START_MATCHING: "submitting",
              },
            },
            submitting: {
              on: {
                MATCH_REQUEST_ACCEPTED: "matching",
                MATCH_REQUEST_FAILED: "setupError",
              },
            },
            setupError: {
              on: {
                RETRY: "setup",
              },
            },
            matching: {
              on: {
                MATCH_FOUND: "entering",
                CANCEL_MATCHING: "canceling",
              },
            },
            canceling: {
              on: {
                MATCH_CANCELLED: "setup",
                CANCEL_FAILED: "cancelError",
                MATCH_FOUND: "entering",
              },
            },
            cancelError: {
              on: {
                CANCEL_MATCHING: "canceling",
                MATCH_FOUND: "entering",
              },
            },
            entering: {
              on: {
                ENTER_MATCH: "waiting",
              },
            },
            waiting: {
              on: {
                ROUND_STARTED: "playing",
                SERIES_FINISHED: "seriesResult",
              },
            },
            playing: {
              on: {
                ROUND_FINISHED: "roundResult",
                SERIES_FINISHED: "seriesResult",
              },
            },
            roundResult: {
              on: {
                NEXT_ROUND: "waiting",
                SERIES_FINISHED: "seriesResult",
              },
            },
            seriesResult: {},
          },
        },
        room: {
          initial: "setup",
          states: {
            setup: {
              on: {
                SUBMIT_ROOM: "submitting",
              },
            },
            submitting: {
              on: {
                ROOM_READY: "waiting",
                ROOM_REQUEST_FAILED: "error",
              },
            },
            error: {
              on: {
                RETRY: "setup",
              },
            },
            waiting: {
              on: {
                ROUND_STARTED: "playing",
                SERIES_FINISHED: "seriesResult",
              },
            },
            playing: {
              on: {
                ROUND_FINISHED: "roundResult",
                SERIES_FINISHED: "seriesResult",
              },
            },
            roundResult: {
              on: {
                NEXT_ROUND: "waiting",
                SERIES_FINISHED: "seriesResult",
              },
            },
            seriesResult: {},
          },
        },
      },
    },
    connection: {
      initial: "idle",
      states: {
        idle: {
          on: {
            CONNECT_REALTIME: "connecting",
          },
        },
        connecting: {
          on: {
            SOCKET_CONNECTED: "connected",
            CONNECTION_LOST: "reconnecting",
            SESSION_EXPIRED: "offline",
            LEAVE_REALTIME: "closed",
          },
        },
        connected: {
          on: {
            CONNECTION_LOST: "reconnecting",
            SESSION_EXPIRED: "offline",
            LEAVE_REALTIME: "closed",
          },
        },
        reconnecting: {
          on: {
            CONNECTION_RESTORED: "connected",
            SOCKET_CONNECTED: "connected",
            SESSION_EXPIRED: "offline",
            LEAVE_REALTIME: "closed",
          },
        },
        offline: {
          on: {
            RETRY_CONNECTION: "connecting",
            LEAVE_REALTIME: "closed",
          },
        },
        closed: {
          on: {
            CONNECT_REALTIME: "connecting",
          },
        },
      },
    },
  },
});

export const USER_JOURNEY_STATES = [
  {
    id: "checkingIdentity",
    label: "检查身份",
    route: "/",
    description: "读取本地匿名档案并决定是否需要首次身份引导。",
  },
  {
    id: "onboarding.idle",
    label: "首次身份引导",
    route: "/identity",
    description: "抽取并确认初始职业选手身份。",
  },
  {
    id: "onboarding.rolling",
    label: "初始身份抽取中",
    route: "/identity",
    description: "播放选手卡滚动动画并预载候选头像。",
  },
  {
    id: "onboarding.result",
    label: "初始身份待确认",
    route: "/identity",
    description: "展示抽取结果，确认后进入原本请求的页面。",
  },
  {
    id: "lobby",
    label: "模式大厅",
    route: "/",
    description: "查看身份、今日挑战和全部游戏模式入口。",
  },
  {
    id: "identity.idle",
    label: "身份管理",
    route: "/identity",
    description: "查看身份池、抽取次数并决定是否更换身份。",
  },
  {
    id: "identity.rolling",
    label: "身份重抽中",
    route: "/identity",
    description: "消耗抽取次数并播放滚动动画。",
  },
  {
    id: "identity.result",
    label: "新身份待选择",
    route: "/identity",
    description: "允许保留当前身份、使用新身份或再次抽取。",
  },
  {
    id: "stats.list",
    label: "战绩与回放",
    route: "/stats",
    description: "查看已持久化的对局结果和历史记录。",
  },
  {
    id: "stats.replay",
    label: "对局回放",
    route: "/stats",
    description: "在对话框中查看答案和逐次猜测结果。",
  },
  {
    id: "daily.loading",
    label: "今日挑战载入",
    route: "/play/daily",
    description: "从后端读取当天固定题目和已有进度。",
  },
  {
    id: "daily.error",
    label: "今日挑战载入失败",
    route: "/play/daily",
    description: "展示可恢复错误并允许重新载入。",
  },
  {
    id: "daily.playing",
    label: "今日挑战进行中",
    route: "/play/daily",
    description: "计时、搜索选手并在八次机会内提交猜测。",
  },
  {
    id: "daily.won",
    label: "今日挑战成功",
    route: "/play/daily",
    description: "展示答案、结果明细和庆祝反馈。",
  },
  {
    id: "daily.lost",
    label: "今日挑战失败",
    route: "/play/daily",
    description: "机会耗尽或超时后展示答案和结果。",
  },
  {
    id: "solo.selectingDifficulty",
    label: "单人难度选择",
    route: "/solo",
    description: "选择简单、完整或困难题库。",
  },
  {
    id: "solo.playing",
    label: "单人练习进行中",
    route: "/play/solo",
    description: "随机题目计时竞猜。",
  },
  {
    id: "solo.won",
    label: "单人练习成功",
    route: "/play/solo",
    description: "展示结果并允许继续下一局。",
  },
  {
    id: "solo.lost",
    label: "单人练习失败",
    route: "/play/solo",
    description: "展示答案并允许重试或更换难度。",
  },
  {
    id: "quick.setup",
    label: "匹配设置",
    route: "/quick",
    description: "选择人数、题库、赛制和对手猜测可见性。",
  },
  {
    id: "quick.submitting",
    label: "匹配请求提交中",
    route: "/quick",
    description: "创建匹配票据并禁用重复提交。",
  },
  {
    id: "quick.setupError",
    label: "匹配请求失败",
    route: "/quick",
    description: "展示容量、网络或参数错误并允许重试。",
  },
  {
    id: "quick.matching",
    label: "等待匹配",
    route: "/matching",
    description: "显示排队与游戏中人数，并允许取消。",
  },
  {
    id: "quick.canceling",
    label: "取消匹配中",
    route: "/matching",
    description: "取消当前票据并防止重复操作。",
  },
  {
    id: "quick.cancelError",
    label: "取消匹配失败",
    route: "/matching",
    description: "保留排队状态、显示错误并允许再次取消。",
  },
  {
    id: "quick.entering",
    label: "匹配成功进场",
    route: "/matching",
    description: "播放匹配成功反馈后进入实时对局。",
  },
  {
    id: "quick.waiting",
    label: "匹配对局等待开局",
    route: "/play/quick",
    description: "等待所有玩家建立实时连接。",
  },
  {
    id: "quick.playing",
    label: "匹配回合进行中",
    route: "/play/quick",
    description: "同步双方或四人进度并提交猜测。",
  },
  {
    id: "quick.roundResult",
    label: "匹配单回合结算",
    route: "/play/quick",
    description: "展示当前回合答案并等待下一回合。",
  },
  {
    id: "quick.seriesResult",
    label: "匹配系列赛结算",
    route: "/play/quick",
    description: "展示最终胜负、比分和答案。",
  },
  {
    id: "room.setup",
    label: "好友房设置",
    route: "/room",
    description: "加入房间或配置人数、题库、赛制和可见性。",
  },
  {
    id: "room.submitting",
    label: "好友房提交中",
    route: "/room",
    description: "创建或加入房间请求正在处理。",
  },
  {
    id: "room.error",
    label: "好友房请求失败",
    route: "/room",
    description: "显示房间号、容量或网络错误并允许重试。",
  },
  {
    id: "room.waiting",
    label: "好友房等待开局",
    route: "/play/room",
    description: "等待房主和其他玩家就位。",
  },
  {
    id: "room.playing",
    label: "好友房回合进行中",
    route: "/play/room",
    description: "同步房间成员进度并进行同题竞猜。",
  },
  {
    id: "room.roundResult",
    label: "好友房单回合结算",
    route: "/play/room",
    description: "展示当前答案并等待房主开启下一局。",
  },
  {
    id: "room.seriesResult",
    label: "好友房系列赛结算",
    route: "/play/room",
    description: "展示系列赛最终排名和答案。",
  },
] as const;

export const USER_CONNECTION_STATES = [
  {
    id: "idle",
    label: "无需实时连接",
    description: "当前页面不依赖 Socket.IO。",
  },
  {
    id: "connecting",
    label: "建立实时连接",
    description: "正在握手并同步服务器快照。",
  },
  {
    id: "connected",
    label: "实时连接正常",
    description: "可接收广播并提交实时指令。",
  },
  {
    id: "reconnecting",
    label: "自动重连",
    description: "保留当前界面并尝试恢复实时连接。",
  },
  {
    id: "offline",
    label: "会话失效",
    description: "停止提交指令并提供显式恢复出口。",
  },
  {
    id: "closed",
    label: "主动离开",
    description: "用户主动退出后不再自动重连。",
  },
] as const;

export type UserJourneyStateId = (typeof USER_JOURNEY_STATES)[number]["id"];
export type UserConnectionStateId =
  (typeof USER_CONNECTION_STATES)[number]["id"];

type UserJourneySnapshot = SnapshotFrom<typeof userJourneyMachine>;

function stateIdFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "checkingIdentity";
  const [parent, child] = Object.entries(value)[0] ?? [];
  return typeof child === "string" ? `${parent}.${child}` : String(parent);
}

export function describeUserJourney(snapshot: UserJourneySnapshot) {
  const value = snapshot.value as {
    experience?: unknown;
    connection?: unknown;
  };
  const id = stateIdFromValue(value.experience) as UserJourneyStateId;
  const definition =
    USER_JOURNEY_STATES.find((state) => state.id === id) ??
    USER_JOURNEY_STATES[0];
  const route =
    id.startsWith("solo.") && id !== "solo.selectingDifficulty"
      ? `/play/solo?difficulty=${snapshot.context.difficulty}`
      : definition.route;
  const connectionId = stateIdFromValue(
    value.connection,
  ) as UserConnectionStateId;
  const connection =
    USER_CONNECTION_STATES.find((state) => state.id === connectionId) ??
    USER_CONNECTION_STATES[0];

  return {
    ...definition,
    route,
    connection,
  };
}
