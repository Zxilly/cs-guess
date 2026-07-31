type GameMode = "daily" | "solo" | "quick" | "room";
type Difficulty = "easy" | "full" | "hard";
type Visibility = "hidden" | "open";

export interface AnalyticsEventMap {
  "mode-selected": {
    mode: "daily" | "solo" | "quick-duel" | "quick-group" | "room";
  };
  "practice-started": {
    difficulty: Difficulty;
  };
  "guess-submitted": {
    attempt: number;
    mode: GameMode;
  };
  "matchmaking-started": {
    bestOf: 1 | 3 | 5;
    difficulty: Difficulty;
    partySize: 2 | 4;
    visibility: Visibility;
  };
  "matchmaking-cancelled": {
    partySize: 2 | 4;
  };
  "room-join-requested": {
    source: "room-entry";
  };
  "room-create-requested": {
    bestOf: 1 | 3 | 5;
    difficulty: Difficulty;
    partySize: 2 | 4;
    visibility: Visibility;
  };
  "room-code-copied": {
    success: boolean;
  };
  "round-start-requested": {
    mode: "room";
  };
  "series-restarted": {
    mode: "room";
  };
  "series-exited": {
    mode: "quick" | "room";
  };
  "rematch-requested": {
    mode: "quick";
  };
  "rematch-responded": {
    accepted: boolean;
    mode: "quick";
  };
  "rematch-cancelled": {
    mode: "quick";
  };
  "sound-toggled": {
    enabled: boolean;
  };
  "stats-replay-opened": {
    mode: string;
    result: string;
  };
}

interface UmamiTracker {
  track(eventName: string, data?: object): void;
}

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

export function trackEvent<Name extends keyof AnalyticsEventMap>(
  name: Name,
  data: AnalyticsEventMap[Name],
) {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never interrupt gameplay.
  }
}
