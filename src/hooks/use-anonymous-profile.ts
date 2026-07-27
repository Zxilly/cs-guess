import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

import { players, type Player } from "@/data/players";
import {
  PROFILE_KEY,
  PROFILE_VERSION,
} from "@/lib/identity-profile";
import {
  loadServerProfile,
  saveServerProfile,
} from "@/lib/profile-api";

const MAX_RECORDED_ROUNDS = 100;
const MAX_MATCH_HISTORY = 50;
const PROFILE_CHANGED_EVENT = "cs-guess:profile-changed";

export type IdentityPoolId = "common" | "advanced" | "star";
export type SeriesResult = "win" | "loss" | "draw";

export interface MatchHistoryEntry {
  id: string;
  completedAt: string;
  result: SeriesResult;
  mode: "daily" | "quick" | "room";
  roomCode?: string;
  roundNumber: number;
  bestOf: number;
  answerId?: string;
  guessIds: string[];
  opponentNames: string[];
  selfScore: number;
  opponentScore: number;
}

export interface RoundRecordDetails {
  mode: MatchHistoryEntry["mode"];
  roomCode?: string;
  roundNumber?: number;
  bestOf?: number;
  answerId?: string;
  guessIds?: string[];
  opponentNames?: string[];
  selfScore?: number;
  opponentScore?: number;
}

export interface AnonymousStats {
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}

export interface AnonymousProfile {
  anonymousId: string;
  syncToken: string;
  playerId: string;
  identityConfirmed: boolean;
  stats: AnonymousStats;
  drawCredits: number;
  lossesTowardCredit: number;
  recordedRounds: string[];
  matchHistory: MatchHistoryEntry[];
  updatedAt: number;
}

export const IDENTITY_POOLS = [
  {
    id: "common",
    label: "Major 参赛池",
    unlockWins: 0,
    description: "参加过 1–4 次 Major、尚未夺冠的职业选手",
  },
  {
    id: "advanced",
    label: "Major 资深池",
    unlockWins: 3,
    description: "参加过至少 5 次 Major、尚未夺冠的资深选手",
  },
  {
    id: "star",
    label: "Major 冠军池",
    unlockWins: 10,
    description: "至少赢得过 1 次 Major 冠军的选手",
  },
] as const;

function randomIndex(length: number) {
  if (length <= 1) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % length;
  }
  return Math.floor(Math.random() * length);
}

export function playersInPool(poolId: IdentityPoolId) {
  return players.filter((player) => {
    if (poolId === "common") {
      return (
        player.majorAppearances >= 1 &&
        player.majorAppearances <= 4 &&
        player.majorWins === 0
      );
    }
    if (poolId === "advanced") {
      return player.majorAppearances >= 5 && player.majorWins === 0;
    }
    return player.majorWins >= 1;
  });
}

function pickPlayer(poolId: IdentityPoolId, excludedId?: string) {
  const pool = playersInPool(poolId);
  const available = pool.filter((player) => player.id !== excludedId);
  const candidates = available.length > 0 ? available : pool;
  const player = candidates[randomIndex(candidates.length)];
  if (!player) throw new Error("选手池为空");
  return player;
}

function eligibleIdentityId(playerId: string) {
  const current = players.find((player) => player.id === playerId);
  if (current && current.majorAppearances >= 1) return current.id;
  return pickPlayer("common").id;
}

function createAnonymousId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `anonymous-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createSyncToken() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  }
  return `${createAnonymousId()}${createAnonymousId()}`.replaceAll("-", "");
}

function createProfile(): AnonymousProfile {
  return {
    anonymousId: createAnonymousId(),
    syncToken: createSyncToken(),
    playerId: pickPlayer("common").id,
    identityConfirmed: false,
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
    },
    drawCredits: 1,
    lossesTowardCredit: 0,
    recordedRounds: [],
    matchHistory: [],
    updatedAt: Date.now(),
  };
}

function isValidStats(value: unknown): value is AnonymousStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<AnonymousStats>;
  return [
    stats.wins,
    stats.losses,
    stats.draws,
    stats.currentStreak,
    stats.bestStreak,
  ].every((item) => typeof item === "number" && item >= 0);
}

function readProfile(): AnonymousProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<AnonymousProfile> & {
      version?: number;
    };
    if (
      ![4, 5, 6, PROFILE_VERSION].includes(stored.version ?? -1) ||
      typeof stored.anonymousId !== "string" ||
      typeof stored.playerId !== "string" ||
      !isValidStats(stored.stats) ||
      typeof stored.drawCredits !== "number" ||
      stored.drawCredits < 0 ||
      typeof stored.lossesTowardCredit !== "number" ||
      ![0, 1].includes(stored.lossesTowardCredit) ||
      !Array.isArray(stored.recordedRounds)
    ) {
      return null;
    }
    const validHistory = Array.isArray(stored.matchHistory)
      ? stored.matchHistory.filter(isValidHistoryEntry)
      : [];
    const passiveDailyLosses = validHistory.filter(
      (entry) =>
        entry.mode === "daily" &&
        entry.result === "loss" &&
        entry.guessIds.length === 0,
    );
    const matchHistory = validHistory
      .filter((entry) => !passiveDailyLosses.includes(entry))
      .slice(-MAX_MATCH_HISTORY);
    const retainedRoundIds = new Set(matchHistory.map((entry) => entry.id));
    return {
      anonymousId: stored.anonymousId,
      syncToken:
        typeof stored.syncToken === "string" &&
        /^[A-Za-z0-9_-]{32,128}$/.test(stored.syncToken)
          ? stored.syncToken
          : createSyncToken(),
      playerId: eligibleIdentityId(stored.playerId),
      identityConfirmed:
        (stored.version ?? 0) >= 6
          ? stored.identityConfirmed === true
          : true,
      stats: {
        ...stored.stats,
        losses: Math.max(
          0,
          stored.stats.losses - passiveDailyLosses.length,
        ),
      },
      drawCredits: stored.drawCredits,
      lossesTowardCredit: Math.max(
        0,
        stored.lossesTowardCredit - passiveDailyLosses.length,
      ),
      recordedRounds: stored.recordedRounds.filter(
        (value): value is string =>
          typeof value === "string" &&
          (!value.startsWith("daily:") || retainedRoundIds.has(value)),
      ),
      matchHistory,
      updatedAt:
        typeof stored.updatedAt === "number" &&
        Number.isSafeInteger(stored.updatedAt) &&
        stored.updatedAt > 0
          ? stored.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function isValidHistoryEntry(value: unknown): value is MatchHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MatchHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.completedAt === "string" &&
    ["win", "loss", "draw"].includes(entry.result ?? "") &&
    ["daily", "quick", "room"].includes(entry.mode ?? "") &&
    typeof entry.roundNumber === "number" &&
    typeof entry.bestOf === "number" &&
    Array.isArray(entry.guessIds) &&
    entry.guessIds.every((id) => typeof id === "string") &&
    Array.isArray(entry.opponentNames) &&
    entry.opponentNames.every((name) => typeof name === "string") &&
    typeof entry.selfScore === "number" &&
    typeof entry.opponentScore === "number"
  );
}

interface SaveProfileOptions {
  notify?: boolean;
  touch?: boolean;
  sync?: boolean;
}

let syncRequested = false;
let syncQueue = Promise.resolve();
const hydrationByProfile = new Map<string, Promise<void>>();

function saveProfile(
  profile: AnonymousProfile,
  { notify = true, touch = true, sync = true }: SaveProfileOptions = {},
) {
  const stored = touch
    ? {
        ...profile,
        updatedAt: Math.max(Date.now(), profile.updatedAt + 1),
      }
    : profile;
  localStorage.setItem(
    PROFILE_KEY,
    JSON.stringify({ version: PROFILE_VERSION, ...stored }),
  );
  if (notify) window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  if (sync) scheduleProfileSync();
  return stored;
}

function scheduleProfileSync() {
  syncRequested = true;
  syncQueue = syncQueue
    .then(async () => {
      while (syncRequested) {
        syncRequested = false;
        const local = readProfile();
        if (!local) return;
        try {
          const remote = await saveServerProfile(local);
          const latest = readProfile();
          if (latest && remote.updatedAt > latest.updatedAt) {
            saveProfile(
              { ...remote, syncToken: latest.syncToken },
              { touch: false, sync: false },
            );
          }
        } catch {
          // Local storage remains the durable offline cache. A later mutation
          // or page load will retry synchronization.
        }
      }
    })
    .catch(() => undefined);
}

function hydrateProfile(local: AnonymousProfile) {
  const existing = hydrationByProfile.get(local.anonymousId);
  if (existing) return existing;
  const hydration = (async () => {
    try {
      const remote = await loadServerProfile(
        local.anonymousId,
        local.syncToken,
      );
      const latest = readProfile();
      if (!latest || latest.anonymousId !== local.anonymousId) return;
      if (remote && remote.updatedAt > latest.updatedAt) {
        saveProfile(
          { ...remote, syncToken: latest.syncToken },
          { touch: false, sync: false },
        );
      } else {
        scheduleProfileSync();
      }
    } catch {
      // The app stays usable offline and retries on the next local change.
    }
  })().finally(() => {
    hydrationByProfile.delete(local.anonymousId);
  });
  hydrationByProfile.set(local.anonymousId, hydration);
  return hydration;
}

function loadOrCreateProfile() {
  const profile = readProfile() ?? createProfile();
  return saveProfile(profile, {
    notify: false,
    touch: false,
    sync: false,
  });
}

interface AnonymousProfileStore {
  profile: AnonymousProfile;
  replaceProfile: (profile: AnonymousProfile) => void;
}

const useAnonymousProfileStore = create<AnonymousProfileStore>()((set) => ({
  profile: loadOrCreateProfile(),
  replaceProfile: (profile) => set({ profile }),
}));

export function getAnonymousProfileSnapshot() {
  return useAnonymousProfileStore.getState().profile;
}

export type AnonymousProfilePatch = Omit<
  Partial<AnonymousProfile>,
  "stats"
> & {
  stats?: Partial<AnonymousStats>;
};

export function debugPatchAnonymousProfile(
  patch: AnonymousProfilePatch,
) {
  if (!import.meta.env.DEV) return;
  const latest = readProfile() ?? getAnonymousProfileSnapshot();
  const next: AnonymousProfile = {
    ...latest,
    ...patch,
    stats: patch.stats ? { ...latest.stats, ...patch.stats } : latest.stats,
  };
  const saved = saveProfile(next);
  useAnonymousProfileStore.getState().replaceProfile(saved);
}

function poolForPlayer(player: Player): IdentityPoolId {
  if (player.majorWins >= 1) return "star";
  if (player.majorAppearances >= 5) return "advanced";
  return "common";
}

export function useAnonymousProfile() {
  const profile = useAnonymousProfileStore((state) => state.profile);
  const setProfile = useAnonymousProfileStore(
    (state) => state.replaceProfile,
  );
  const anonymousId = profile.anonymousId;
  const player = useMemo(
    () =>
      players.find((candidate) => candidate.id === profile.playerId) ??
      players[0],
    [profile.playerId],
  );

  useEffect(() => {
    const latest = readProfile();
    if (latest?.anonymousId === anonymousId) {
      void hydrateProfile(latest);
    }
  }, [anonymousId]);

  useEffect(() => {
    function applyLatestProfile() {
      const latest = readProfile();
      if (latest) setProfile(latest);
    }

    function syncProfile(event: StorageEvent) {
      if (event.key !== PROFILE_KEY) return;
      applyLatestProfile();
    }
    window.addEventListener("storage", syncProfile);
    window.addEventListener(PROFILE_CHANGED_EVENT, applyLatestProfile);
    return () => {
      window.removeEventListener("storage", syncProfile);
      window.removeEventListener(PROFILE_CHANGED_EVENT, applyLatestProfile);
    };
  }, [setProfile]);

  const spendDrawCredit = useCallback(
    (poolId: IdentityPoolId) => {
      const latest = readProfile();
      const pool = IDENTITY_POOLS.find((candidate) => candidate.id === poolId);
      if (
        !latest ||
        !pool ||
        latest.stats.wins < pool.unlockWins ||
        latest.drawCredits < 1
      ) {
        return;
      }
      const next = {
        ...latest,
        drawCredits: latest.drawCredits - 1,
      };
      const saved = saveProfile(next);
      setProfile(saved);
    },
    [setProfile],
  );

  const adoptIdentity = useCallback(
    (poolId: IdentityPoolId, selectedPlayerId: string) => {
      const latest = readProfile();
      const pool = IDENTITY_POOLS.find(
        (candidate) => candidate.id === poolId,
      );
      const selectedPlayer = latest
        ? playersInPool(poolId).find(
            (candidate) =>
              candidate.id === selectedPlayerId &&
              candidate.id !== latest.playerId,
          )
        : undefined;
      if (
        !latest ||
        !pool ||
        latest.stats.wins < pool.unlockWins ||
        !selectedPlayer
      ) {
        return;
      }
      const next = {
        ...latest,
        playerId: selectedPlayer.id,
        identityConfirmed: true,
      };
      const saved = saveProfile(next);
      setProfile(saved);
    },
    [setProfile],
  );

  const completeIdentitySetup = useCallback((selectedPlayerId: string) => {
    const latest = readProfile();
    const selectedPlayer = playersInPool("common").find(
      (candidate) => candidate.id === selectedPlayerId,
    );
    if (
      !latest ||
      latest.identityConfirmed ||
      latest.drawCredits < 1 ||
      !selectedPlayer
    ) {
      return false;
    }
    const next: AnonymousProfile = {
      ...latest,
      playerId: selectedPlayer.id,
      identityConfirmed: true,
      drawCredits: latest.drawCredits - 1,
    };
    const saved = saveProfile(next);
    setProfile(saved);
    return true;
  }, [setProfile]);

  const setPreviewDrawCredits = useCallback((amount: number) => {
    if (!import.meta.env.DEV || !Number.isInteger(amount) || amount < 1) return;
    const latest = readProfile();
    if (!latest) return;
    const next = {
      ...latest,
      drawCredits: amount,
    };
    const saved = saveProfile(next);
    setProfile(saved);
  }, [setProfile]);

  const recordRound = useCallback(
    (
      roundId: string,
      result: SeriesResult,
      details?: RoundRecordDetails,
    ) => {
      const latest = readProfile();
      if (!latest || latest.recordedRounds.includes(roundId)) return;

      const nextStreak =
        result === "win" ? latest.stats.currentStreak + 1 : 0;
      const lossesTowardCredit =
        result === "loss"
          ? latest.lossesTowardCredit + 1
          : latest.lossesTowardCredit;
      const earnedCredits =
        result === "win"
          ? 1
          : result === "loss" && lossesTowardCredit >= 2
            ? 1
            : 0;
      const next: AnonymousProfile = {
        ...latest,
        stats: {
          wins: latest.stats.wins + (result === "win" ? 1 : 0),
          losses: latest.stats.losses + (result === "loss" ? 1 : 0),
          draws: latest.stats.draws + (result === "draw" ? 1 : 0),
          currentStreak: nextStreak,
          bestStreak: Math.max(latest.stats.bestStreak, nextStreak),
        },
        drawCredits: latest.drawCredits + earnedCredits,
        lossesTowardCredit:
          result === "loss" ? lossesTowardCredit % 2 : lossesTowardCredit,
        recordedRounds: [
          ...latest.recordedRounds.slice(-(MAX_RECORDED_ROUNDS - 1)),
          roundId,
        ],
        matchHistory: details
          ? [
              ...latest.matchHistory.slice(-(MAX_MATCH_HISTORY - 1)),
              {
                id: roundId,
                completedAt: new Date().toISOString(),
                result,
                mode: details.mode,
                roomCode: details.roomCode,
                roundNumber: details.roundNumber ?? 1,
                bestOf: details.bestOf ?? 1,
                answerId: details.answerId,
                guessIds: details.guessIds ?? [],
                opponentNames: details.opponentNames ?? [],
                selfScore: details.selfScore ?? 0,
                opponentScore: details.opponentScore ?? 0,
              },
            ]
          : latest.matchHistory,
      };
      const saved = saveProfile(next);
      setProfile(saved);
    },
    [setProfile],
  );

  const completedSeries =
    profile.stats.wins + profile.stats.losses + profile.stats.draws;
  const winRate =
    completedSeries === 0
      ? 0
      : Math.round((profile.stats.wins / completedSeries) * 100);
  const winningHistory = profile.matchHistory.filter(
    (entry) => entry.result === "win",
  );
  const averageWinningGuesses =
    winningHistory.length === 0
      ? 0
      : Number(
          (
            winningHistory.reduce(
              (total, entry) => total + entry.guessIds.length,
              0,
            ) / winningHistory.length
          ).toFixed(1),
        );
  const bestGuessCount =
    winningHistory.length === 0
      ? 0
      : Math.min(...winningHistory.map((entry) => entry.guessIds.length));

  return {
    profile,
    player: player as Player,
    currentPool: poolForPlayer(player as Player),
    completedSeries,
    winRate,
    averageWinningGuesses,
    bestGuessCount,
    spendDrawCredit,
    adoptIdentity,
    completeIdentitySetup,
    setPreviewDrawCredits,
    recordRound,
  };
}
