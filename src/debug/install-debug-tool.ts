import type {
  AnonymousProfile,
  AnonymousProfilePatch,
} from "@/hooks/use-anonymous-profile";
import {
  debugPatchAnonymousProfile,
  getAnonymousProfileSnapshot,
} from "@/hooks/use-anonymous-profile";
import type {
  MatchmakingQueueCounts,
  ServerEvent,
} from "@/lib/realtime";
import {
  type RealtimeDebugOverride,
  useDebugStore,
} from "@/stores/debug-store";

interface DebugStatePatch {
  profile?: AnonymousProfilePatch;
  queue?: {
    counts: MatchmakingQueueCounts;
    live?: boolean;
  } | null;
  realtime?: RealtimeDebugOverride | null;
}

interface CsGuessDebugTool {
  help: () => string[];
  getState: () => {
    profile: AnonymousProfile;
    queue: {
      counts: MatchmakingQueueCounts | null;
      live: boolean | null;
    };
    realtime: RealtimeDebugOverride | null;
  };
  setState: (patch: DebugStatePatch) => void;
  setProfile: (patch: AnonymousProfilePatch) => void;
  setQueue: (
    counts: MatchmakingQueueCounts | null,
    live?: boolean,
  ) => void;
  setRealtime: (override: RealtimeDebugOverride | null) => void;
  setGamePhase: (
    phase: "waiting" | "playing" | "finished",
    snapshot?: Record<string, unknown>,
    events?: ServerEvent[],
  ) => void;
  reset: () => void;
}

declare global {
  interface Window {
    csGuessDebug?: CsGuessDebugTool;
  }
}

const HELP = [
  "csGuessDebug.getState()",
  "csGuessDebug.setProfile({ drawCredits: 5 })",
  "csGuessDebug.setQueue(counts, true)",
  "csGuessDebug.setGamePhase('finished', { mystery_id: 'donk' })",
  "csGuessDebug.setRealtime({ connection: 'offline', error: '模拟断线' })",
  "csGuessDebug.reset()",
];

export function installDebugTool() {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.csGuessDebug = {
    help: () => HELP,
    getState: () => {
      const debug = useDebugStore.getState();
      return {
        profile: getAnonymousProfileSnapshot(),
        queue: {
          counts: debug.queueCounts,
          live: debug.queueLive,
        },
        realtime: debug.realtime,
      };
    },
    setState: (patch) => {
      if (patch.profile) debugPatchAnonymousProfile(patch.profile);
      if (patch.queue === null) {
        useDebugStore.getState().setQueue(null);
      } else if (patch.queue) {
        useDebugStore
          .getState()
          .setQueue(patch.queue.counts, patch.queue.live ?? true);
      }
      if ("realtime" in patch) {
        useDebugStore.getState().setRealtime(patch.realtime ?? null);
      }
    },
    setProfile: debugPatchAnonymousProfile,
    setQueue: (counts, live = true) =>
      useDebugStore.getState().setQueue(counts, live),
    setRealtime: (override) =>
      useDebugStore.getState().setRealtime(override),
    setGamePhase: (phase, snapshot = {}, events = []) =>
      useDebugStore.getState().setRealtime({
        connection: "connected",
        snapshot: { ...snapshot, phase },
        events,
        error: "",
      }),
    reset: () => useDebugStore.getState().reset(),
  };
}
