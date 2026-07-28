import { describe, expect, it, vi } from "vitest";

import {
  QuickMatchSubmission,
  QuickMatchTimeoutError,
  type QuickMatchSnapshot,
} from "@/lib/quick-match-submission";
import type { SessionResponse } from "@/lib/realtime";

const SNAPSHOT: QuickMatchSnapshot = {
  identityId: "donk",
  visibility: "hidden",
  bestOf: 3,
  partySize: 2,
  difficulty: "easy",
};

const TICKET: SessionResponse = {
  room_code: "CS-123456",
  player_id: "player-1",
  session_token: "token-1",
  socket_io_url: "/socket.io",
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
  snapshot: Readonly<QuickMatchSnapshot>,
  clientRequestId: string,
  signal: AbortSignal,
) => Promise<SessionResponse>;

function setup(
  request: ReturnType<typeof vi.fn<RequestFunction>> =
    vi.fn<RequestFunction>(),
) {
  const events: string[] = [];
  const onPending = vi.fn((pending: boolean) => {
    events.push(`pending:${pending}`);
  });
  const onError = vi.fn(() => {
    events.push("error");
  });
  const persist = vi.fn(() => {
    events.push("persist");
  });
  const commit = vi.fn(() => {
    events.push("commit");
  });
  const compensate = vi.fn(async () => {
    events.push("compensate");
  });
  const cancelByRequestId = vi.fn(async () => {
    events.push("cancel-by-request-id");
  });
  const discard = vi.fn(() => {
    events.push("discard");
  });
  const submission = new QuickMatchSubmission({
    createClientRequestId: () => "attempt-1",
    request,
    persist,
    commit,
    compensate,
    cancelByRequestId,
    discard,
    onPending,
    onError,
  });
  return {
    submission,
    request,
    persist,
    commit,
    compensate,
    cancelByRequestId,
    discard,
    onPending,
    onError,
    events,
  };
}

describe("QuickMatchSubmission", () => {
  it("takes the single-flight lock synchronously and submits an immutable snapshot once", () => {
    const pending = deferred<SessionResponse>();
    const request = vi.fn<RequestFunction>(() => pending.promise);
    const harness = setup(request);
    const changingSettings = { ...SNAPSHOT };

    const first = harness.submission.submit(changingSettings);
    changingSettings.bestOf = 5;
    const second = harness.submission.submit(changingSettings);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual(SNAPSHOT);
    expect(Object.isFrozen(request.mock.calls[0][0])).toBe(true);
    expect(request.mock.calls[0][1]).toBe("attempt-1");
    expect(request.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });

  it("persists a successful ticket before committing navigation", async () => {
    const harness = setup(vi.fn().mockResolvedValue(TICKET));

    await harness.submission.submit(SNAPSHOT);

    expect(harness.persist).toHaveBeenCalledWith(TICKET);
    expect(harness.commit).toHaveBeenCalledWith(TICKET);
    expect(harness.events).toEqual(["pending:true", "persist", "commit"]);
    harness.submission.dispose();
    expect(harness.compensate).not.toHaveBeenCalled();
  });

  it("unlocks after an error and only reports the current attempt", async () => {
    const failure = new Error("offline");
    const request = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(TICKET);
    const harness = setup(request);

    await harness.submission.submit(SNAPSHOT);
    const retry = harness.submission.submit(SNAPSHOT);

    expect(harness.onError).toHaveBeenCalledWith(failure);
    expect(harness.onPending).toHaveBeenNthCalledWith(2, false);
    expect(retry).not.toBeNull();
    await retry;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight request on unmount without publishing stale UI state", async () => {
    const pending = deferred<SessionResponse>();
    const harness = setup(vi.fn(() => pending.promise));
    const result = harness.submission.submit(SNAPSHOT);
    const signal = harness.request.mock.calls[0][2];

    harness.submission.dispose();
    pending.reject(new DOMException("aborted", "AbortError"));
    await result;

    expect(signal.aborted).toBe(true);
    expect(harness.cancelByRequestId).toHaveBeenCalledWith("attempt-1");
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.onPending).toHaveBeenCalledTimes(1);
  });

  it("persists then compensates a ticket that arrives after unmount", async () => {
    const pending = deferred<SessionResponse>();
    const harness = setup(vi.fn(() => pending.promise));
    const result = harness.submission.submit(SNAPSHOT);

    harness.submission.dispose();
    pending.resolve(TICKET);
    await result;

    expect(harness.persist).toHaveBeenCalledWith(TICKET);
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.compensate).toHaveBeenCalledWith(TICKET);
    expect(harness.discard).toHaveBeenCalledWith(TICKET);
    expect(harness.events).toEqual([
      "pending:true",
      "cancel-by-request-id",
      "persist",
      "compensate",
      "discard",
    ]);
  });

  it("compensates when unmount happens after a ticket is acquired but before commit", async () => {
    let harness: ReturnType<typeof setup>;
    harness = setup(vi.fn().mockResolvedValue(TICKET));
    harness.persist.mockImplementation(() => {
      harness.events.push("persist");
      harness.submission.dispose();
    });

    await harness.submission.submit(SNAPSHOT);

    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.compensate).toHaveBeenCalledWith(TICKET);
    expect(harness.discard).toHaveBeenCalledWith(TICKET);
  });

  it("times out a stalled request, reports a retryable error, and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(
        (_snapshot, _clientRequestId, signal: AbortSignal) =>
          new Promise<SessionResponse>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const harness = setup(request);
      const submission = new QuickMatchSubmission({
        createClientRequestId: () => "attempt-timeout",
        request,
        persist: harness.persist,
        commit: harness.commit,
        compensate: harness.compensate,
        cancelByRequestId: harness.cancelByRequestId,
        discard: harness.discard,
        onPending: harness.onPending,
        onError: harness.onError,
        timeoutMs: 500,
      });

      const result = submission.submit(SNAPSHOT);
      await vi.advanceTimersByTimeAsync(500);
      await result;

      expect(request.mock.calls[0][2].aborted).toBe(true);
      expect(harness.onError).toHaveBeenCalledWith(
        expect.any(QuickMatchTimeoutError),
      );
      expect(harness.onPending).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
