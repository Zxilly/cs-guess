import { create } from "zustand";

import {
  loadAppSoundEnabled,
  saveAppSoundEnabled,
} from "@/lib/app-sound";

interface SoundState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  syncFromStorage: () => void;
}

export const useSoundStore = create<SoundState>()((set, get) => ({
  enabled: loadAppSoundEnabled(),
  setEnabled: (enabled) => {
    saveAppSoundEnabled(enabled);
    set({ enabled });
  },
  toggle: () => {
    const enabled = !get().enabled;
    saveAppSoundEnabled(enabled);
    set({ enabled });
  },
  syncFromStorage: () => set({ enabled: loadAppSoundEnabled() }),
}));
