import { t } from "@lingui/core/macro";
import {
  clearClosingIntentIfMatches,
  isTerminalSessionError,
  saveClosingIntent,
  type RealtimeCredentials,
} from "@/lib/realtime";

export class QuickMatchCancellationTimeoutError extends Error {
  constructor() {
    super(t`取消请求超时，请重试。`);
    this.name = "QuickMatchCancellationTimeoutError";
  }
}

interface Attempt {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}

interface Dependencies {
  request: (
    ticket: RealtimeCredentials,
    signal: AbortSignal,
  ) => Promise<void>;
  commit: (ticket: RealtimeCredentials) => void;
  onPending: (pending: boolean) => void;
  onClosing?: (ticket: RealtimeCredentials) => void;
  onError: (error: unknown) => void;
  timeoutMs?: number;
  returnTo?: (ticket: RealtimeCredentials) => string;
}

export class QuickMatchCancellation {
  private active?: Attempt;
  private disposed = false;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  isActive() {
    return Boolean(this.active);
  }

  cancel(ticket: RealtimeCredentials): Promise<void> | null {
    if (this.disposed || this.active) return null;

    saveClosingIntent(ticket, this.dependencies.returnTo?.(ticket));
    this.dependencies.onClosing?.(ticket);
    const controller = new AbortController();
    const attempt: Attempt = {
      controller,
      timeout: setTimeout(() => {
        attempt.timedOut = true;
        controller.abort();
      }, this.dependencies.timeoutMs ?? 10_000),
      timedOut: false,
    };
    this.active = attempt;
    this.dependencies.onPending(true);
    return this.run(attempt, ticket);
  }

  dispose() {
    this.disposed = true;
    if (!this.active) return;
    clearTimeout(this.active.timeout);
    this.active.controller.abort();
  }

  private async run(attempt: Attempt, ticket: RealtimeCredentials) {
    try {
      await this.dependencies.request(ticket, attempt.controller.signal);
      if (this.disposed || this.active !== attempt) return;
      clearClosingIntentIfMatches(ticket);
      this.dependencies.commit(ticket);
    } catch (error) {
      if (this.disposed || this.active !== attempt) return;
      if (isTerminalSessionError(error)) {
        clearClosingIntentIfMatches(ticket);
        this.dependencies.commit(ticket);
        return;
      }
      this.active = undefined;
      this.dependencies.onPending(false);
      this.dependencies.onError(
        attempt.timedOut
          ? new QuickMatchCancellationTimeoutError()
          : error,
      );
    } finally {
      clearTimeout(attempt.timeout);
    }
  }
}
