import type { Player } from "@/data/players";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export interface ServerDailyChallenge {
  date: string;
  roundNumber: number;
  mysteryPlayerId: string;
  mysteryPlayer: Player;
  catalogVersion: string;
}

export async function loadCurrentDailyChallenge(
  signal?: AbortSignal,
): Promise<ServerDailyChallenge> {
  const response = await fetch(`${API_BASE}/v1/daily-challenges/current`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`daily challenge load failed: ${response.status}`);
  }
  return (await response.json()) as ServerDailyChallenge;
}
