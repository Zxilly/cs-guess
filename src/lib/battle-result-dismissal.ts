const STORAGE_PREFIX = "cs-guess:battle-result-viewed:";

export interface BattleResultIdentity {
  roomCode: string;
  roundNumber: number;
  winnerPlayerId?: string;
  seriesWinnerPlayerId?: string;
  finishReason?: string;
  mysteryId?: string;
}

export function battleResultIdentityKey(result: BattleResultIdentity) {
  return [
    STORAGE_PREFIX,
    encodeURIComponent(result.roomCode),
    result.roundNumber,
    result.winnerPlayerId ?? "draw",
    result.seriesWinnerPlayerId ?? "ongoing",
    result.finishReason ?? "legacy",
    result.mysteryId ?? "unknown",
  ].join(":");
}

export function wasBattleResultViewed(result: BattleResultIdentity) {
  try {
    return sessionStorage.getItem(battleResultIdentityKey(result)) === "1";
  } catch {
    return false;
  }
}

export function markBattleResultViewed(result: BattleResultIdentity) {
  try {
    sessionStorage.setItem(battleResultIdentityKey(result), "1");
  } catch {
    // Storage can be unavailable in privacy-restricted contexts. The caller's
    // in-memory state still prevents the dialog from reopening this render.
  }
}
