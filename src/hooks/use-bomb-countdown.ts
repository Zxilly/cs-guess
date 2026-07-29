import { useEffect } from "react";

import {
  bombCountdownWindowSeconds,
  playBombCountdownSound,
} from "@/lib/app-sound";
import { useSoundStore } from "@/stores/sound-store";

interface BombCountdownOptions {
  active: boolean;
  deadline: number | null | undefined;
}

export function useBombCountdown({
  active,
  deadline,
}: BombCountdownOptions) {
  const soundEnabled = useSoundStore((state) => state.enabled);

  useEffect(() => {
    if (!active || !deadline || !soundEnabled) return;

    let stopSound: (() => void) | undefined;
    const startAt = deadline - bombCountdownWindowSeconds * 1_000;
    const startCountdown = () => {
      const secondsLeft = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1_000),
      );
      if (
        secondsLeft <= 0 ||
        secondsLeft > bombCountdownWindowSeconds
      ) {
        return;
      }
      stopSound = playBombCountdownSound(secondsLeft);
    };
    const delay = Math.max(0, startAt - Date.now());
    const timer = window.setTimeout(startCountdown, delay);

    return () => {
      window.clearTimeout(timer);
      stopSound?.();
    };
  }, [active, deadline, soundEnabled]);
}
