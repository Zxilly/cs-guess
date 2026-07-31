import type { Player } from "@/data/players";
import type { AnonymousProfile } from "@/hooks/use-anonymous-profile";
import { API_BASE } from "@/lib/api-routing";
import { displayTeamName, isUnattachedTeam } from "@/lib/player-display";
import type { ServerProfileCompletion } from "@/lib/profile-api";

export interface ServerDailyChallenge {
  date: string;
  roundNumber: number;
  mysteryPlayer: Player;
  deadlineUnixMs: number;
}

export type ServerDailyChallengeMetadata = Pick<
  ServerDailyChallenge,
  "date" | "roundNumber"
>;

export async function loadCurrentDailyChallengeMetadata(
  signal?: AbortSignal,
): Promise<ServerDailyChallengeMetadata> {
  const response = await fetch(`${API_BASE}/v1/daily-challenges/current`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`daily challenge metadata load failed: ${response.status}`);
  }
  return (await response.json()) as ServerDailyChallengeMetadata;
}

export async function startCurrentDailyChallenge(
  profile: Pick<AnonymousProfile, "anonymousId" | "syncToken">,
  signal?: AbortSignal,
): Promise<ServerDailyChallenge> {
  const response = await fetch(
    `${API_BASE}/v1/daily-challenges/current/attempts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Profile-Token": profile.syncToken,
      },
      body: JSON.stringify({ anonymousId: profile.anonymousId }),
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
): Promise<ServerProfileCompletion> {
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
  return (await response.json()) as ServerProfileCompletion;
}
