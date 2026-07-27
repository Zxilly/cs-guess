import { create } from "zustand";

import type {
  ConnectionState,
  MatchmakingQueueCounts,
  ServerEvent,
} from "@/lib/realtime";

export interface RealtimeDebugOverride {
  connection?: ConnectionState;
  snapshot?: Record<string, unknown>;
  events?: ServerEvent[];
  error?: string;
}

interface DebugState {
  queueCounts: MatchmakingQueueCounts | null;
  queueLive: boolean | null;
  realtime: RealtimeDebugOverride | null;
  setQueue: (
    counts: MatchmakingQueueCounts | null,
    live?: boolean | null,
  ) => void;
  setRealtime: (override: RealtimeDebugOverride | null) => void;
  reset: () => void;
}

export const useDebugStore = create<DebugState>()((set) => ({
  queueCounts: null,
  queueLive: null,
  realtime: null,
  setQueue: (queueCounts, queueLive = true) =>
    set({ queueCounts, queueLive: queueCounts ? queueLive : null }),
  setRealtime: (realtime) => set({ realtime }),
  reset: () =>
    set({
      queueCounts: null,
      queueLive: null,
      realtime: null,
    }),
}));
