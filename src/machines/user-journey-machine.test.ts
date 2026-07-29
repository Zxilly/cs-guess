import { createActor } from "xstate";
import { describe, expect, it } from "vitest";

import {
  describeUserJourney,
  USER_CONNECTION_STATES,
  USER_JOURNEY_STATES,
  normalizeIdentityReturnTo,
  userJourneyMachine,
  type UserJourneyEvent,
} from "./user-journey-machine";

function journeyActor() {
  const actor = createActor(userJourneyMachine);
  actor.start();
  return actor;
}

describe("userJourneyMachine", () => {
  it("sends a first-time player through identity setup and back to the requested mode", () => {
    const actor = journeyActor();

    actor.send({
      type: "BOOT",
      identityConfirmed: false,
      returnTo: "/quick",
    });
    expect(actor.getSnapshot().matches({ experience: "onboarding" })).toBe(
      true,
    );

    actor.send({ type: "IDENTITY_CONFIRMED" });
    expect(
      actor
        .getSnapshot()
        .matches({ experience: { quick: "setup" } }),
    ).toBe(true);
  });

  it("covers daily loading, recovery, play, and result states", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "OPEN_DAILY" });
    expect(
      actor.getSnapshot().matches({ experience: { daily: "loading" } }),
    ).toBe(true);

    actor.send({ type: "LOAD_FAILED" });
    expect(
      actor.getSnapshot().matches({ experience: { daily: "error" } }),
    ).toBe(true);

    actor.send({ type: "RETRY" });
    actor.send({ type: "DAILY_READY" });
    expect(
      actor.getSnapshot().matches({ experience: { daily: "playing" } }),
    ).toBe(true);

    actor.send({ type: "ROUND_WON" });
    expect(
      actor.getSnapshot().matches({ experience: { daily: "won" } }),
    ).toBe(true);

    actor.send({ type: "EXIT_TO_LOBBY" });
    expect(actor.getSnapshot().matches({ experience: "lobby" })).toBe(true);
  });

  it("covers solo difficulty selection, loss, replay, and difficulty changes", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "OPEN_SOLO" });
    expect(
      actor
        .getSnapshot()
        .matches({ experience: { solo: "selectingDifficulty" } }),
    ).toBe(true);

    actor.send({ type: "SELECT_DIFFICULTY", difficulty: "hard" });
    expect(
      actor.getSnapshot().matches({ experience: { solo: "playing" } }),
    ).toBe(true);
    expect(actor.getSnapshot().context.difficulty).toBe("hard");

    actor.send({ type: "ROUND_LOST" });
    expect(
      actor.getSnapshot().matches({ experience: { solo: "lost" } }),
    ).toBe(true);

    actor.send({ type: "PLAY_AGAIN" });
    expect(
      actor.getSnapshot().matches({ experience: { solo: "playing" } }),
    ).toBe(true);

    actor.send({ type: "CHANGE_DIFFICULTY" });
    expect(
      actor
        .getSnapshot()
        .matches({ experience: { solo: "selectingDifficulty" } }),
    ).toBe(true);
  });

  it("covers quick-match setup, queue, entry, rounds, and series completion", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "OPEN_QUICK" });
    actor.send({ type: "START_MATCHING" });
    actor.send({ type: "MATCH_REQUEST_ACCEPTED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "matching" } }),
    ).toBe(true);

    actor.send({ type: "MATCH_FOUND" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "entering" } }),
    ).toBe(true);

    actor.send({ type: "ENTER_MATCH" });
    actor.send({ type: "ROUND_STARTED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "playing" } }),
    ).toBe(true);

    actor.send({ type: "ROUND_FINISHED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "roundResult" } }),
    ).toBe(true);

    actor.send({ type: "NEXT_ROUND" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "waiting" } }),
    ).toBe(true);

    actor.send({ type: "SERIES_FINISHED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "seriesResult" } }),
    ).toBe(true);
  });

  it("covers friend-room submission errors, waiting, play, and results", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "OPEN_ROOM" });
    actor.send({ type: "SUBMIT_ROOM" });
    expect(
      actor.getSnapshot().matches({ experience: { room: "submitting" } }),
    ).toBe(true);

    actor.send({ type: "ROOM_REQUEST_FAILED" });
    expect(
      actor.getSnapshot().matches({ experience: { room: "error" } }),
    ).toBe(true);

    actor.send({ type: "RETRY" });
    actor.send({ type: "SUBMIT_ROOM" });
    actor.send({ type: "ROOM_READY" });
    expect(
      actor.getSnapshot().matches({ experience: { room: "waiting" } }),
    ).toBe(true);

    actor.send({ type: "ROUND_STARTED" });
    actor.send({ type: "ROUND_FINISHED" });
    expect(
      actor.getSnapshot().matches({ experience: { room: "roundResult" } }),
    ).toBe(true);

    actor.send({ type: "SERIES_FINISHED" });
    expect(
      actor.getSnapshot().matches({ experience: { room: "seriesResult" } }),
    ).toBe(true);
  });

  it("keeps the current screen while realtime connectivity recovers", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });
    actor.send({ type: "OPEN_QUICK" });
    actor.send({ type: "START_MATCHING" });
    actor.send({ type: "MATCH_REQUEST_ACCEPTED" });
    actor.send({ type: "MATCH_FOUND" });
    actor.send({ type: "ENTER_MATCH" });
    actor.send({ type: "ROUND_STARTED" });
    actor.send({ type: "CONNECT_REALTIME" });
    actor.send({ type: "SOCKET_CONNECTED" });

    actor.send({ type: "CONNECTION_LOST" });
    expect(actor.getSnapshot().matches({ connection: "reconnecting" })).toBe(
      true,
    );
    expect(
      actor.getSnapshot().matches({ experience: { quick: "playing" } }),
    ).toBe(true);

    actor.send({ type: "CONNECTION_RESTORED" });
    expect(actor.getSnapshot().matches({ connection: "connected" })).toBe(
      true,
    );

    actor.send({ type: "SESSION_EXPIRED" });
    expect(actor.getSnapshot().matches({ connection: "offline" })).toBe(true);

    actor.send({ type: "RETRY_CONNECTION" });
    expect(actor.getSnapshot().matches({ connection: "connecting" })).toBe(
      true,
    );
  });

  it("covers identity management and match-history screens", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "OPEN_IDENTITY" });
    expect(actor.getSnapshot().matches({ experience: "identity" })).toBe(true);
    actor.send({ type: "IDENTITY_DONE" });
    expect(actor.getSnapshot().matches({ experience: "lobby" })).toBe(true);

    actor.send({ type: "OPEN_STATS" });
    expect(actor.getSnapshot().matches({ experience: "stats" })).toBe(true);
    actor.send({ type: "EXIT_TO_LOBBY" });
    expect(actor.getSnapshot().matches({ experience: "lobby" })).toBe(true);
  });

  it("covers quick-match request and cancellation failures", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });
    actor.send({ type: "OPEN_QUICK" });

    actor.send({ type: "START_MATCHING" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "submitting" } }),
    ).toBe(true);
    actor.send({ type: "MATCH_REQUEST_FAILED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "setupError" } }),
    ).toBe(true);

    actor.send({ type: "RETRY" });
    actor.send({ type: "START_MATCHING" });
    actor.send({ type: "MATCH_REQUEST_ACCEPTED" });
    actor.send({ type: "CANCEL_MATCHING" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "canceling" } }),
    ).toBe(true);

    actor.send({ type: "CANCEL_FAILED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "cancelError" } }),
    ).toBe(true);

    actor.send({ type: "CANCEL_MATCHING" });
    actor.send({ type: "MATCH_CANCELLED" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "setup" } }),
    ).toBe(true);
  });

  it("covers identity draw and replay dialog states", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });
    actor.send({ type: "OPEN_IDENTITY" });

    actor.send({ type: "BEGIN_DRAW" });
    expect(
      actor.getSnapshot().matches({ experience: { identity: "rolling" } }),
    ).toBe(true);
    actor.send({ type: "DRAW_REVEALED" });
    expect(
      actor.getSnapshot().matches({ experience: { identity: "result" } }),
    ).toBe(true);
    actor.send({ type: "KEEP_IDENTITY" });
    expect(
      actor.getSnapshot().matches({ experience: { identity: "idle" } }),
    ).toBe(true);

    actor.send({ type: "EXIT_TO_LOBBY" });
    actor.send({ type: "OPEN_STATS" });
    actor.send({ type: "OPEN_REPLAY" });
    expect(
      actor.getSnapshot().matches({ experience: { stats: "replay" } }),
    ).toBe(true);
    actor.send({ type: "CLOSE_REPLAY" });
    expect(
      actor.getSnapshot().matches({ experience: { stats: "list" } }),
    ).toBe(true);
  });

  it("describes the visible state with its canonical route", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });
    expect(describeUserJourney(actor.getSnapshot())).toMatchObject({
      id: "lobby",
      route: "/",
    });

    actor.send({ type: "OPEN_SOLO" });
    expect(describeUserJourney(actor.getSnapshot())).toMatchObject({
      id: "solo.selectingDifficulty",
      route: "/solo",
    });

    actor.send({ type: "SELECT_DIFFICULTY", difficulty: "full" });
    expect(describeUserJourney(actor.getSnapshot())).toMatchObject({
      id: "solo.playing",
      route: "/play/solo?difficulty=full",
    });
  });

  it.each([
    ["/play/daily", { experience: { daily: "loading" } }],
    ["/solo", { experience: { solo: "selectingDifficulty" } }],
    ["/room", { experience: { room: "setup" } }],
    ["/stats", { experience: "stats" }],
  ] as const)("returns onboarding to %s", (returnTo, expectedState) => {
    const actor = journeyActor();
    actor.send({
      type: "BOOT",
      identityConfirmed: false,
      returnTo,
    });
    actor.send({ type: "IDENTITY_CONFIRMED" });

    expect(actor.getSnapshot().matches(expectedState)).toBe(true);
  });

  it("rejects result and match events outside their legal flows", () => {
    const actor = journeyActor();
    actor.send({ type: "BOOT", identityConfirmed: true });

    actor.send({ type: "ROUND_WON" });
    actor.send({ type: "MATCH_FOUND" });
    expect(actor.getSnapshot().matches({ experience: "lobby" })).toBe(true);

    actor.send({ type: "OPEN_QUICK" });
    actor.send({ type: "MATCH_FOUND" });
    expect(
      actor.getSnapshot().matches({ experience: { quick: "setup" } }),
    ).toBe(true);
  });

  it("keeps every documented experience and connection state reachable", () => {
    const experienceEvents: UserJourneyEvent[] = [
      { type: "BOOT", identityConfirmed: true },
      { type: "BOOT", identityConfirmed: false, returnTo: "/" },
      { type: "IDENTITY_CONFIRMED" },
      { type: "OPEN_DAILY" },
      { type: "DAILY_READY" },
      { type: "LOAD_FAILED" },
      { type: "RETRY" },
      { type: "ROUND_WON" },
      { type: "ROUND_LOST" },
      { type: "OPEN_SOLO" },
      { type: "SELECT_DIFFICULTY", difficulty: "hard" },
      { type: "PLAY_AGAIN" },
      { type: "CHANGE_DIFFICULTY" },
      { type: "OPEN_QUICK" },
      { type: "START_MATCHING" },
      { type: "MATCH_REQUEST_ACCEPTED" },
      { type: "MATCH_REQUEST_FAILED" },
      { type: "CANCEL_MATCHING" },
      { type: "CANCEL_FAILED" },
      { type: "MATCH_CANCELLED" },
      { type: "MATCH_FOUND" },
      { type: "ENTER_MATCH" },
      { type: "ROUND_STARTED" },
      { type: "ROUND_FINISHED" },
      { type: "NEXT_ROUND" },
      { type: "SERIES_FINISHED" },
      { type: "OPEN_ROOM" },
      { type: "SUBMIT_ROOM" },
      { type: "ROOM_REQUEST_FAILED" },
      { type: "ROOM_READY" },
      { type: "OPEN_IDENTITY" },
      { type: "IDENTITY_DONE" },
      { type: "OPEN_STATS" },
      { type: "BEGIN_DRAW" },
      { type: "DRAW_REVEALED" },
      { type: "KEEP_IDENTITY" },
      { type: "REROLL_IDENTITY" },
      { type: "OPEN_REPLAY" },
      { type: "CLOSE_REPLAY" },
      { type: "EXIT_TO_LOBBY" },
    ];
    const connectionEvents: UserJourneyEvent[] = [
      { type: "CONNECT_REALTIME" },
      { type: "SOCKET_CONNECTED" },
      { type: "CONNECTION_LOST" },
      { type: "CONNECTION_RESTORED" },
      { type: "SESSION_EXPIRED" },
      { type: "RETRY_CONNECTION" },
      { type: "LEAVE_REALTIME" },
    ];

    function explore(events: UserJourneyEvent[], readKey: (actor: ReturnType<typeof journeyActor>) => string) {
      const reached = new Set<string>();
      const queue: UserJourneyEvent[][] = [[]];
      while (queue.length > 0) {
        const sequence = queue.shift() ?? [];
        const actor = journeyActor();
        for (const event of sequence) actor.send(event);
        const currentKey = readKey(actor);
        actor.stop();
        if (reached.has(currentKey)) continue;
        reached.add(currentKey);
        for (const event of events) queue.push([...sequence, event]);
      }
      return reached;
    }

    const reachedExperience = explore(
      experienceEvents,
      (actor) => describeUserJourney(actor.getSnapshot()).id,
    );
    const reachedConnections = explore(
      connectionEvents,
      (actor) => describeUserJourney(actor.getSnapshot()).connection.id,
    );

    expect(reachedExperience).toEqual(
      new Set(USER_JOURNEY_STATES.map((state) => state.id)),
    );
    expect(reachedConnections).toEqual(
      new Set(USER_CONNECTION_STATES.map((state) => state.id)),
    );
  });

  it("keeps state catalog entries unique and self-describing", () => {
    const experienceIds = USER_JOURNEY_STATES.map((state) => state.id);
    const connectionIds = USER_CONNECTION_STATES.map((state) => state.id);

    expect(new Set(experienceIds).size).toBe(experienceIds.length);
    expect(new Set(connectionIds).size).toBe(connectionIds.length);
    for (const state of USER_JOURNEY_STATES) {
      expect(state.label.trim()).not.toBe("");
      expect(state.description.trim()).not.toBe("");
      expect(state.route).toMatch(/^\//);
    }
    for (const state of USER_CONNECTION_STATES) {
      expect(state.label.trim()).not.toBe("");
      expect(state.description.trim()).not.toBe("");
    }
  });

  it("normalizes protected realtime routes to a state the new player can actually enter", () => {
    expect(normalizeIdentityReturnTo("/play/room")).toBe("/room");
    expect(normalizeIdentityReturnTo("/play/quick")).toBe("/quick");
    expect(normalizeIdentityReturnTo("/matching")).toBe("/quick");
    expect(normalizeIdentityReturnTo("/unknown")).toBe("/");
  });
});
