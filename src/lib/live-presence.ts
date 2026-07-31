import { t } from "@lingui/core/macro";
import type { OpponentVisibility } from "@/types/game";

export function playerPresenceLabel(
  self: boolean,
  roomConnection: string,
  snapshotConnected: boolean,
  phase: string,
) {
  if (self) {
    if (roomConnection === "connecting") return t`正在连接`;
    if (roomConnection === "reconnecting") return t`正在重连`;
    return roomConnection === "connected" ? t`在线` : t`离线`;
  }
  if (snapshotConnected) return t`在线`;
  return phase === "waiting" ? t`等待连接` : t`离线`;
}

export function disconnectSecondsRemaining(
  deadlineUnixMs: number | null,
  now: number,
) {
  return deadlineUnixMs
    ? Math.max(0, Math.ceil((deadlineUnixMs - now) / 1000))
    : null;
}

export function disconnectSecondsByPlayerId(
  players: readonly {
    playerId: string;
    disconnectDeadline: number | null;
  }[],
  now: number,
) {
  return new Map(
    players.map((player) => [
      player.playerId,
      disconnectSecondsRemaining(player.disconnectDeadline, now),
    ]),
  );
}

export function competitionRankLabels(scores: readonly number[]) {
  return scores.map((score) => {
    const rank = 1 + scores.filter((candidate) => candidate > score).length;
    const tied = scores.filter((candidate) => candidate === score).length > 1;
    return tied ? t`并列第 ${rank}` : t`第 ${rank}`;
  });
}

export function quickRematchPath(
  maxPlayers: number,
  visibility: OpponentVisibility,
  difficulty: string,
  bestOf: number,
) {
  const search = new URLSearchParams({
    difficulty,
    visibility,
    bestOf: String(bestOf),
  });
  if (maxPlayers === 4) search.set("players", "4");
  return `/quick?${search.toString()}`;
}
