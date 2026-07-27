import type { AnonymousProfile } from "@/hooks/use-anonymous-profile";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

type ServerProfile = Omit<AnonymousProfile, "syncToken">;

export async function loadServerProfile(
  anonymousId: string,
  syncToken: string,
  signal?: AbortSignal,
): Promise<ServerProfile | null> {
  const response = await fetch(
    `${API_BASE}/v1/profiles/${encodeURIComponent(anonymousId)}`,
    {
      headers: { "X-Profile-Token": syncToken },
      signal,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`profile load failed: ${response.status}`);
  return (await response.json()) as ServerProfile;
}

export async function saveServerProfile(
  profile: AnonymousProfile,
): Promise<ServerProfile> {
  const { syncToken, ...payload } = profile;
  const response = await fetch(
    `${API_BASE}/v1/profiles/${encodeURIComponent(profile.anonymousId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Profile-Token": syncToken,
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`profile save failed: ${response.status}`);
  return (await response.json()) as ServerProfile;
}
