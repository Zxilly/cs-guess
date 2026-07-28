export const UNATTACHED_TEAM_LABEL = "无队伍";

const INVALID_TEAM_NAMES = new Set(["", "undefined", "null", "none", "n/a"]);

export function displayTeamName(value: unknown): string {
  if (typeof value !== "string") return UNATTACHED_TEAM_LABEL;
  const withoutDisambiguation = value
    .trim()
    .replace(/\s+\([^()]*\bteam\)$/i, "")
    .trim();
  return INVALID_TEAM_NAMES.has(withoutDisambiguation.toLowerCase())
    ? UNATTACHED_TEAM_LABEL
    : withoutDisambiguation;
}
