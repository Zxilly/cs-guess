import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo } from "react";
import { mutate } from "swr";
import useSWRImmutable from "swr/immutable";
import useSWRMutation from "swr/mutation";
import { create } from "zustand";

import { players, type Player } from "@/data/players";
import {
  PROFILE_KEY,
  PROFILE_VERSION,
} from "@/lib/identity-profile";
import {
  adoptServerIdentityDraw,
  createServerProfile,
  discardServerIdentityDraw,
  loadServerProfile,
  startServerIdentityDraw,
  type ServerProfile,
} from "@/lib/profile-api";
import { deriveRoundSummary } from "@/lib/round-history";

const MAX_MATCH_HISTORY = 50;
const PROFILE_CHANGED_EVENT = "cs-guess:profile-changed";

export type IdentityPoolId = "common" | "advanced" | "star";
export type SeriesResult = "win" | "loss" | "draw";

export type HistoryPlayerSnapshot = Pick<
  Player,
  | "id"
  | "nickname"
  | "name"
  | "team"
  | "countryCode"
  | "age"
  | "role"
  | "majorAppearances"
>;

export interface MatchHistoryEntry {
  id: string;
  completedAt: string;
  result: SeriesResult;
  mode: "daily" | "solo" | "quick" | "room";
  roomCode?: string;
  roundNumber: number;
  bestOf: number;
  answerId?: string;
  answerSnapshot?: HistoryPlayerSnapshot;
  guessIds: string[];
  guessSnapshots?: (HistoryPlayerSnapshot | null)[];
  opponentNames: string[];
  selfScore: number;
  opponentScore: number;
}

export interface AnonymousStats {
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}

export interface PendingIdentityDraw {
  requestId?: string;
  poolId: IdentityPoolId;
  itemIds: string[];
  winnerId: string;
  winnerIndex: number;
  createdAt: number;
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
  pendingDraw?: PendingIdentityDraw;
  updatedAt: number;
}

export const IDENTITY_POOLS = [
  {
    id: "common",
    label: t`Major 参赛池`,
    unlockWins: 0,
    description: t`参加过 1–4 次 Major、尚未夺冠的职业选手`,
  },
  {
    id: "advanced",
    label: t`Major 资深池`,
    unlockWins: 3,
    description: t`参加过至少 5 次 Major、尚未夺冠的资深选手`,
  },
  {
    id: "star",
    label: t`Major 冠军池`,
    unlockWins: 10,
    description: t`至少赢得过 1 次 Major 冠军的选手`,
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
  if (!player) throw new Error(t`选手池为空`);
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

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
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
      ![4, 5, 6, 7, PROFILE_VERSION].includes(stored.version ?? -1) ||
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
    const pendingDraw = isValidPendingDraw(stored.pendingDraw)
      ? stored.pendingDraw
      : undefined;
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
      pendingDraw,
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

function isValidPendingDraw(value: unknown): value is PendingIdentityDraw {
  if (!value || typeof value !== "object") return false;
  const draw = value as Partial<PendingIdentityDraw>;
  return (
    (draw.requestId === undefined ||
      (typeof draw.requestId === "string" &&
        /^[0-9a-f-]{36}$/i.test(draw.requestId))) &&
    ["common", "advanced", "star"].includes(draw.poolId ?? "") &&
    Array.isArray(draw.itemIds) &&
    draw.itemIds.length === 29 &&
    draw.itemIds.every(
      (id) => typeof id === "string" && players.some((player) => player.id === id),
    ) &&
    typeof draw.winnerId === "string" &&
    Number.isInteger(draw.winnerIndex) &&
    (draw.winnerIndex ?? -1) >= 0 &&
    (draw.winnerIndex ?? 29) < draw.itemIds.length &&
    draw.itemIds[draw.winnerIndex ?? -1] === draw.winnerId &&
    playersInPool(draw.poolId as IdentityPoolId).some(
      (player) => player.id === draw.winnerId,
    ) &&
    typeof draw.createdAt === "number" &&
    Number.isSafeInteger(draw.createdAt) &&
    draw.createdAt > 0
  );
}

function isValidHistoryEntry(value: unknown): value is MatchHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MatchHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.completedAt === "string" &&
    ["win", "loss", "draw"].includes(entry.result ?? "") &&
    ["daily", "solo", "quick", "room"].includes(entry.mode ?? "") &&
    typeof entry.roundNumber === "number" &&
    typeof entry.bestOf === "number" &&
    (entry.answerSnapshot === undefined ||
      isValidHistoryPlayerSnapshot(entry.answerSnapshot)) &&
    Array.isArray(entry.guessIds) &&
    entry.guessIds.every((id) => typeof id === "string") &&
    (entry.guessSnapshots === undefined ||
      (Array.isArray(entry.guessSnapshots) &&
        entry.guessSnapshots.length === entry.guessIds.length &&
        entry.guessSnapshots.every(
          (snapshot) =>
            snapshot === null || isValidHistoryPlayerSnapshot(snapshot),
        ))) &&
    Array.isArray(entry.opponentNames) &&
    entry.opponentNames.every((name) => typeof name === "string") &&
    typeof entry.selfScore === "number" &&
    typeof entry.opponentScore === "number"
  );
}

function isValidHistoryPlayerSnapshot(
  value: unknown,
): value is HistoryPlayerSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<HistoryPlayerSnapshot>;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.nickname === "string" &&
    typeof snapshot.name === "string" &&
    typeof snapshot.team === "string" &&
    typeof snapshot.countryCode === "string" &&
    typeof snapshot.age === "number" &&
    ["AWPer", "Rifler", "IGL", "Entry", "Unknown"].includes(
      snapshot.role ?? "",
    ) &&
    typeof snapshot.majorAppearances === "number"
  );
}

interface SaveProfileOptions {
  notify?: boolean;
  touch?: boolean;
}

interface ServerProfileReadiness {
  syncToken: string;
  promise: Promise<ServerProfile>;
}

const serverProfileReadiness = new Map<string, ServerProfileReadiness>();
let serverMutationQueue = Promise.resolve();

export function profileCacheKey(anonymousId: string) {
  return `cs-guess:server-profile:${anonymousId}`;
}

function saveProfile(
  profile: AnonymousProfile,
  { notify = true, touch = true }: SaveProfileOptions = {},
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
  return stored;
}

function queueServerMutation<T>(mutation: () => Promise<T>) {
  const result = serverMutationQueue.then(mutation, mutation);
  serverMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function ensureServerProfile(local: AnonymousProfile) {
  const initialPlayer =
    playersInPool("common").find(
      (player) => player.id === local.playerId,
    ) ?? playersInPool("common")[0];
  if (!initialPlayer) throw new Error("common identity pool is empty");
  return (
    (await loadServerProfile(local.anonymousId, local.syncToken)) ??
    (await createServerProfile(local, initialPlayer.id))
  );
}

function readyServerProfile(local: AnonymousProfile) {
  const existing = serverProfileReadiness.get(local.anonymousId);
  if (existing?.syncToken === local.syncToken) return existing.promise;

  const promise = ensureServerProfile(local).catch((error: unknown) => {
    const current = serverProfileReadiness.get(local.anonymousId);
    if (current?.promise === promise) {
      serverProfileReadiness.delete(local.anonymousId);
    }
    throw error;
  });
  serverProfileReadiness.set(local.anonymousId, {
    syncToken: local.syncToken,
    promise,
  });
  return promise;
}

export function ensureAnonymousProfileReady(): Promise<ServerProfile> {
  const latest = readProfile();
  if (!latest) return Promise.reject(new Error("anonymous profile is unavailable"));
  return queueServerMutation(async () => {
    const remote = await readyServerProfile(latest);
    const current = readProfile();
    if (current?.anonymousId === latest.anonymousId) {
      storeServerProfile(remote, current.syncToken);
    }
    return remote;
  });
}

function storeServerProfile(
  remote: ServerProfile,
  syncToken: string,
) {
  serverProfileReadiness.set(remote.anonymousId, {
    syncToken,
    promise: Promise.resolve(remote),
  });
  void mutate(profileCacheKey(remote.anonymousId), remote, {
    revalidate: false,
  });
  const current = useAnonymousProfileStore.getState().profile;
  if (
    current.anonymousId === remote.anonymousId &&
    current.syncToken === syncToken &&
    current.updatedAt === remote.updatedAt
  ) {
    return current;
  }
  const saved = saveProfile({ ...remote, syncToken }, { touch: false });
  useAnonymousProfileStore.getState().replaceProfile(saved);
  return saved;
}

export function acceptAuthoritativeProfile(remote: ServerProfile) {
  const latest = readProfile();
  if (!latest || latest.anonymousId !== remote.anonymousId) return;
  storeServerProfile(remote, latest.syncToken);
}

export async function refreshAnonymousProfile() {
  const latest = readProfile();
  if (!latest) return null;
  const remote = await loadServerProfile(
    latest.anonymousId,
    latest.syncToken,
  );
  if (remote) {
    storeServerProfile(remote, latest.syncToken);
  } else {
    serverProfileReadiness.delete(latest.anonymousId);
  }
  return remote;
}

function loadOrCreateProfile() {
  const profile = readProfile() ?? createProfile();
  return saveProfile(profile, {
    notify: false,
    touch: false,
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

async function withDrawMutationLock<T>(mutation: () => T) {
  if (navigator.locks) {
    return navigator.locks.request("cs-guess:identity-draw", mutation);
  }
  return mutation();
}

export function spendDrawCreditSafely(
  poolId: IdentityPoolId,
  replacedWinnerId?: string,
) {
  return withDrawMutationLock(async () => {
    const latest = readProfile();
    if (!latest) return null;
    return queueServerMutation(async () => {
      await readyServerProfile(latest);
      let remote: ServerProfile;
      try {
        remote = await startServerIdentityDraw(
          latest,
          poolId,
          createRequestId(),
          replacedWinnerId,
        );
      } catch (error) {
        const recovered = await loadServerProfile(
          latest.anonymousId,
          latest.syncToken,
        );
        if (!recovered?.pendingDraw) throw error;
        remote = recovered;
      }
      const saved = storeServerProfile(remote, latest.syncToken);
      return saved.pendingDraw ?? null;
    });
  }).catch(() => null);
}

export async function discardPendingIdentityDraw(
  poolId: IdentityPoolId,
  winnerId: string,
) {
  const latest = readProfile();
  if (
    latest?.pendingDraw?.poolId !== poolId ||
    latest.pendingDraw.winnerId !== winnerId
  ) {
    return false;
  }
  try {
    await queueServerMutation(async () => {
      await readyServerProfile(latest);
      const remote = await discardServerIdentityDraw(latest, winnerId);
      storeServerProfile(remote, latest.syncToken);
    });
    return true;
  } catch {
    return false;
  }
}

export async function adoptPendingIdentityDraw(
  poolId: IdentityPoolId,
  selectedPlayerId: string,
) {
  const latest = readProfile();
  const pool = IDENTITY_POOLS.find((candidate) => candidate.id === poolId);
  const selectedPlayer = playersInPool(poolId).find(
    (candidate) =>
      candidate.id === selectedPlayerId && candidate.id !== latest?.playerId,
  );
  if (
    !latest ||
    !pool ||
    latest.stats.wins < pool.unlockWins ||
    latest.pendingDraw?.poolId !== poolId ||
    latest.pendingDraw.winnerId !== selectedPlayerId ||
    !selectedPlayer
  ) {
    return false;
  }
  try {
    await queueServerMutation(async () => {
      await readyServerProfile(latest);
      const remote = await adoptServerIdentityDraw(latest, selectedPlayer.id);
      storeServerProfile(remote, latest.syncToken);
    });
    return true;
  } catch {
    return false;
  }
}

export function useAnonymousProfile() {
  const profile = useAnonymousProfileStore((state) => state.profile);
  const setProfile = useAnonymousProfileStore(
    (state) => state.replaceProfile,
  );
  const anonymousId = profile.anonymousId;
  useSWRImmutable(
    profileCacheKey(anonymousId),
    ensureAnonymousProfileReady,
  );
  const player = useMemo(
    () =>
      players.find((candidate) => candidate.id === profile.playerId) ??
      players[0],
    [profile.playerId],
  );

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

  const roundSummary = deriveRoundSummary(
    profile.stats,
    profile.matchHistory,
  );

  return {
    profile,
    player: player as Player,
    currentPool: poolForPlayer(player as Player),
    ...roundSummary,
    setPreviewDrawCredits,
  };
}

export function useIdentityProfileMutations() {
  const anonymousId = useAnonymousProfileStore(
    (state) => state.profile.anonymousId,
  );
  const {
    trigger: triggerDraw,
    isMutating: drawPending,
  } = useSWRMutation(
    profileCacheKey(anonymousId),
    (
      _key,
      {
        arg,
      }: {
        arg: {
          poolId: IdentityPoolId;
          replacedWinnerId?: string;
        };
      },
    ) => spendDrawCreditSafely(arg.poolId, arg.replacedWinnerId),
  );
  const {
    trigger: triggerAdopt,
    isMutating: adoptPending,
  } = useSWRMutation(
    profileCacheKey(anonymousId),
    (
      _key,
      {
        arg,
      }: {
        arg: {
          poolId: IdentityPoolId;
          playerId: string;
        };
      },
    ) => adoptPendingIdentityDraw(arg.poolId, arg.playerId),
  );
  const {
    trigger: triggerDiscard,
    isMutating: discardPending,
  } = useSWRMutation(
    profileCacheKey(anonymousId),
    (
      _key,
      {
        arg,
      }: {
        arg: {
          poolId: IdentityPoolId;
          winnerId: string;
        };
      },
    ) => discardPendingIdentityDraw(arg.poolId, arg.winnerId),
  );

  const spendDrawCredit = useCallback(
    (poolId: IdentityPoolId, replacedWinnerId?: string) =>
      triggerDraw({ poolId, replacedWinnerId }),
    [triggerDraw],
  );
  const adoptIdentity = useCallback(
    (poolId: IdentityPoolId, selectedPlayerId: string) =>
      triggerAdopt({ poolId, playerId: selectedPlayerId }),
    [triggerAdopt],
  );
  const discardPendingDraw = useCallback(
    (poolId: IdentityPoolId, winnerId: string) =>
      triggerDiscard({ poolId, winnerId }),
    [triggerDiscard],
  );
  const completeIdentitySetup = useCallback(
    (selectedPlayerId: string) =>
      triggerAdopt({ poolId: "common", playerId: selectedPlayerId }),
    [triggerAdopt],
  );

  return {
    spendDrawCredit,
    adoptIdentity,
    discardPendingDraw,
    completeIdentitySetup,
    drawPending,
    adoptPending,
    discardPending,
    profileMutationPending:
      drawPending || adoptPending || discardPending,
  };
}

export function useIdentityProfile() {
  return {
    ...useAnonymousProfile(),
    ...useIdentityProfileMutations(),
  };
}

export function useProfileRefresh() {
  const anonymousId = useAnonymousProfileStore(
    (state) => state.profile.anonymousId,
  );
  useSWRImmutable(
    profileCacheKey(anonymousId),
    ensureAnonymousProfileReady,
  );
  const {
    trigger: triggerRefresh,
    isMutating: profileRefreshing,
  } = useSWRMutation(
    profileCacheKey(anonymousId),
    () => queueServerMutation(refreshAnonymousProfile),
  );
  const refreshProfile = useCallback(
    () => triggerRefresh(),
    [triggerRefresh],
  );

  return { refreshProfile, profileRefreshing };
}
