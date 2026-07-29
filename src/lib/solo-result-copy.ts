export type SoloLossReason = "timeout" | "attempts-exhausted";

export function soloLossCopy(
  reason: SoloLossReason | undefined,
  maxGuesses = 8,
) {
  if (reason === "timeout") {
    return {
      title: "时间已到",
      dialogSummary: "本局时间已到，答案已经揭晓。",
      panelSummary: "本局时间已到，答案已经揭晓。",
    };
  }
  if (reason === "attempts-exhausted") {
    return {
      title: "机会已用完",
      dialogSummary: `${maxGuesses} 次猜测机会已用完，答案已经揭晓。`,
      panelSummary: `${maxGuesses} 次猜测机会已用完，答案已经揭晓。`,
    };
  }
  return {
    title: "单人练习结束",
    dialogSummary: "本局答案已经揭晓。",
    panelSummary: "本局答案已经揭晓。",
  };
}
