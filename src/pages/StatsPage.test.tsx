import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchHistoryEntry } from "@/hooks/use-anonymous-profile";
import { players } from "@/data/players";

const profileState = vi.hoisted(() => ({
  completedRounds: 0,
  winRate: 0,
  averageWinningGuesses: null as number | null,
  bestGuessCount: null as number | null,
  winningGuessSampleSize: 0,
  stats: {
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
  },
  matchHistory: [] as MatchHistoryEntry[],
}));

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    completedRounds: profileState.completedRounds,
    winRate: profileState.winRate,
    averageWinningGuesses: profileState.averageWinningGuesses,
    bestGuessCount: profileState.bestGuessCount,
    winningGuessSampleSize: profileState.winningGuessSampleSize,
    profile: {
      stats: profileState.stats,
      matchHistory: profileState.matchHistory,
    },
  }),
}));

import {
  ReplayDetails,
  StatsPage,
} from "@/pages/StatsPage";
import {
  focusReplayTitle,
  resolveReplayData,
  STATS_REPLAY_CLOSE_LABEL,
} from "@/lib/stats-history-display";

function historyEntry(
  patch: Partial<MatchHistoryEntry> = {},
): MatchHistoryEntry {
  return {
    id: "ROOM1:R1",
    completedAt: "2026-07-28T01:02:03.000Z",
    result: "win",
    mode: "room",
    roomCode: "ROOM1",
    roundNumber: 1,
    bestOf: 5,
    answerId: players[0].id,
    guessIds: [players[0].id],
    opponentNames: ["对手一"],
    selfScore: 1,
    opponentScore: 0,
    ...patch,
  };
}

describe("StatsPage round semantics", () => {
  beforeEach(() => {
    profileState.completedRounds = 0;
    profileState.winRate = 0;
    profileState.averageWinningGuesses = null;
    profileState.bestGuessCount = null;
    profileState.winningGuessSampleSize = 0;
    profileState.stats = {
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
    };
    profileState.matchHistory = [];
  });

  it("does not imply losses before the first recorded round", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <StatsPage />
      </MemoryRouter>,
    );

    expect(markup).toContain("完成回合");
    expect(markup).toContain("回合胜率");
    expect(markup).toContain("最佳回合连胜");
    expect(markup).not.toContain(">0%</p>");
    expect(markup).toContain("尚无回合记录");
    expect(markup).toContain("开始今日挑战");
  });

  it("groups room rounds and provides a non-scrolling mobile structure", () => {
    profileState.completedRounds = 2;
    profileState.winRate = 50;
    profileState.stats = {
      wins: 1,
      losses: 1,
      draws: 0,
      currentStreak: 0,
      bestStreak: 1,
    };
    profileState.matchHistory = [
      historyEntry(),
      historyEntry({
        id: "ROOM1:R2",
        result: "loss",
        roundNumber: 2,
        guessIds: [],
        selfScore: 1,
        opponentScore: 1,
      }),
    ];

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <StatsPage />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-testid="stats-mobile-round-list"');
    expect(markup).toContain('class="divide-y divide-foreground/20 lg:hidden"');
    expect(markup).toContain('data-testid="stats-desktop-round-table"');
    expect(markup).toContain("房间 ROOM1");
    expect(markup).toContain("累计比分");
    expect(markup).toContain("无猜测记录");
    expect(markup).toContain("每条记录代表一个回合");
  });
});

describe("StatsPage replay details", () => {
  it("never substitutes the first catalog player for an unavailable answer", () => {
    const entry = historyEntry({
      answerId: "removed-player",
      guessIds: [],
    });

    expect(resolveReplayData(entry).answer).toBeUndefined();
    const markup = renderToStaticMarkup(<ReplayDetails entry={entry} />);
    expect(markup).toContain("本回合答案的历史数据不可用");
    expect(markup).not.toContain(players[0].nickname);
  });

  it("keeps resolved guesses visible on desktop when only the answer is unavailable", () => {
    const entry = historyEntry({
      answerId: "removed-answer",
      guessIds: [players[0].id],
    });

    const markup = renderToStaticMarkup(<ReplayDetails entry={entry} />);

    expect(markup).toContain("本回合答案的历史数据不可用");
    expect(markup).toContain(players[0].nickname);
    expect(markup).toContain(
      'data-testid="replay-compact-guess-list" class="block"',
    );
  });

  it("keeps the compact list mobile-only when the answer is available", () => {
    const markup = renderToStaticMarkup(
      <ReplayDetails entry={historyEntry()} />,
    );

    expect(markup).toContain(
      'data-testid="replay-compact-guess-list" class="sm:hidden"',
    );
  });

  it("uses a saved snapshot when a catalog player is no longer available", () => {
    const entry = historyEntry({
      answerId: "retired-player",
      answerSnapshot: {
        id: "retired-player",
        nickname: "legacy",
        name: "Legacy Player",
        team: "Archive",
        countryCode: "CN",
        age: 25,
        role: "Rifler",
        majorAppearances: 2,
      },
      guessIds: [],
    });

    expect(resolveReplayData(entry).answer?.nickname).toBe("legacy");
  });

  it("shows one zero-guess empty state instead of an eight-row guess table", () => {
    const markup = renderToStaticMarkup(
      <ReplayDetails entry={historyEntry({ guessIds: [] })} />,
    );

    expect(markup).toContain("本回合无猜测记录");
    expect(markup).not.toContain("等待猜测");
    expect(markup).not.toContain("横向滑动查看全部属性");
  });

  it("uses a Chinese close label and moves initial focus to the title", () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();

    focusReplayTitle({ preventDefault }, { focus });

    expect(STATS_REPLAY_CLOSE_LABEL).toBe("关闭对局回放");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
