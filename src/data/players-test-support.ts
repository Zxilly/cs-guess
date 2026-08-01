import generatedPlayers from "./players.generated.json";

import type { Player } from "@/data/player-types";

export {
  playerRoleNameZh,
  type Player,
  type PlayerRole,
} from "@/data/player-types";

export const players = generatedPlayers as readonly Player[];

export function loadPlayers() {
  return Promise.resolve(players);
}

export function readPlayers() {
  return players;
}

export function usePlayers() {
  return players;
}
