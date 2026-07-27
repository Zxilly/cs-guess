import { MAX_GUESSES, type GameStatus } from "@/types/game";

const ROUND_SECONDS = 180;
const ROUND_MILLISECONDS = ROUND_SECONDS * 1_000;
const STORAGE_PREFIX = "cs-guess:daily:v2:";

export interface DailyProgress {
  date: string;
  deadline: number | null;
  guessedIds: string[];
  status: GameStatus;
}

function storageKey(date: string) {
  return `${STORAGE_PREFIX}${date}`;
}

function createDailyProgress(
  challenge: { date: string },
  now: number,
): DailyProgress {
  return {
    date: challenge.date,
    deadline: now + ROUND_MILLISECONDS,
    guessedIds: [],
    status: "playing",
  };
}

export function loadDailyProgress(
  challenge: { date: string },
  catalog: readonly { id: string }[],
  now = Date.now(),
): DailyProgress {
  try {
    const raw = localStorage.getItem(storageKey(challenge.date));
    if (!raw) return createDailyProgress(challenge, now);
    const stored = JSON.parse(raw) as Partial<DailyProgress>;
    const deadline =
      stored.deadline === null ? now + ROUND_MILLISECONDS : stored.deadline;
    const guessedIds = Array.isArray(stored.guessedIds)
      ? stored.guessedIds.filter(
          (id): id is string =>
            typeof id === "string" &&
            catalog.some((player) => player.id === id),
        )
      : [];
    const status =
      stored.status === "won"
        ? "won"
        : typeof deadline === "number" && deadline <= now
          ? "lost"
          : stored.status === "lost" && guessedIds.length >= MAX_GUESSES
            ? "lost"
            : "playing";
    if (
      stored.date !== challenge.date ||
      typeof deadline !== "number" ||
      !Number.isFinite(deadline)
    ) {
      return createDailyProgress(challenge, now);
    }
    return {
      date: challenge.date,
      deadline,
      guessedIds,
      status,
    };
  } catch {
    return createDailyProgress(challenge, now);
  }
}

export function saveDailyProgress(progress: DailyProgress) {
  localStorage.setItem(storageKey(progress.date), JSON.stringify(progress));
}

export function dailySecondsLeft(progress: DailyProgress, now: number) {
  if (progress.status !== "playing") return 0;
  if (progress.deadline === null) return ROUND_SECONDS;
  return Math.max(0, Math.ceil((progress.deadline - now) / 1000));
}
