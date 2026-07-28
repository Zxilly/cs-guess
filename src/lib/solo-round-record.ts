import type {
  RoundRecordDetails,
  SeriesResult,
} from "@/hooks/use-anonymous-profile";
import type { SoloGameState } from "@/lib/solo-game";

type RecordRound = (
  roundId: string,
  result: SeriesResult,
  details?: RoundRecordDetails,
) => void;

export function recordFinishedSoloRoundOnce(
  previouslyRecordedRoundId: string | undefined,
  persistedRoundIds: readonly string[],
  game: SoloGameState,
  recordRound: RecordRound,
): string | undefined {
  if (game.status === "playing") return previouslyRecordedRoundId;
  if (
    previouslyRecordedRoundId === game.roundId ||
    persistedRoundIds.includes(game.roundId)
  ) {
    return game.roundId;
  }
  recordRound(game.roundId, game.status === "won" ? "win" : "loss", {
    mode: "solo",
    roundNumber: game.roundNumber,
    bestOf: 1,
    answerId: game.mysteryId,
    guessIds: game.guessedIds,
    selfScore: game.status === "won" ? 1 : 0,
    opponentScore: game.status === "lost" ? 1 : 0,
  });
  return game.roundId;
}
