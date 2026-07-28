export const PROFILE_KEY = "cs-guess:anonymous-profile";
export const PROFILE_VERSION = 8;

export function hasConfirmedIdentity(): boolean {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as {
      version?: number;
      anonymousId?: unknown;
      playerId?: unknown;
      identityConfirmed?: unknown;
    };
    const validLegacyProfile =
      stored.version === 4 || stored.version === 5;
    const validVersionSixProfile =
      stored.version === 6 && stored.identityConfirmed === true;
    const validCurrentProfile =
      (stored.version === 7 || stored.version === PROFILE_VERSION) &&
      stored.identityConfirmed === true;
    return (
      (validLegacyProfile ||
        validVersionSixProfile ||
        validCurrentProfile) &&
      typeof stored.anonymousId === "string" &&
      typeof stored.playerId === "string"
    );
  } catch {
    return false;
  }
}
