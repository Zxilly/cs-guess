import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appSoundPreferenceKey,
  legacyAppSoundPreferenceKey,
  loadAppSoundEnabled,
  playBattleResultSound,
  playBombCountdownSound,
  saveAppSoundEnabled,
} from "@/lib/app-sound";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("app sound", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to enabled and persists the global mute preference", () => {
    const storage = new MemoryStorage();

    expect(loadAppSoundEnabled(storage)).toBe(true);
    saveAppSoundEnabled(false, storage);

    expect(storage.getItem(appSoundPreferenceKey)).toBe("0");
    expect(loadAppSoundEnabled(storage)).toBe(false);
  });

  it("migrates the previous battle-only mute preference", () => {
    const storage = new MemoryStorage();
    storage.setItem(legacyAppSoundPreferenceKey, "0");

    expect(loadAppSoundEnabled(storage)).toBe(false);
    saveAppSoundEnabled(true, storage);

    expect(storage.getItem(legacyAppSoundPreferenceKey)).toBeNull();
    expect(storage.getItem(appSoundPreferenceKey)).toBe("1");
  });

  it("plays each outcome once at its bounded volume and returns cleanup", async () => {
    const instances: Array<{
      src: string;
      volume: number;
      currentTime: number;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    }> = [];

    vi.stubGlobal(
      "Audio",
      class {
        src: string;
        preload = "";
        volume = 1;
        currentTime = 0;
        play = vi.fn().mockResolvedValue(undefined);
        pause = vi.fn();

        constructor(src: string) {
          this.src = src;
          instances.push(this);
        }
      },
    );

    const stop = playBattleResultSound("loss");
    await Promise.resolve();

    expect(instances).toHaveLength(1);
    expect(instances[0]?.src).toBe("/audio/battle-headshot-loss.mp3");
    expect(instances[0]?.volume).toBeLessThanOrEqual(0.4);
    expect(instances[0]?.play).toHaveBeenCalledOnce();

    stop();
    expect(instances[0]?.pause).toHaveBeenCalledOnce();
    expect(instances[0]?.currentTime).toBe(0);
  });

  it("starts the bomb countdown at the matching ten-second offset", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const removeEventListener = vi.fn();
    const load = vi.fn();

    vi.stubGlobal(
      "Audio",
      class {
        preload = "";
        volume = 1;
        currentTime = 0;
        readyState = 1;
        play = play;
        pause = pause;
        load = load;
        addEventListener = vi.fn();
        removeEventListener = removeEventListener;
      },
    );

    const stop = playBombCountdownSound(7);
    await Promise.resolve();

    expect(play).toHaveBeenCalledOnce();
    const audio = (play.mock.contexts[0] ?? {}) as HTMLAudioElement;
    expect(audio.currentTime).toBe(3);
    expect(audio.volume).toBeLessThanOrEqual(0.15);

    stop();
    expect(pause).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
});
