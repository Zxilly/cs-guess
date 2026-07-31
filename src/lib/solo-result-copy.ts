import { t } from "@lingui/core/macro";
export type SoloLossReason = "timeout" | "attempts-exhausted";

export function soloLossCopy(
  reason: SoloLossReason | undefined,
  maxGuesses = 8,
) {
  if (reason === "timeout") {
    return {
      title: t`时间已到`,
      dialogSummary: t`本局时间已到，答案已经揭晓。`,
      panelSummary: t`本局时间已到，答案已经揭晓。`,
    };
  }
  if (reason === "attempts-exhausted") {
    return {
      title: t`机会已用完`,
      dialogSummary: t`${maxGuesses} 次猜测机会已用完，答案已经揭晓。`,
      panelSummary: t`${maxGuesses} 次猜测机会已用完，答案已经揭晓。`,
    };
  }
  return {
    title: t`单人练习结束`,
    dialogSummary: t`本局答案已经揭晓。`,
    panelSummary: t`本局答案已经揭晓。`,
  };
}
