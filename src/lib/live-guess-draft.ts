const LIVE_GUESS_DRAFT_PREFIX = "cs-guess:live-guess-draft:";
const MAX_QUERY_LENGTH = 160;
const MAX_PLAYER_ID_LENGTH = 120;

export interface LiveGuessDraft {
  query: string;
  selectedId?: string;
}

function normalizedRoomCode(roomCode: string) {
  return /^CS-\d{6}$/.test(roomCode) ? roomCode : null;
}

export function liveGuessDraftKey(roomCode: string, roundNumber: number) {
  const room = normalizedRoomCode(roomCode);
  if (
    !room ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1
  ) {
    return null;
  }
  return `${LIVE_GUESS_DRAFT_PREFIX}${room}:round:${roundNumber}`;
}

export function loadLiveGuessDraft(
  roomCode: string,
  roundNumber: number,
): LiveGuessDraft {
  const key = liveGuessDraftKey(roomCode, roundNumber);
  if (!key) return { query: "" };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { query: "" };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const query =
      typeof parsed.query === "string"
        ? parsed.query.slice(0, MAX_QUERY_LENGTH)
        : "";
    const selectedId =
      typeof parsed.selectedId === "string" &&
      parsed.selectedId.length > 0 &&
      parsed.selectedId.length <= MAX_PLAYER_ID_LENGTH
        ? parsed.selectedId
        : undefined;
    return { query, selectedId };
  } catch {
    sessionStorage.removeItem(key);
    return { query: "" };
  }
}

export function saveLiveGuessDraft(
  roomCode: string,
  roundNumber: number,
  draft: LiveGuessDraft,
) {
  const key = liveGuessDraftKey(roomCode, roundNumber);
  if (!key) return;
  const query = draft.query.slice(0, MAX_QUERY_LENGTH);
  const selectedId =
    draft.selectedId &&
    draft.selectedId.length <= MAX_PLAYER_ID_LENGTH
      ? draft.selectedId
      : undefined;
  if (!query && !selectedId) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, JSON.stringify({ query, selectedId }));
}

export function clearLiveGuessDraft(
  roomCode: string,
  roundNumber: number,
) {
  const key = liveGuessDraftKey(roomCode, roundNumber);
  if (key) sessionStorage.removeItem(key);
}

export function clearLiveGuessDraftsForRoom(roomCode: string) {
  const room = normalizedRoomCode(roomCode);
  if (!room) return;
  const prefix = `${LIVE_GUESS_DRAFT_PREFIX}${room}:round:`;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  }
}
