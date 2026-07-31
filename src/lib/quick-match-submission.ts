import { t } from "@lingui/core/macro";
import type { SessionResponse } from "@/lib/realtime";
import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
  PartySize,
} from "@/types/game";

export interface QuickMatchSnapshot {
  identityId: string;
  visibility: OpponentVisibility;
  bestOf: BestOf;
  partySize: PartySize;
  difficulty: GameDifficulty;
}

export class QuickMatchTimeoutError extends Error {
  constructor() {
    super(t`匹配请求超时，请重试。`);
    this.name = "QuickMatchTimeoutError";
  }
}

interface Attempt {
  controller: AbortController;
  clientRequestId: string;
  timeout: ReturnType<typeof setTimeout>;
  timedOut: boolean;
  ticket?: SessionResponse;
  committed: boolean;
  compensation?: Promise<void>;
  requestCancellation?: Promise<void>;
}

interface QuickMatchSubmissionDependencies {
  createClientRequestId: () => string;
  request: (
    snapshot: Readonly<QuickMatchSnapshot>,
    clientRequestId: string,
    signal: AbortSignal,
  ) => Promise<SessionResponse>;
  persist: (ticket: SessionResponse) => void;
  commit: (ticket: SessionResponse) => void;
  compensate: (ticket: SessionResponse) => Promise<void>;
  cancelByRequestId: (clientRequestId: string) => Promise<void>;
  discard: (ticket: SessionResponse) => void;
  onPending: (
    pending: boolean,
    snapshot?: Readonly<QuickMatchSnapshot>,
  ) => void;
  onError: (error: unknown) => void;
  timeoutMs?: number;
}

export class QuickMatchSubmission {
  private active?: Attempt;
  private disposed = false;
  private readonly dependencies: QuickMatchSubmissionDependencies;

  constructor(dependencies: QuickMatchSubmissionDependencies) {
    this.dependencies = dependencies;
  }

  submit(snapshot: QuickMatchSnapshot): Promise<void> | null {
    if (this.disposed || this.active) return null;

    const submittedSnapshot = Object.freeze({ ...snapshot });
    const controller = new AbortController();
    const attempt: Attempt = {
      controller,
      clientRequestId: this.dependencies.createClientRequestId(),
      timeout: setTimeout(() => {
        attempt.timedOut = true;
        controller.abort();
      }, this.dependencies.timeoutMs ?? 15_000),
      timedOut: false,
      committed: false,
    };

    // This assignment is deliberately before the first async boundary.
    this.active = attempt;
    this.dependencies.onPending(true, submittedSnapshot);
    return this.run(attempt, submittedSnapshot);
  }

  dispose() {
    this.disposed = true;
    const attempt = this.active;
    if (!attempt) return;
    clearTimeout(attempt.timeout);
    attempt.controller.abort();
    if (attempt.ticket && !attempt.committed) {
      void this.compensate(attempt, attempt.ticket);
    } else if (!attempt.committed) {
      void this.cancelByRequestId(attempt);
    }
  }

  private async run(
    attempt: Attempt,
    snapshot: Readonly<QuickMatchSnapshot>,
  ) {
    try {
      const ticket = await this.dependencies.request(
        snapshot,
        attempt.clientRequestId,
        attempt.controller.signal,
      );
      attempt.ticket = ticket;

      // Persist first: navigation can synchronously unmount the component.
      this.dependencies.persist(ticket);
      if (
        this.disposed ||
        attempt.controller.signal.aborted ||
        this.active !== attempt
      ) {
        await this.compensate(attempt, ticket);
        return;
      }

      attempt.committed = true;
      this.dependencies.commit(ticket);
    } catch (error) {
      if (attempt.ticket && !attempt.committed) {
        await this.compensate(attempt, attempt.ticket);
      } else if (
        !attempt.committed &&
        (attempt.timedOut || attempt.controller.signal.aborted)
      ) {
        void this.cancelByRequestId(attempt);
      }
      if (this.disposed || this.active !== attempt) return;

      this.active = undefined;
      this.dependencies.onPending(false);
      this.dependencies.onError(
        attempt.timedOut ? new QuickMatchTimeoutError() : error,
      );
    } finally {
      clearTimeout(attempt.timeout);
    }
  }

  private compensate(attempt: Attempt, ticket: SessionResponse) {
    attempt.compensation ??= Promise.resolve()
      .then(() => this.dependencies.compensate(ticket))
      .then(() => this.dependencies.discard(ticket))
      .catch(() => {
        // Keep the persisted credentials when cancellation is not confirmed so
        // the next screen load can recover and cancel the live ticket.
      });
    return attempt.compensation;
  }

  private cancelByRequestId(attempt: Attempt) {
    attempt.requestCancellation ??= Promise.resolve()
      .then(() =>
        this.dependencies.cancelByRequestId(attempt.clientRequestId),
      )
      .catch(() => {
        // Best effort only. The server-side TTL remains the final fallback.
      });
    return attempt.requestCancellation;
  }
}
