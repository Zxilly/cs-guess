import { t } from "@lingui/core/macro";
import type {
  GameDifficulty,
  OpponentVisibility,
} from "@/types/game";

const difficultyNames: Record<GameDifficulty, string> = {
  easy: t`简单`,
  full: t`完整`,
  hard: t`困难`,
};

export function friendRoomSettings({
  maxPlayers,
  visibility,
  difficulty,
  bestOf,
}: {
  maxPlayers: number;
  visibility: OpponentVisibility;
  difficulty: GameDifficulty;
  bestOf: number;
}) {
  return [
    t`${maxPlayers} 人`,
    visibility === "open" ? t`明牌` : t`隐藏猜测`,
    difficultyNames[difficulty],
    `BO${bestOf}`,
  ];
}

export function friendRoomStartDisabledReason({
  connected,
  isHost,
  connectedPlayers,
  requiredPlayers,
  startPending,
}: {
  connected: boolean;
  isHost: boolean;
  connectedPlayers: number;
  requiredPlayers: number;
  startPending: boolean;
}) {
  if (!connected) return t`正在连接服务器`;
  if (!isHost) return t`仅房主可以开始`;
  if (connectedPlayers < requiredPlayers) {
    return t`还需 ${requiredPlayers - connectedPlayers} 位成员连接`;
  }
  if (startPending) return t`正在通知所有成员`;
  return "";
}

function copyWithSelection(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand?.("copy") === true;
  } finally {
    textarea.remove();
  }
}

export async function copyRoomCode(text: string) {
  const clipboard = navigator.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Older and permission-restricted browsers can still use selection copy.
    }
  }

  if (!copyWithSelection(text)) {
    throw new Error("clipboard unavailable");
  }
}
