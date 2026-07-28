import type {
  AnonymousStats,
  MatchHistoryEntry,
} from "@/hooks/use-anonymous-profile";

export function deriveRoundSummary(
  stats: AnonymousStats,
  history: readonly MatchHistoryEntry[],
) {
  const completedRounds = stats.wins + stats.losses + stats.draws;
  const winRate =
    completedRounds === 0
      ? 0
      : Math.round((stats.wins / completedRounds) * 100);
  const winningGuessHistory = history.filter(
    (entry) => entry.result === "win" && entry.guessIds.length > 0,
  );
  const averageWinningGuesses =
    winningGuessHistory.length === 0
      ? null
      : Number(
          (
            winningGuessHistory.reduce(
              (total, entry) => total + entry.guessIds.length,
              0,
            ) / winningGuessHistory.length
          ).toFixed(1),
        );
  const bestGuessCount =
    winningGuessHistory.length === 0
      ? null
      : Math.min(
          ...winningGuessHistory.map((entry) => entry.guessIds.length),
        );

  return {
    completedRounds,
    winRate,
    averageWinningGuesses,
    bestGuessCount,
    winningGuessSampleSize: winningGuessHistory.length,
  };
}
