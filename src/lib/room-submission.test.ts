import { describe, expect, it, vi } from "vitest";

import {
  RoomSubmission,
  RoomSubmissionTimeoutError,
  type CreateRoomSnapshot,
  type RoomSubmissionSnapshot,
} from "@/lib/room-submission";
import type { SessionResponse } from "@/lib/realtime";

const CREATE_SNAPSHOT: CreateRoomSnapshot = {
  kind: "create",
  identityId: "donk",
  identityNickname: "donk",
  visibility: "hidden",
  maxPlayers: 4,
  bestOf: 3,
  difficulty: "full",
};

const TICKET: SessionResponse = {
  room_code: "CS-123456",
  player_id: "player-1",
  session_token: "token-1",
  snapshot: { phase: "waiting" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type RequestFunction = (
  snapshot: Readonly<RoomSubmissionSnapshot>,
  signal: AbortSignal,
) => Promise<SessionResponse>;

function setup(
  request: ReturnType<typeof vi.fn<RequestFunction>> =
    vi.fn<RequestFunction>(),
  timeoutMs?: number,
) {
  const events: string[] = [];
  const persist = vi.fn(() => events.push("persist"));
  const commit = vi.fn(() => events.push("commit"));
  const compensate = vi.fn(async () => {
    events.push("compensate");
  });
  const discard = vi.fn(() => events.push("discard"));
  const onPending = vi.fn((pending: boolean) => {
    events.push(`pending:${pending}`);
  });
  const onError = vi.fn(() => events.push("error"));
  const submission = new RoomSubmission({
    request,
    persist,
    commit,
    compensate,
    discard,
    onPending,
    onError,
    timeoutMs,
  });
  return {
    submission,
    request,
    persist,
    commit,
    compensate,
    discard,
    onPending,
    onError,
    events,
  };
}

describe("RoomSubmission", () => {
  it("locks join and create synchronously and freezes the submitted snapshot", () => {
    const pending = deferred<SessionResponse>();
    const request = vi.fn<RequestFunction>(() => pending.promise);
    const harness = setup(request);
    const changingSettings = { ...CREATE_SNAPSHOT };

    const create = harness.submission.submit(changingSettings);
    changingSettings.bestOf = 5;
    const join = harness.submission.submit({
      kind: "join",
      identityId: "donk",
      identityNickname: "donk",
      roomNumber: "654321",
    });

    expect(create).not.toBeNull();
    expect(join).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual(CREATE_SNAPSHOT);
    expect(Object.isFrozen(request.mock.calls[0][0])).toBe(true);
  });

  it("persists before replace-navigation commit", async () => {
    const harness = setup(vi.fn().mockResolvedValue(TICKET));

    await harness.submission.submit(CREATE_SNAPSHOT);

    expect(harness.persist).toHaveBeenCalledWith(TICKET);
    expect(harness.commit).toHaveBeenCalledWith(
      TICKET,
      CREATE_SNAPSHOT,
    );
    expect(harness.events).toEqual(["pending:true", "persist", "commit"]);
  });

  it("unlocks after an error and reports the matching action", async () => {
    const failure = new Error("offline");
    const harness = setup(
      vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(TICKET),
    );

    await harness.submission.submit(CREATE_SNAPSHOT);
    const retry = harness.submission.submit(CREATE_SNAPSHOT);

    expect(harness.onPending).toHaveBeenNthCalledWith(2, false);
    expect(harness.onError).toHaveBeenCalledWith(
      failure,
      CREATE_SNAPSHOT,
    );
    expect(retry).not.toBeNull();
    await retry;
  });

  it("aborts silently on dispose", async () => {
    const pending = deferred<SessionResponse>();
    const harness = setup(vi.fn(() => pending.promise));
    const result = harness.submission.submit(CREATE_SNAPSHOT);
    const signal = harness.request.mock.calls[0][1];

    harness.submission.dispose();
    pending.reject(new DOMException("aborted", "AbortError"));
    await result;

    expect(signal.aborted).toBe(true);
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.onPending).toHaveBeenCalledTimes(1);
  });

  it("does not persist a late response and compensates its room", async () => {
    const pending = deferred<SessionResponse>();
    const harness = setup(vi.fn(() => pending.promise));
    const result = harness.submission.submit(CREATE_SNAPSHOT);

    harness.submission.dispose();
    pending.resolve(TICKET);
    await result;

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.compensate).toHaveBeenCalledWith(TICKET);
    expect(harness.discard).toHaveBeenCalledWith(TICKET);
  });

  it("reports a retryable timeout and leaves a response that ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<SessionResponse>();
      const harness = setup(vi.fn(() => pending.promise), 500);
      const result = harness.submission.submit(CREATE_SNAPSHOT);

      await vi.advanceTimersByTimeAsync(500);
      pending.resolve(TICKET);
      await result;

      expect(harness.request.mock.calls[0][1].aborted).toBe(true);
      expect(harness.persist).not.toHaveBeenCalled();
      expect(harness.compensate).toHaveBeenCalledWith(TICKET);
      expect(harness.onError).toHaveBeenCalledWith(
        expect.any(RoomSubmissionTimeoutError),
        CREATE_SNAPSHOT,
      );
      expect(harness.onPending).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the timeout when the aborted request rejects", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(
        (_snapshot, signal: AbortSignal) =>
          new Promise<SessionResponse>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const harness = setup(request, 500);
      const result = harness.submission.submit(CREATE_SNAPSHOT);

      await vi.advanceTimersByTimeAsync(500);
      await result;

      expect(harness.onError).toHaveBeenCalledWith(
        expect.any(RoomSubmissionTimeoutError),
        CREATE_SNAPSHOT,
      );
      expect(harness.onPending).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
