import { createActor } from "xstate";
import { describe, expect, it } from "vitest";

import { realtimeConnectionMachine } from "./realtime-connection-machine";

function connectionActor() {
  const actor = createActor(realtimeConnectionMachine);
  actor.start();
  return actor;
}

describe("realtimeConnectionMachine", () => {
  it("moves through connect, reconnect, and recovery states", () => {
    const actor = connectionActor();

    expect(actor.getSnapshot().value).toBe("connecting");
    actor.send({ type: "OPEN" });
    expect(actor.getSnapshot().value).toBe("connected");
    actor.send({ type: "TRANSIENT_CLOSE" });
    expect(actor.getSnapshot().value).toBe("reconnecting");
    actor.send({ type: "OPEN" });
    expect(actor.getSnapshot().value).toBe("connected");
  });

  it("requires an explicit reconnect after a fatal close", () => {
    const actor = connectionActor();

    actor.send({ type: "FATAL_CLOSE" });
    expect(actor.getSnapshot().value).toBe("offline");
    actor.send({ type: "OPEN" });
    expect(actor.getSnapshot().value).toBe("offline");
    actor.send({ type: "CONNECT" });
    expect(actor.getSnapshot().value).toBe("connecting");
  });

  it("does not reopen a manually closed connection", () => {
    const actor = connectionActor();

    actor.send({ type: "MANUAL_CLOSE" });
    expect(actor.getSnapshot().value).toBe("closed");
    actor.send({ type: "OPEN" });
    expect(actor.getSnapshot().value).toBe("closed");
  });
});
