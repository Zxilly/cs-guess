import type {
  RoundRecordDetails,
  SeriesResult,
} from "@/hooks/use-anonymous-profile";
import type { DailyProgress } from "@/lib/daily-challenge";
import type { ServerDailyChallenge } from "@/lib/daily-challenge-api";

type RecordRound = (
  roundId: string,
  result: SeriesResult,
  details?: RoundRecordDetails,
) => void;

export function recordFinishedDailyRoundOnce(
  previouslyRecordedRoundId: string | undefined,
  progress: DailyProgress,
  challenge: ServerDailyChallenge,
  recordRound: RecordRound,
): string | undefined {
  if (progress.status === "playing") return previouslyRecordedRoundId;
  const roundId = `daily:${challenge.date}`;
  if (previouslyRecordedRoundId === roundId) return roundId;
  recordRound(roundId, progress.status === "won" ? "win" : "loss", {
    mode: "daily",
    roundNumber: challenge.roundNumber,
    bestOf: 1,
    answerId: challenge.mysteryPlayer.id,
    guessIds: progress.guessedIds,
    selfScore: progress.status === "won" ? 1 : 0,
    opponentScore: progress.status === "lost" ? 1 : 0,
  });
  return roundId;
}
