import type { Player } from "@/data/players";
import type { AnonymousProfile } from "@/hooks/use-anonymous-profile";
import {
  displayTeamName,
  UNATTACHED_TEAM_LABEL,
} from "@/lib/player-display";
import type { ServerProfile } from "@/lib/profile-api";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export interface ServerDailyChallenge {
  date: string;
  roundNumber: number;
  mysteryPlayerId: string;
  mysteryPlayer: Player;
  catalogVersion: string;
  deadlineUnixMs?: number;
}

export async function loadCurrentDailyChallenge(
  signal?: AbortSignal,
  profile?: Pick<AnonymousProfile, "anonymousId" | "syncToken">,
): Promise<ServerDailyChallenge> {
  const response = await fetch(
    `${API_BASE}/v1/daily-challenges/current${profile ? "/attempts" : ""}`,
    {
      method: profile ? "POST" : "GET",
      headers: profile
        ? {
            "Content-Type": "application/json",
            "X-Profile-Token": profile.syncToken,
          }
        : undefined,
      body: profile
        ? JSON.stringify({ anonymousId: profile.anonymousId })
        : undefined,
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`daily challenge load failed: ${response.status}`);
  }
  const challenge = (await response.json()) as ServerDailyChallenge;
  const team = displayTeamName(challenge.mysteryPlayer.team);
  const mysteryPlayer = {
    ...challenge.mysteryPlayer,
    team,
  };
  if (team === UNATTACHED_TEAM_LABEL) {
    delete mysteryPlayer.teamLogoUrl;
  }
  return {
    ...challenge,
    mysteryPlayer,
  };
}

export async function completeDailyChallenge(
  profile: Pick<AnonymousProfile, "anonymousId" | "syncToken">,
  guessIds: readonly string[],
  timedOut: boolean,
): Promise<ServerProfile> {
  const response = await fetch(
    `${API_BASE}/v1/daily-challenges/current/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Profile-Token": profile.syncToken,
      },
      body: JSON.stringify({
        anonymousId: profile.anonymousId,
        guessIds,
        timedOut,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`daily challenge completion failed: ${response.status}`);
  }
  return (await response.json()) as ServerProfile;
}
