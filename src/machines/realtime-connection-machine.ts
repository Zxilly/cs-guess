import { setup } from "xstate";

import type { ConnectionState } from "@/lib/realtime";

export type RealtimeConnectionEvent =
  | { type: "CONNECT" }
  | { type: "OPEN" }
  | { type: "TRANSIENT_CLOSE" }
  | { type: "FATAL_CLOSE" }
  | { type: "MANUAL_CLOSE" };

export const realtimeConnectionMachine = setup({
  types: {
    events: {} as RealtimeConnectionEvent,
  },
}).createMachine({
  id: "realtime-connection",
  initial: "connecting",
  on: {
    CONNECT: ".connecting",
    MANUAL_CLOSE: ".closed",
  },
  states: {
    connecting: {
      on: {
        OPEN: "connected",
        TRANSIENT_CLOSE: "reconnecting",
        FATAL_CLOSE: "offline",
      },
    },
    connected: {
      on: {
        TRANSIENT_CLOSE: "reconnecting",
        FATAL_CLOSE: "offline",
      },
    },
    reconnecting: {
      on: {
        OPEN: "connected",
        FATAL_CLOSE: "offline",
      },
    },
    offline: {},
    closed: {},
  },
});

export function connectionStateValue(value: unknown): ConnectionState {
  return typeof value === "string" &&
    ["connecting", "connected", "reconnecting", "offline", "closed"].includes(
      value,
    )
    ? (value as ConnectionState)
    : "offline";
}
