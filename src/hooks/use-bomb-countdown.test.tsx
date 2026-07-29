/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBombCountdown } from "@/hooks/use-bomb-countdown";
import { useSoundStore } from "@/stores/sound-store";

interface AudioInstance {
  src: string;
  currentTime: number;
  volume: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

let container: HTMLDivElement;
let root: Root;
let instances: AudioInstance[];

function Probe({
  active = true,
  deadline,
}: {
  active?: boolean;
  deadline: number;
}) {
  useBombCountdown({ active, deadline });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  instances = [];
  vi.stubGlobal(
    "Audio",
    class implements AudioInstance {
      src: string;
      preload = "";
      volume = 1;
      currentTime = 0;
      readyState = 1;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();

      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }
    },
  );
  useSoundStore.setState({ enabled: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useBombCountdown", () => {
  it("starts exactly at the final ten seconds and stops when muted", () => {
    const deadline = Date.now() + 15_000;

    act(() => root.render(<Probe deadline={deadline} />));
    expect(instances).toHaveLength(0);

    act(() => vi.advanceTimersByTime(4_999));
    expect(instances).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1));
    expect(instances).toHaveLength(1);
    expect(instances[0]?.src).toBe(
      "/audio/bomb-ten-second-countdown.mp3",
    );
    expect(instances[0]?.play).toHaveBeenCalledOnce();

    act(() => useSoundStore.getState().setEnabled(false));
    expect(instances[0]?.pause).toHaveBeenCalledOnce();
  });

  it("seeks into the countdown when sound is enabled late", () => {
    const deadline = Date.now() + 7_000;

    act(() => root.render(<Probe deadline={deadline} />));
    act(() => vi.advanceTimersByTime(0));

    expect(instances).toHaveLength(1);
    expect(instances[0]?.currentTime).toBe(3);
  });
});
