import { useEffect } from "react";

import {
  appSoundPreferenceKey,
  legacyAppSoundPreferenceKey,
  preloadAppSounds,
} from "@/lib/app-sound";
import { useSoundStore } from "@/stores/sound-store";

export function GlobalSoundManager() {
  const syncFromStorage = useSoundStore(
    (state) => state.syncFromStorage,
  );

  useEffect(() => {
    preloadAppSounds();
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === appSoundPreferenceKey ||
        event.key === legacyAppSoundPreferenceKey
      ) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [syncFromStorage]);

  return null;
}
