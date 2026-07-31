import type { Player } from "@/data/players";
import type { AnonymousProfile } from "@/hooks/use-anonymous-profile";
import { API_BASE } from "@/lib/api-routing";
import { displayTeamName, isUnattachedTeam } from "@/lib/player-display";
import type { ServerProfile } from "@/lib/profile-api";
import type { SoloDifficulty } from "@/lib/solo-game";

type ProfileCredentials = Pick<
  AnonymousProfile,
  "anonymousId" | "syncToken"
>;

export interface ServerSoloRound {
  roundId: string;
  roundNumber: number;
  difficulty: SoloDifficulty;
  mysteryPlayer: Player;
  deadlineUnixMs: number;
  maxGuesses: number;
}

function profileHeaders(profile: ProfileCredentials, json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-Profile-Token": profile.syncToken,
  };
}

function normalizeRound(round: ServerSoloRound): ServerSoloRound {
  const rawTeam = round.mysteryPlayer.team;
  const team = displayTeamName(rawTeam);
  const mysteryPlayer = { ...round.mysteryPlayer, team };
  if (isUnattachedTeam(rawTeam)) delete mysteryPlayer.teamLogoUrl;
  return { ...round, mysteryPlayer };
}

export async function createServerSoloRound(
  profile: ProfileCredentials,
  difficulty: SoloDifficulty,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/v1/solo-rounds`, {
    method: "POST",
    headers: profileHeaders(profile, true),
    body: JSON.stringify({
      anonymousId: profile.anonymousId,
      difficulty,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`solo round creation failed: ${response.status}`);
  }
  return normalizeRound((await response.json()) as ServerSoloRound);
}

export async function loadServerSoloRound(
  profile: ProfileCredentials,
  roundId: string,
  signal?: AbortSignal,
): Promise<ServerSoloRound | null> {
  const query = new URLSearchParams({ anonymousId: profile.anonymousId });
  const response = await fetch(
    `${API_BASE}/v1/solo-rounds/${encodeURIComponent(roundId)}?${query}`,
    {
      headers: profileHeaders(profile),
      signal,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`solo round load failed: ${response.status}`);
  }
  return normalizeRound((await response.json()) as ServerSoloRound);
}

export async function completeServerSoloRound(
  profile: ProfileCredentials,
  roundId: string,
  guessIds: readonly string[],
  timedOut: boolean,
): Promise<ServerProfile> {
  const response = await fetch(
    `${API_BASE}/v1/solo-rounds/${encodeURIComponent(roundId)}/completions`,
    {
      method: "POST",
      headers: profileHeaders(profile, true),
      body: JSON.stringify({
        anonymousId: profile.anonymousId,
        guessIds,
        timedOut,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`solo round completion failed: ${response.status}`);
  }
  return (await response.json()) as ServerProfile;
}
