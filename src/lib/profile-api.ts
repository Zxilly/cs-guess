import type {
  AnonymousProfile,
  IdentityPoolId,
  MatchHistoryEntry,
} from "@/hooks/use-anonymous-profile";
import { API_BASE } from "@/lib/api-routing";

export type ServerProfile = Omit<AnonymousProfile, "syncToken">;
export type ServerProfileSummary = Omit<
  ServerProfile,
  "recordedRounds" | "matchHistory"
>;

export interface ServerProfileCompletion {
  profile: ServerProfileSummary;
  historyEntry?: MatchHistoryEntry;
}

interface ServerProfileHistoryPage {
  items: MatchHistoryEntry[];
  nextCursor?: string;
}

type ProfileCredentials = Pick<AnonymousProfile, "anonymousId" | "syncToken">;

async function readProfileSummary(response: Response, operation: string) {
  if (!response.ok) {
    throw new Error(`${operation} failed: ${response.status}`);
  }
  return (await response.json()) as ServerProfileSummary;
}

function profileUrl(anonymousId: string, suffix = "") {
  return `${API_BASE}/v1/profiles/${encodeURIComponent(anonymousId)}${suffix}`;
}

function profileHeaders(syncToken: string, json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-Profile-Token": syncToken,
  };
}

export async function loadServerProfile(
  anonymousId: string,
  syncToken: string,
  signal?: AbortSignal,
): Promise<ServerProfile | null> {
  const response = await fetch(profileUrl(anonymousId), {
    headers: profileHeaders(syncToken),
    signal,
  });
  if (response.status === 404) return null;
  const summary = await readProfileSummary(response, "profile load");
  const history = await loadServerProfileHistory(anonymousId, syncToken, signal);
  return profileFromSummary(summary, history);
}

async function loadServerProfileHistory(
  anonymousId: string,
  syncToken: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: "50" });
  const response = await fetch(
    `${profileUrl(anonymousId, "/history")}?${query}`,
    { headers: profileHeaders(syncToken), signal },
  );
  if (!response.ok) {
    throw new Error(`profile history load failed: ${response.status}`);
  }
  const page = (await response.json()) as ServerProfileHistoryPage;
  return [...page.items].reverse();
}

function profileFromSummary(
  summary: ServerProfileSummary,
  matchHistory: MatchHistoryEntry[],
): ServerProfile {
  return {
    ...summary,
    recordedRounds: matchHistory.map((entry) => entry.id),
    matchHistory,
  };
}

export function mergeServerProfileSummary(
  local: AnonymousProfile,
  summary: ServerProfileSummary,
): ServerProfile {
  return {
    ...summary,
    recordedRounds: local.recordedRounds,
    matchHistory: local.matchHistory,
  };
}

export function mergeServerProfileCompletion(
  local: AnonymousProfile,
  completion: ServerProfileCompletion,
): ServerProfile {
  const historyEntry = completion.historyEntry;
  const matchHistory = historyEntry
    ? [
        ...local.matchHistory.filter((entry) => entry.id !== historyEntry.id),
        historyEntry,
      ].slice(-50)
    : local.matchHistory;
  const recordedRounds = historyEntry
    ? [
        ...local.recordedRounds.filter((roundId) => roundId !== historyEntry.id),
        historyEntry.id,
      ].slice(-100)
    : local.recordedRounds;
  return {
    ...completion.profile,
    recordedRounds,
    matchHistory,
  };
}

export async function createServerProfile(
  profile: AnonymousProfile,
  initialPlayerId = profile.playerId,
): Promise<ServerProfile> {
  const response = await fetch(`${API_BASE}/v1/profiles`, {
    method: "POST",
    headers: profileHeaders(profile.syncToken, true),
    body: JSON.stringify({
      anonymousId: profile.anonymousId,
      initialPlayerId,
    }),
  });
  const summary = await readProfileSummary(response, "profile creation");
  const history = response.status === 200
    ? await loadServerProfileHistory(
        profile.anonymousId,
        profile.syncToken,
      )
    : [];
  return profileFromSummary(summary, history);
}

export async function startServerIdentityDraw(
  profile: ProfileCredentials,
  poolId: IdentityPoolId,
  requestId: string,
  replacedWinnerId?: string,
): Promise<ServerProfileSummary> {
  const response = await fetch(profileUrl(profile.anonymousId, "/identity-draws"), {
    method: "POST",
    headers: profileHeaders(profile.syncToken, true),
    body: JSON.stringify({ requestId, poolId, replacedWinnerId }),
  });
  return readProfileSummary(response, "identity draw");
}

export async function adoptServerIdentityDraw(
  profile: ProfileCredentials,
  winnerId: string,
): Promise<ServerProfileSummary> {
  const response = await fetch(
    profileUrl(
      profile.anonymousId,
      `/identity-draws/${encodeURIComponent(winnerId)}/adopt`,
    ),
    {
      method: "POST",
      headers: profileHeaders(profile.syncToken),
    },
  );
  return readProfileSummary(response, "identity adoption");
}

export async function discardServerIdentityDraw(
  profile: ProfileCredentials,
  winnerId: string,
): Promise<ServerProfileSummary> {
  const response = await fetch(
    profileUrl(
      profile.anonymousId,
      `/identity-draws/${encodeURIComponent(winnerId)}`,
    ),
    {
      method: "DELETE",
      headers: profileHeaders(profile.syncToken),
    },
  );
  return readProfileSummary(response, "identity draw discard");
}
