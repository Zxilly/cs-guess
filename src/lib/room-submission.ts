import type { SessionResponse } from "@/lib/realtime";
import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
  PartySize,
} from "@/types/game";

export interface JoinRoomSnapshot {
  kind: "join";
  identityId: string;
  identityNickname: string;
  roomNumber: string;
}

export interface CreateRoomSnapshot {
  kind: "create";
  identityId: string;
  identityNickname: string;
  visibility: OpponentVisibility;
  maxPlayers: PartySize;
  bestOf: BestOf;
  difficulty: GameDifficulty;
}

export type RoomSubmissionSnapshot =
  | JoinRoomSnapshot
  | CreateRoomSnapshot;

export class RoomSubmissionTimeoutError extends Error {
  readonly kind: RoomSubmissionSnapshot["kind"];

  constructor(kind: RoomSubmissionSnapshot["kind"]) {
    super(
      kind === "join"
        ? "加入房间超时，请检查房间号后重试。"
        : "创建房间超时，请重试。",
    );
    this.name = "RoomSubmissionTimeoutError";
    this.kind = kind;
  }
}

interface Attempt {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  timedOut: boolean;
  committed: boolean;
  ticket?: SessionResponse;
  compensation?: Promise<void>;
}

interface RoomSubmissionDependencies {
  request: (
    snapshot: Readonly<RoomSubmissionSnapshot>,
    signal: AbortSignal,
  ) => Promise<SessionResponse>;
  persist: (ticket: SessionResponse) => void;
  commit: (
    ticket: SessionResponse,
    snapshot: Readonly<RoomSubmissionSnapshot>,
  ) => void;
  compensate: (ticket: SessionResponse) => Promise<void>;
  discard: (ticket: SessionResponse) => void;
  onPending: (
    pending: boolean,
    snapshot?: Readonly<RoomSubmissionSnapshot>,
  ) => void;
  onError: (
    error: unknown,
    snapshot: Readonly<RoomSubmissionSnapshot>,
  ) => void;
  timeoutMs?: number;
}

/**
 * Owns both room actions so join and create share one synchronous single-flight
 * lock. Component state is intentionally not the lock: React updates are not
 * synchronous enough to reject a same-tick double submit.
 */
export class RoomSubmission {
  private active?: Attempt;
  private disposed = false;
  private readonly dependencies: RoomSubmissionDependencies;

  constructor(dependencies: RoomSubmissionDependencies) {
    this.dependencies = dependencies;
  }

  submit(
    snapshot: RoomSubmissionSnapshot,
  ): Promise<void> | null {
    if (this.disposed || this.active) return null;

    const submittedSnapshot = Object.freeze({ ...snapshot });
    const controller = new AbortController();
    const attempt: Attempt = {
      controller,
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      timedOut: false,
      committed: false,
    };
    attempt.timeout = setTimeout(() => {
      attempt.timedOut = true;
      controller.abort();
    }, this.dependencies.timeoutMs ?? 15_000);

    // Acquire before invoking any callback or crossing an async boundary.
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
    }
  }

  private async run(
    attempt: Attempt,
    snapshot: Readonly<RoomSubmissionSnapshot>,
  ) {
    try {
      const ticket = await this.dependencies.request(
        snapshot,
        attempt.controller.signal,
      );
      attempt.ticket = ticket;

      // A response that arrives after timeout/unmount must never become the
      // active browser session. Release its server reservation instead.
      if (
        this.disposed ||
        attempt.controller.signal.aborted ||
        this.active !== attempt
      ) {
        await this.compensate(attempt, ticket);
        if (
          !this.disposed &&
          this.active === attempt &&
          attempt.timedOut
        ) {
          this.active = undefined;
          this.dependencies.onPending(false);
          this.dependencies.onError(
            new RoomSubmissionTimeoutError(snapshot.kind),
            snapshot,
          );
        }
        return;
      }

      // Persist before navigation: navigation can synchronously unmount.
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
      this.dependencies.commit(ticket, snapshot);
    } catch (error) {
      if (attempt.ticket && !attempt.committed) {
        await this.compensate(attempt, attempt.ticket);
      }
      if (this.disposed || this.active !== attempt) return;

      this.active = undefined;
      this.dependencies.onPending(false);
      this.dependencies.onError(
        attempt.timedOut
          ? new RoomSubmissionTimeoutError(snapshot.kind)
          : error,
        snapshot,
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
        // Best effort: the server also reaps abandoned waiting rooms.
      });
    return attempt.compensation;
  }
}
