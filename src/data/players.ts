import playersUrl from "./players.generated.json?url";

import type { Player } from "@/data/player-types";

export {
  playerRoleNameZh,
  type Player,
  type PlayerRole,
} from "@/data/player-types";

let cachedPlayers: readonly Player[] | undefined;
let pendingPlayers: Promise<readonly Player[]> | undefined;
let playerLoadError: unknown;

interface PlayerLoadOptions {
  priority?: "auto" | "high" | "low";
}

export function loadPlayers({ priority = "auto" }: PlayerLoadOptions = {}) {
  if (cachedPlayers) return Promise.resolve(cachedPlayers);
  if (playerLoadError) return Promise.reject(playerLoadError);
  if (!pendingPlayers) {
    const requestInit: RequestInit & { priority: "auto" | "high" | "low" } = {
      credentials: "same-origin",
      priority,
    };
    pendingPlayers = fetch(playersUrl, requestInit)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`player catalog load failed: ${response.status}`);
        }
        const catalog = (await response.json()) as unknown;
        if (!Array.isArray(catalog) || catalog.length === 0) {
          throw new Error("player catalog response is not a non-empty array");
        }
        cachedPlayers = catalog as readonly Player[];
        return cachedPlayers;
      })
      .catch((error: unknown) => {
        playerLoadError = error;
        throw error;
      });
  }
  return pendingPlayers;
}

export function readPlayers() {
  if (cachedPlayers) return cachedPlayers;
  if (playerLoadError) throw playerLoadError;
  throw loadPlayers();
}

export function usePlayers() {
  return readPlayers();
}

export const players = new Proxy([] as Player[], {
  get(_target, property) {
    const catalog = readPlayers();
    const value = Reflect.get(catalog, property, catalog);
    return typeof value === "function" ? value.bind(catalog) : value;
  },
}) as readonly Player[];
