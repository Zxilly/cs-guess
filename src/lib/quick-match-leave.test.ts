/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  leaveQuickMatch,
  type RealtimeCredentials,
} from "@/lib/realtime";

const ticket: RealtimeCredentials = {
  roomCode: "CS-123456",
  playerId: "player",
  sessionToken: "token",
  socketIoUrl: "/socket.io",
  mode: "quick",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("quick room leave", () => {
  it("starts an exact keepalive leave request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await leaveQuickMatch(ticket);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/matches/quick/CS-123456");
    expect(url.searchParams.get("session_token")).toBe("token");
    expect(init).toMatchObject({ method: "DELETE", keepalive: true });
  });

  it("bounds a stalled leave without depending on component lifetime", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );

    const result = leaveQuickMatch(ticket);
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
