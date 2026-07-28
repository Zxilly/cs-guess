/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QuickMatchCancellation,
  QuickMatchCancellationTimeoutError,
} from "@/lib/quick-match-cancellation";
import {
  ApiError,
  loadClosingIntent,
  type RealtimeCredentials,
} from "@/lib/realtime";

const TICKET: RealtimeCredentials = {
  roomCode: "CS-123456",
  playerId: "player",
  sessionToken: "token",
  socketIoUrl: "/socket.io",
  mode: "quick",
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

function setup(
  request: (
    ticket: RealtimeCredentials,
    signal: AbortSignal,
  ) => Promise<void>,
  timeoutMs = 10_000,
) {
  const commit = vi.fn();
  const onPending = vi.fn();
  const onError = vi.fn();
  const cancellation = new QuickMatchCancellation({
    request,
    commit,
    onPending,
    onError,
    timeoutMs,
  });
  return { cancellation, commit, onPending, onError };
}

describe("QuickMatchCancellation", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("takes a synchronous single-flight lock before the request", () => {
    const pending = deferred<void>();
    const request = vi.fn(() => pending.promise);
    const harness = setup(request);

    const first = harness.cancellation.cancel(TICKET);
    const second = harness.cancellation.cancel(TICKET);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(harness.cancellation.isActive()).toBe(true);
    expect(loadClosingIntent(TICKET)).toMatchObject({
      mode: "quick",
      roomCode: "CS-123456",
      playerId: "player",
    });
  });

  it("commits exactly once after confirmed success", async () => {
    const harness = setup(vi.fn().mockResolvedValue(undefined));

    await harness.cancellation.cancel(TICKET);

    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.commit).toHaveBeenCalledWith(TICKET);
    expect(harness.onPending).toHaveBeenCalledWith(true);
    expect(loadClosingIntent(TICKET)).toBeNull();
  });

  it("treats an already missing room as a completed cancellation", async () => {
    const harness = setup(
      vi.fn().mockRejectedValue(
        new ApiError("房间不存在", 404, "room_not_found"),
      ),
    );

    await harness.cancellation.cancel(TICKET);

    expect(harness.commit).toHaveBeenCalledWith(TICKET);
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "treats a rejected session status %s as an idempotent local cancellation",
    async (status) => {
      const harness = setup(
        vi.fn().mockRejectedValue(
          new ApiError("匹配会话已经失效", status, "unauthorized"),
        ),
      );

      await harness.cancellation.cancel(TICKET);

      expect(harness.commit).toHaveBeenCalledWith(TICKET);
      expect(harness.onError).not.toHaveBeenCalled();
    },
  );

  it("keeps the ticket retryable after a failure", async () => {
    const failure = new ApiError("暂时不可用", 503, "unavailable");
    const request = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const harness = setup(request);

    await harness.cancellation.cancel(TICKET);
    const retry = harness.cancellation.cancel(TICKET);
    await retry;

    expect(harness.onError).toHaveBeenCalledWith(failure);
    expect(harness.onPending).toHaveBeenNthCalledWith(2, false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(loadClosingIntent(TICKET)).toBeNull();
  });

  it("times out stalled cancellation and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(
        (_ticket: RealtimeCredentials, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const harness = setup(request, 500);

      const result = harness.cancellation.cancel(TICKET);
      await vi.advanceTimersByTimeAsync(500);
      await result;

      expect(harness.onError).toHaveBeenCalledWith(
        expect.any(QuickMatchCancellationTimeoutError),
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts on unmount and ignores a late successful response", async () => {
    const pending = deferred<void>();
    const request = vi.fn(
      (_ticket: RealtimeCredentials, _signal: AbortSignal) => pending.promise,
    );
    const harness = setup(request);
    const result = harness.cancellation.cancel(TICKET);
    const signal = request.mock.calls[0][1];

    harness.cancellation.dispose();
    pending.resolve();
    await result;

    expect(signal.aborted).toBe(true);
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.onPending).toHaveBeenCalledTimes(1);
    expect(loadClosingIntent(TICKET)).not.toBeNull();
  });
});
