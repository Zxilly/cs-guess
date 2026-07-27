import type { Player } from "@/data/players";
import type { GameStatus } from "@/types/game";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const ROUND_SECONDS = 180;
const STORAGE_PREFIX = "cs-guess:daily:v1:";

export interface DailyChallenge {
  date: string;
  roundNumber: number;
  mysteryPlayer: Player;
}

export interface DailyProgress {
  date: string;
  deadline: number | null;
  guessedIds: string[];
  status: GameStatus;
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SHANGHAI_TIME_ZONE,
  }).format(now);
}

export function dailyChallenge(
  catalog: readonly Player[],
  now = new Date(),
): DailyChallenge {
  if (catalog.length === 0) {
    throw new Error("职业选手目录为空");
  }
  const date = shanghaiDate(now);
  const [year, month, day] = date.split("-").map(Number);
  const startOfYear = Date.UTC(year, 0, 1);
  const currentDay = Date.UTC(year, month - 1, day);
  const roundNumber =
    Math.floor((currentDay - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const catalogSignature = `${catalog.length}:${catalog[0]?.id}:${catalog.at(-1)?.id}`;
  const index = fnv1a(`${date}:${catalogSignature}`) % catalog.length;
  return { date, roundNumber, mysteryPlayer: catalog[index] };
}

function storageKey(date: string) {
  return `${STORAGE_PREFIX}${date}`;
}

function createDailyProgress(
  challenge: DailyChallenge,
): DailyProgress {
  return {
    date: challenge.date,
    deadline: null,
    guessedIds: [],
    status: "playing",
  };
}

export function loadDailyProgress(
  challenge: DailyChallenge,
  catalog: readonly Player[],
  now = Date.now(),
): DailyProgress {
  try {
    const raw = localStorage.getItem(storageKey(challenge.date));
    if (!raw) return createDailyProgress(challenge);
    const stored = JSON.parse(raw) as Partial<DailyProgress>;
    const guessedIds = Array.isArray(stored.guessedIds)
      ? stored.guessedIds.filter(
          (id): id is string =>
            typeof id === "string" &&
            catalog.some((player) => player.id === id),
        )
      : [];
    const status =
      stored.status === "won" || stored.status === "lost"
        ? stored.status
        : typeof stored.deadline === "number" && stored.deadline <= now
          ? "lost"
          : "playing";
    if (
      stored.date !== challenge.date ||
      !(
        stored.deadline === null ||
        (typeof stored.deadline === "number" &&
          Number.isFinite(stored.deadline))
      )
    ) {
      return createDailyProgress(challenge);
    }
    return {
      date: challenge.date,
      deadline: stored.deadline,
      guessedIds,
      status,
    };
  } catch {
    return createDailyProgress(challenge);
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
