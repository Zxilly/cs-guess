export type AudibleBattleOutcome = "win" | "loss";

const SOUND_ENABLED_KEY = "cs-guess:sound-enabled";
const LEGACY_SOUND_ENABLED_KEY = "cs-guess:battle-result-sound";
const SOUND_URLS: Record<AudibleBattleOutcome, string> = {
  win: "/audio/battle-headshot-win.mp3",
  loss: "/audio/battle-headshot-loss.mp3",
};
const SOUND_VOLUMES: Record<AudibleBattleOutcome, number> = {
  win: 0.28,
  loss: 0.22,
};
const BOMB_COUNTDOWN_URL = "/audio/bomb-ten-second-countdown.mp3";
const BOMB_COUNTDOWN_VOLUME = 0.14;

export const bombCountdownWindowSeconds = 10;

let preloaded = false;
const preloadedAudio: HTMLAudioElement[] = [];

interface SoundPreloadTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    if (typeof globalThis.localStorage === "undefined") return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadAppSoundEnabled(
  storage = localStorageOrUndefined(),
) {
  try {
    const persisted = storage?.getItem(SOUND_ENABLED_KEY);
    if (persisted !== null && persisted !== undefined) {
      return persisted !== "0";
    }
    return storage?.getItem(LEGACY_SOUND_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAppSoundEnabled(
  enabled: boolean,
  storage = localStorageOrUndefined(),
) {
  try {
    storage?.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0");
    storage?.removeItem(LEGACY_SOUND_ENABLED_KEY);
  } catch {
    // A blocked storage backend must not prevent the match from continuing.
  }
}

export function preloadAppSounds() {
  if (preloaded || typeof Audio === "undefined") return;
  preloaded = true;

  for (const url of [
    ...Object.values(SOUND_URLS),
    BOMB_COUNTDOWN_URL,
  ]) {
    const audio = new Audio(url);
    audio.preload = "auto";
    preloadedAudio.push(audio);
  }
}

export function installAppSoundPreloadOnFirstInteraction(
  target: SoundPreloadTarget = window,
) {
  const preload = () => {
    cleanup();
    preloadAppSounds();
  };
  const cleanup = () => {
    target.removeEventListener("pointerdown", preload, true);
    target.removeEventListener("keydown", preload, true);
  };

  target.addEventListener("pointerdown", preload, {
    capture: true,
    passive: true,
  });
  target.addEventListener("keydown", preload, { capture: true });

  return cleanup;
}

export function playBattleResultSound(outcome: AudibleBattleOutcome) {
  if (typeof Audio === "undefined") return () => {};

  const audio = new Audio(SOUND_URLS[outcome]);
  audio.preload = "auto";
  audio.volume = SOUND_VOLUMES[outcome];
  void audio.play().catch(() => {
    // Browsers may block playback until the user interacts with the page.
  });

  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}

export function playBombCountdownSound(secondsLeft: number) {
  if (typeof Audio === "undefined") return () => {};

  const audio = new Audio(BOMB_COUNTDOWN_URL);
  const offsetSeconds = Math.max(
    0,
    bombCountdownWindowSeconds - secondsLeft,
  );
  let stopped = false;

  audio.preload = "auto";
  audio.volume = BOMB_COUNTDOWN_VOLUME;

  const start = () => {
    if (stopped) return;
    try {
      audio.currentTime = offsetSeconds;
    } catch {
      // Some browsers only allow seeking after metadata is available.
    }
    void audio.play().catch(() => {
      // Browsers may block playback until the user interacts with the page.
    });
  };

  if (audio.readyState >= 1) {
    start();
  } else {
    audio.addEventListener("loadedmetadata", start, { once: true });
    audio.load();
  }

  return () => {
    stopped = true;
    audio.removeEventListener("loadedmetadata", start);
    audio.pause();
    audio.currentTime = 0;
  };
}

export const appSoundPreferenceKey = SOUND_ENABLED_KEY;
export const legacyAppSoundPreferenceKey = LEGACY_SOUND_ENABLED_KEY;
