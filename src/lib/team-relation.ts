import type { Player } from "@/data/players";
import { isUnattachedTeam } from "@/lib/player-display";
import type { TeamRelation } from "@/types/game";

function normalizeTeamName(team: string) {
  const normalized = team.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return isUnattachedTeam(normalized) ? null : normalized;
}

function normalizedTeams(teams: readonly string[]) {
  return teams
    .map(normalizeTeamName)
    .filter((team): team is string => team !== null);
}

export function compareTeams(
  guess: Player,
  target: Player,
): TeamRelation {
  if (guess.team === target.team) return "match";

  const guessCurrent = normalizeTeamName(guess.team);
  const targetCurrent = normalizeTeamName(target.team);
  const guessHistory = new Set(
    normalizedTeams(guess.historicalTeams ?? []),
  );
  const targetHistory = new Set(
    normalizedTeams(target.historicalTeams ?? []),
  );

  if (guessCurrent && targetHistory.has(guessCurrent)) {
    return "target_history";
  }
  if (targetCurrent && guessHistory.has(targetCurrent)) {
    return "guess_history";
  }
  if ([...guessHistory].some((team) => targetHistory.has(team))) {
    return "shared_history";
  }
  return "miss";
}
