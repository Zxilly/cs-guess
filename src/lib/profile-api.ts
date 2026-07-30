import type {
  AnonymousProfile,
  IdentityPoolId,
} from "@/hooks/use-anonymous-profile";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type ServerProfile = Omit<AnonymousProfile, "syncToken">;

type ProfileCredentials = Pick<AnonymousProfile, "anonymousId" | "syncToken">;

async function readProfileResponse(response: Response, operation: string) {
  if (!response.ok) {
    throw new Error(`${operation} failed: ${response.status}`);
  }
  return (await response.json()) as ServerProfile;
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
  return readProfileResponse(response, "profile load");
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
  return readProfileResponse(response, "profile creation");
}

export async function startServerIdentityDraw(
  profile: ProfileCredentials,
  poolId: IdentityPoolId,
  requestId: string,
  replacedWinnerId?: string,
): Promise<ServerProfile> {
  const response = await fetch(profileUrl(profile.anonymousId, "/identity-draws"), {
    method: "POST",
    headers: profileHeaders(profile.syncToken, true),
    body: JSON.stringify({ requestId, poolId, replacedWinnerId }),
  });
  return readProfileResponse(response, "identity draw");
}

export async function adoptServerIdentityDraw(
  profile: ProfileCredentials,
  winnerId: string,
): Promise<ServerProfile> {
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
  return readProfileResponse(response, "identity adoption");
}

export async function discardServerIdentityDraw(
  profile: ProfileCredentials,
  winnerId: string,
): Promise<ServerProfile> {
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
  return readProfileResponse(response, "identity draw discard");
}
