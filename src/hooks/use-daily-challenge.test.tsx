/** @vitest-environment jsdom */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDailyChallenge } from "@/hooks/use-daily-challenge";

const profileMocks = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  profile: {
    anonymousId: "anonymous-daily-cache-test",
    syncToken: "profile_sync_token_abcdefghijklmnopqrstuvwxyz",
  },
}));
const dailyMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  ensureAnonymousProfileReady: profileMocks.ensureReady,
  useAnonymousProfile: () => ({ profile: profileMocks.profile }),
}));

vi.mock("@/lib/daily-challenge-api", () => ({
  loadCurrentDailyChallenge: dailyMocks.load,
}));

let container: HTMLDivElement;
let root: Root;

function DailyProbe({ label }: { label: string }) {
  const { challenge } = useDailyChallenge();
  return (
    <output data-label={label}>
      {challenge?.date ?? "loading"}
    </output>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  profileMocks.ensureReady.mockReset().mockResolvedValue(undefined);
  dailyMocks.load.mockReset().mockResolvedValue({
    date: "2026-07-30",
    roundNumber: 211,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useDailyChallenge request cache", () => {
  it("shares one attempt request across consumers and StrictMode remounts", async () => {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <StrictMode>
            <DailyProbe label="first" />
            <DailyProbe label="second" />
          </StrictMode>
        </SWRConfig>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(profileMocks.ensureReady).toHaveBeenCalledTimes(1);
    expect(dailyMocks.load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("2026-07-302026-07-30");
  });
});
