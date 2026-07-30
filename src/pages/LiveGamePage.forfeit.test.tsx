/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveGamePage } from "@/pages/LiveGamePage";

const mocks = vi.hoisted(() => ({
  battleProps: null as Record<string, unknown> | null,
  guessTableProps: null as Record<string, unknown> | null,
  searchProps: null as Record<string, unknown> | null,
  realtime: {
    connection: "connected",
    snapshot: {} as Record<string, unknown>,
    events: [] as Array<Record<string, unknown>>,
    error: "",
    retry: vi.fn(),
    close: vi.fn(),
    setError: vi.fn(),
    send: vi.fn(() => true),
  },
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({ refreshProfile: vi.fn() }),
}));

vi.mock("@/hooks/use-realtime-room", () => ({
  useRealtimeRoom: () => mocks.realtime,
}));

vi.mock("@/components/BattleContext", () => ({
  BattleContext: (props: Record<string, unknown>) => {
    mocks.battleProps = props;
    return <div data-testid="battle-context" />;
  },
}));

vi.mock("@/components/GuessTable", () => ({
  GuessTable: (props: Record<string, unknown>) => {
    mocks.guessTableProps = props;
    return <div data-testid="guess-table" />;
  },
}));

vi.mock("@/components/PlayerSearch", () => ({
  PlayerSearch: (props: Record<string, unknown>) => {
    mocks.searchProps = props;
    return <div data-testid="player-search" />;
  },
}));

vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => null,
}));

vi.mock("@/components/InfoTip", () => ({
  InfoTip: ({ children }: { children: React.ReactNode }) => (
    <span hidden>{children}</span>
  ),
}));

let container: HTMLDivElement;
let root: Root;

const player = (
  id: string,
  seat: number,
  forfeitedThisRound = false,
) => ({
  player_id: id,
  seat_index: seat,
  display_name: id === "self" ? "donk" : `opponent-${seat}`,
  connected: true,
  forfeited_this_round: forfeitedThisRound,
  guess_count: 0,
  score: 0,
});

function playingSnapshot(
  players = [player("self", 0), player("opponent-1", 1)],
) {
  return {
    seq: 10,
    phase: "playing",
    room_code: "CS-888888",
    self_player_id: "self",
    host_player_id: "self",
    max_players: players.length,
    max_guesses: 8,
    best_of: 3,
    difficulty: "hard",
    visibility: "hidden",
    round_number: 1,
    deadline_unix_ms: Date.now() + 120_000,
    players,
    own_guesses: [],
    opponent_progress: [],
  };
}

function storeSession() {
  sessionStorage.setItem(
    "cs-guess:realtime-session",
    JSON.stringify({
      credentials: {
        roomCode: "CS-888888",
        playerId: "self",
        sessionToken: "secret-token",
        socketIoUrl: "/socket.io",
        mode: "room",
      },
      snapshot: mocks.realtime.snapshot,
      startedAt: Date.now(),
    }),
  );
}

function renderPage() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/play/room"]}>
        <LiveGamePage mode="room" />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  sessionStorage.clear();
  mocks.realtime.connection = "connected";
  mocks.realtime.snapshot = playingSnapshot();
  mocks.realtime.events = [];
  mocks.realtime.error = "";
  mocks.battleProps = null;
  mocks.guessTableProps = null;
  mocks.searchProps = null;
  storeSession();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LiveGamePage current-round eligibility", () => {
  it("keeps a reconnected forfeited player online while disabling guesses with a clear reason", () => {
    mocks.realtime.snapshot = playingSnapshot([
      player("self", 0, true),
      player("opponent-1", 1),
    ]);
    renderPage();

    expect(container.textContent).toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(true);
    expect(mocks.battleProps?.selfPresenceLabel).toBe(
      "在线 · 本轮已判负",
    );
  });

  it.each([
    ["connecting", "正在连接"],
    ["reconnecting", "正在重连"],
    ["offline", "离线"],
  ])(
    "prioritizes the local %s transport over a cached forfeit presence",
    (connection, expectedPresence) => {
      mocks.realtime.connection = connection;
      mocks.realtime.snapshot = playingSnapshot([
        player("self", 0, true),
        player("opponent-1", 1),
      ]);
      renderPage();

      expect(mocks.battleProps?.selfPresenceLabel).toBe(expectedPresence);
      const participants = mocks.battleProps?.participants as
        | Array<Record<string, unknown>>
        | undefined;
      if (participants) {
        expect(participants[0]?.presenceLabel).toBe(expectedPresence);
      }
      expect(mocks.battleProps?.selfPresenceLabel).not.toContain(
        "在线 · 本轮已判负",
      );
    },
  );

  it("shows another forfeited player's authoritative state on its stable seat and progress board", () => {
    mocks.realtime.snapshot = playingSnapshot([
      player("self", 0),
      player("opponent-1", 1),
      player("opponent-2", 2, true),
      player("opponent-3", 3),
    ]);
    renderPage();

    const participants = mocks.battleProps?.participants as Array<
      Record<string, unknown>
    >;
    expect(participants[2]).toMatchObject({
      playerId: "opponent-2",
      connected: true,
      presenceLabel: "在线 · 本轮已判负",
    });
    const opponents = mocks.guessTableProps?.opponents as Array<
      Record<string, unknown>
    >;
    expect(opponents[1]).toMatchObject({
      id: "opponent-2",
      forfeitedThisRound: true,
    });
    expect(mocks.searchProps?.disabled).toBe(false);
  });

  it("applies the live forfeit event, then restores eligibility on the next round event", () => {
    mocks.realtime.events = [
      {
        type: "player_round_forfeited",
        seq: 11,
        player_id: "self",
        round_number: 1,
      },
    ];
    renderPage();
    expect(container.textContent).toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(true);

    mocks.realtime.events = [
      ...mocks.realtime.events,
      {
        type: "round_started",
        seq: 12,
        round_number: 2,
        deadline_unix_ms: Date.now() + 120_000,
      },
    ];
    renderPage();
    expect(container.textContent).not.toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(false);
    expect(mocks.battleProps?.selfPresenceLabel).toBe("在线");
  });

  it("uses round_forfeited command errors as a synchronized UI fallback", () => {
    mocks.realtime.events = [
      {
        type: "error",
        seq: 11,
        code: "round_forfeited",
        message: "the reconnect window expired for this round",
      },
    ];
    renderPage();

    expect(container.textContent).toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(true);
  });

  it("scopes a round_forfeited error to R1 and restores guessing after round_started R2", () => {
    mocks.realtime.events = [
      {
        type: "error",
        seq: 11,
        code: "round_forfeited",
        message: "the reconnect window expired for this round",
      },
      {
        type: "round_started",
        seq: 12,
        round_number: 2,
        deadline_unix_ms: Date.now() + 120_000,
      },
    ];
    renderPage();

    expect(container.textContent).not.toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(false);
    expect(mocks.battleProps?.selfPresenceLabel).toBe("在线");
  });

  it("keeps a current-round error authoritative even when it explicitly carries the round", () => {
    mocks.realtime.events = [
      {
        type: "round_started",
        seq: 11,
        round_number: 2,
        deadline_unix_ms: Date.now() + 120_000,
      },
      {
        type: "error",
        seq: 12,
        code: "round_forfeited",
        round_number: 2,
        message: "the reconnect window expired for this round",
      },
    ];
    renderPage();

    expect(container.textContent).toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(true);
  });

  it("does not revive an old forfeit error after a refreshed snapshot advances its seq", () => {
    mocks.realtime.snapshot = {
      ...playingSnapshot(),
      seq: 20,
      round_number: 2,
    };
    mocks.realtime.events = [
      {
        type: "error",
        seq: 11,
        code: "round_forfeited",
        message: "the reconnect window expired for this round",
      },
    ];
    renderPage();

    expect(container.textContent).not.toContain("本轮已判负，等待下一轮");
    expect(mocks.searchProps?.disabled).toBe(false);
  });
});
