import { t } from "@lingui/core/macro";

const UNATTACHED_TEAM_VALUES = new Set([
  "",
  "无队伍",
  "no team",
  "undefined",
  "null",
  "none",
  "n/a",
]);

function normalizeTeamValue(value: string) {
  return value
    .trim()
    .replace(/\s+\([^()]*\bteam\)$/i, "")
    .trim();
}

export function isUnattachedTeam(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return UNATTACHED_TEAM_VALUES.has(normalizeTeamValue(value).toLowerCase());
}

export function displayTeamName(value: unknown): string {
  if (typeof value !== "string") return t`无队伍`;
  const normalized = normalizeTeamValue(value);
  return isUnattachedTeam(normalized) ? t`无队伍` : normalized;
}
