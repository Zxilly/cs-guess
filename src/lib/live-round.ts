import {
  readNumber,
  readRecords,
  type ServerEvent,
} from "@/lib/realtime";

export function currentRoundHistory(
  snapshot: Record<string, unknown>,
  events: ServerEvent[],
) {
  const latestRoundStartSeq = events.reduce(
    (latest, event) =>
      event.type === "round_started" && typeof event.seq === "number"
        ? Math.max(latest, event.seq)
        : latest,
    -1,
  );
  const roundEvents = events.filter(
    (event) => (event.seq ?? Number.MAX_SAFE_INTEGER) >= latestRoundStartSeq,
  );
  const snapshotRound = readNumber(snapshot, "round_number");
  const eventRound = roundEvents.reduce(
    (round, event) =>
      event.type === "round_started"
        ? (readNumber(event, "round_number") ?? round)
        : round,
    snapshotRound,
  );
  const snapshotBelongsToRound =
    latestRoundStartSeq < 0 || eventRound === snapshotRound;

  return {
    ownGuessEvents: [
      ...(snapshotBelongsToRound ? readRecords(snapshot, "own_guesses") : []),
      ...roundEvents.filter((event) => event.type === "guess_accepted"),
    ],
    opponentEvents: [
      ...(snapshotBelongsToRound
        ? readRecords(snapshot, "opponent_progress")
        : []),
      ...roundEvents.filter((event) => event.type === "opponent_progress"),
    ],
  };
}
