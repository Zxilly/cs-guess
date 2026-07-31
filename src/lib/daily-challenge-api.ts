import type { Player } from "@/data/players";
import type { AnonymousProfile } from "@/hooks/use-anonymous-profile";
import { API_BASE } from "@/lib/api-routing";
import { displayTeamName, isUnattachedTeam } from "@/lib/player-display";
import type { ServerProfile } from "@/lib/profile-api";

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
  const rawTeam = challenge.mysteryPlayer.team;
  const team = displayTeamName(rawTeam);
  const mysteryPlayer = {
    ...challenge.mysteryPlayer,
    team,
  };
  if (isUnattachedTeam(rawTeam)) {
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
