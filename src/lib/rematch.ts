import { t } from "@lingui/core/macro";
import { readNumber, readRecord, readRecords, readString } from "@/lib/realtime";

export type RematchStatus =
  | "pending"
  | "starting"
  | "declined"
  | "cancelled"
  | "expired"
  | "opponent_offline";

export type RematchDecision = "pending" | "accepted" | "declined";

export interface RematchResponse {
  playerId: string;
  displayName: string;
  decision: RematchDecision;
}

export interface RematchState {
  invitationId: string;
  requesterPlayerId: string;
  status: RematchStatus;
  expiresAt: number;
  responses: RematchResponse[];
}

const REMATCH_STATUSES = new Set<RematchStatus>([
  "pending",
  "starting",
  "declined",
  "cancelled",
  "expired",
  "opponent_offline",
]);

const REMATCH_DECISIONS = new Set<RematchDecision>([
  "pending",
  "accepted",
  "declined",
]);

const TERMINAL_REMATCH_STATUSES = new Set<RematchStatus>([
  "declined",
  "cancelled",
  "expired",
  "opponent_offline",
]);

export function readRematchState(
  snapshot: Record<string, unknown>,
): RematchState | null {
  const source = readRecord(snapshot, "rematch");
  if (!source) return null;
  const invitationId = readString(source, "invitation_id");
  const requesterPlayerId = readString(source, "requester_player_id");
  const rawStatus = readString(source, "status");
  const expiresAt = readNumber(source, "expires_at_unix_ms");
  if (
    !invitationId ||
    !requesterPlayerId ||
    !rawStatus ||
    !REMATCH_STATUSES.has(rawStatus as RematchStatus) ||
    expiresAt === undefined
  ) {
    return null;
  }

  return {
    invitationId,
    requesterPlayerId,
    status: rawStatus as RematchStatus,
    expiresAt,
    responses: readRecords(source, "responses").flatMap((response) => {
      const playerId = readString(response, "player_id");
      const displayName = readString(response, "display_name");
      const rawDecision = readString(response, "decision");
      if (
        !playerId ||
        !displayName ||
        !rawDecision ||
        !REMATCH_DECISIONS.has(rawDecision as RematchDecision)
      ) {
        return [];
      }
      return [{
        playerId,
        displayName,
        decision: rawDecision as RematchDecision,
      }];
    }),
  };
}

export function rematchSecondsLeft(
  rematch: RematchState,
  now: number,
) {
  return Math.max(0, Math.ceil((rematch.expiresAt - now) / 1_000));
}

export function rematchPendingNames(rematch: RematchState) {
  return rematch.responses
    .filter((response) => response.decision === "pending")
    .map((response) => response.displayName);
}

export function terminalRematchKey(
  rematch: RematchState | null,
  requesterPlayerId: string,
) {
  if (
    !rematch ||
    rematch.requesterPlayerId !== requesterPlayerId ||
    !TERMINAL_REMATCH_STATUSES.has(rematch.status)
  ) {
    return null;
  }
  return `${rematch.invitationId}:${rematch.status}`;
}

export function rematchStatusCopy(status: RematchStatus) {
  switch (status) {
    case "declined":
      return {
        title: t`对手拒绝了重赛`,
        description: t`本次邀请已结束，你仍可查看本局结果或重新匹配。`,
      };
    case "cancelled":
      return {
        title: t`重赛邀请已取消`,
        description: t`当前对局结果不会改变，你可以继续查看或重新匹配。`,
      };
    case "expired":
      return {
        title: t`重赛邀请已超时`,
        description: t`对手没有在规定时间内回应，本次邀请已自动结束。`,
      };
    case "opponent_offline":
      return {
        title: t`原对手当前离线`,
        description: t`无法建立重赛。你可以等待对手恢复后再邀请，或重新匹配。`,
      };
    case "starting":
      return {
        title: t`正在匹配原对手`,
        description: t`服务器正在重置比分和题目，即将开始新的系列赛。`,
      };
    default:
      return {
        title: t`等待原对手回应`,
        description: t`邀请已送达；所有对手同意后将直接开始新的系列赛。`,
      };
  }
}
