import { t } from "@lingui/core/macro";
import { players, type Player } from "@/data/players";
import type {
  HistoryPlayerSnapshot,
  MatchHistoryEntry,
} from "@/hooks/use-anonymous-profile";

export const STATS_REPLAY_CLOSE_LABEL = t`关闭对局回放`;

export function focusReplayTitle(
  event: { preventDefault: () => void },
  title: { focus: () => void } | null,
) {
  event.preventDefault();
  title?.focus();
}

function historySnapshotAsPlayer(
  snapshot: HistoryPlayerSnapshot,
): Player {
  return {
    ...snapshot,
    nationality: snapshot.countryCode,
    majorWins: 0,
  };
}

export function resolveHistoryPlayer(
  id: string | undefined,
  snapshot?: HistoryPlayerSnapshot | null,
) {
  if (!id) return undefined;
  if (snapshot?.id === id) return historySnapshotAsPlayer(snapshot);
  return players.find((player) => player.id === id);
}

export function resolveReplayData(entry: MatchHistoryEntry) {
  const answer = resolveHistoryPlayer(entry.answerId, entry.answerSnapshot);
  const guesses = entry.guessIds.map((id, index) =>
    resolveHistoryPlayer(id, entry.guessSnapshots?.[index]),
  );
  return {
    answer,
    guesses,
    unavailableGuessCount: guesses.filter((guess) => !guess).length,
  };
}

interface HistoryGroup {
  key: string;
  roomCode?: string;
  entries: MatchHistoryEntry[];
}

export function groupRoundHistory(history: readonly MatchHistoryEntry[]) {
  return history.reduce<HistoryGroup[]>((groups, entry) => {
    const key = entry.roomCode
      ? `${entry.mode}:${entry.roomCode}`
      : entry.id;
    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.entries.push(entry);
    } else {
      groups.push({ key, roomCode: entry.roomCode, entries: [entry] });
    }
    return groups;
  }, []);
}
