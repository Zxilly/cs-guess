import type { Player } from "@/data/players";

export interface PreparedIdentityDraw {
  items: readonly Player[];
  winner: Player;
  winnerIndex: number;
}

export interface PersistedIdentityDraw {
  poolId?: string;
  itemIds: readonly string[];
  winnerId: string;
  winnerIndex: number;
}

interface VisibleIdentityDraw extends PreparedIdentityDraw {
  poolId: string;
}

export type PendingIdentityDrawReconciliation =
  | { action: "keep" }
  | { action: "close" }
  | { action: "restore"; draw: VisibleIdentityDraw };

function randomIndex(length: number) {
  if (length <= 1) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % length;
  }
  return Math.floor(Math.random() * length);
}

export function prepareIdentityDraw(
  pool: readonly Player[],
  currentPlayerId: string,
): PreparedIdentityDraw | null {
  const candidates = pool.filter(
    (candidate) => candidate.id !== currentPlayerId,
  );
  const previews = candidates.length > 0 ? candidates : pool;
  if (previews.length === 0) return null;

  const winner = previews[randomIndex(previews.length)];
  const winnerIndex = 23;
  const items = Array.from(
    { length: 29 },
    () => previews[randomIndex(previews.length)],
  );
  items[winnerIndex] = winner;
  return { items, winner, winnerIndex };
}

export function restorePreparedIdentityDraw(
  pendingDraw: PersistedIdentityDraw,
  catalog: readonly Player[],
): PreparedIdentityDraw | null {
  const items = pendingDraw.itemIds.map((id) =>
    catalog.find((player) => player.id === id),
  );
  const winner = catalog.find(
    (player) => player.id === pendingDraw.winnerId,
  );
  if (
    items.some((player) => !player) ||
    !winner ||
    items[pendingDraw.winnerIndex]?.id !== winner.id
  ) {
    return null;
  }
  return {
    items: items as Player[],
    winner,
    winnerIndex: pendingDraw.winnerIndex,
  };
}

export function reconcilePendingIdentityDraw(
  currentDraw: VisibleIdentityDraw | null,
  pendingDraw: PersistedIdentityDraw | undefined,
  catalog: readonly Player[],
): PendingIdentityDrawReconciliation {
  if (!pendingDraw) return { action: "close" };
  const restored = restorePreparedIdentityDraw(pendingDraw, catalog);
  if (!restored || !pendingDraw.poolId) return { action: "close" };

  const matchesCurrent =
    currentDraw?.poolId === pendingDraw.poolId &&
    currentDraw.winner.id === pendingDraw.winnerId &&
    currentDraw.winnerIndex === pendingDraw.winnerIndex &&
    currentDraw.items.length === pendingDraw.itemIds.length &&
    currentDraw.items.every(
      (player, index) => player.id === pendingDraw.itemIds[index],
    );
  if (matchesCurrent) return { action: "keep" };

  return {
    action: "restore",
    draw: {
      poolId: pendingDraw.poolId,
      ...restored,
    },
  };
}
