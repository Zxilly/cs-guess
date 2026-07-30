import { useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { DailyGameLoading } from "@/components/DailyGameLoading";
import { DailyResultPanel } from "@/components/DailyResultPanel";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { ModeSidebar } from "@/components/ModeSidebar";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Timer } from "@/components/Timer";
import {
  players,
  type Player,
} from "@/data/players";
import {
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import { useDailyChallenge } from "@/hooks/use-daily-challenge";
import {
  dailySecondsLeft,
  loadDailyProgress,
  saveDailyProgress,
  type DailyProgress,
} from "@/lib/daily-challenge";
import {
  type ServerDailyChallenge,
} from "@/lib/daily-challenge-api";
import { focusDailyResultAfterDialog } from "@/lib/daily-result-focus";
import type { SoloLossReason } from "@/lib/solo-result-copy";
import { MAX_GUESSES, type GameMode } from "@/types/game";

type GameState = DailyProgress;

type GameAction =
  | { type: "guess"; playerId: string; mysteryId: string; now: number }
  | { type: "expire" };

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "guess": {
      if (
        state.status !== "playing" ||
        state.guessedIds.includes(action.playerId)
      ) {
        return state;
      }

      const guessedIds = [...state.guessedIds, action.playerId];
      const status =
        action.playerId === action.mysteryId
          ? "won"
          : guessedIds.length >= MAX_GUESSES
            ? "lost"
            : "playing";

      return {
        ...state,
        deadline: state.deadline ?? action.now + 180_000,
        guessedIds,
        status,
      };
    }

    case "expire":
      return state.status === "playing"
        ? { ...state, status: "lost" }
        : state;
  }
}

interface GamePageProps {
  mode: GameMode;
}

export function GamePage({ mode }: GamePageProps) {
  const [searchParams] = useSearchParams();
  const audit = import.meta.env.DEV ? searchParams.get("audit") : null;
  const {
    challenge,
    error,
    retry,
    submitCompletion,
  } = useDailyChallenge();

  if (audit === "daily-loading") {
    return <DailyGameLoading />;
  }
  if (audit === "daily-error") {
    return (
      <DailyGameLoading
        error={new Error("今日题目加载失败，请检查网络后重试。")}
        onRetry={() => undefined}
      />
    );
  }
  if (!challenge) {
    return <DailyGameLoading error={error} onRetry={retry} />;
  }

  return (
    <DailyGame
      mode={mode}
      challenge={challenge}
      audit={audit}
      submitCompletion={submitCompletion}
    />
  );
}

function DailyGame({
  mode,
  challenge,
  audit,
  submitCompletion,
}: GamePageProps & {
  challenge: ServerDailyChallenge;
  audit: string | null;
  submitCompletion: (
    guessIds: readonly string[],
    timedOut: boolean,
  ) => Promise<unknown>;
}) {
  const { profile } = useAnonymousProfile();
  const [game, dispatch] = useReducer(
    gameReducer,
    challenge,
    (value) => {
      const loaded = loadDailyProgress(value, players);
      if (!import.meta.env.DEV || !audit?.startsWith("daily-")) {
        return loaded;
      }
      if (audit === "daily-won" || audit === "daily-result-panel") {
        return {
          ...loaded,
          guessedIds: [value.mysteryPlayer.id],
          status: "won",
          deadline: Date.now() + 3_600_000,
        } satisfies DailyProgress;
      }
      if (audit === "daily-lost") {
        return {
          ...loaded,
          guessedIds: players
            .filter((player) => player.id !== value.mysteryPlayer.id)
            .slice(0, MAX_GUESSES)
            .map((player) => player.id),
          status: "lost",
          deadline: Date.now() + 3_600_000,
        } satisfies DailyProgress;
      }
      return {
        ...loaded,
        guessedIds: [],
        status: "playing",
        deadline: Date.now() + 3_600_000,
      } satisfies DailyProgress;
    },
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(
    audit === "daily-result-panel",
  );
  const resultTitleRef = useRef<HTMLHeadingElement>(null);
  const recordedDailyRoundRef = useRef<string | undefined>(undefined);
  const [now, setNow] = useState(Date.now);
  const mysteryPlayer = challenge.mysteryPlayer;
  const guesses = game.guessedIds.flatMap((id) =>
    players.filter((player) => player.id === id),
  );
  const opponentGuesses: Player[] = [];
  const availablePlayers = players.filter(
    (player) => !game.guessedIds.includes(player.id),
  );
  const selectedPlayer = players.find((player) => player.id === selectedId);
  const isFinished = game.status !== "playing";
  const resultOpen = isFinished && !resultDismissed;
  const secondsLeft = dailySecondsLeft(game, now);
  const lossReason: SoloLossReason | undefined =
    game.status !== "lost"
      ? undefined
      : game.guessedIds.length >= MAX_GUESSES
        ? "attempts-exhausted"
        : "timeout";

  useEffect(() => {
    if (audit) return;
    if (game.status !== "playing" || game.deadline === null) return;
    const deadline = game.deadline;
    const update = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) dispatch({ type: "expire" });
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [audit, game.deadline, game.status]);

  useEffect(() => {
    saveDailyProgress(game);
  }, [game]);

  useEffect(() => {
    if (audit || mode !== "daily" || game.status === "playing") return;
    const roundId = `daily:${challenge.date}`;
    if (
      recordedDailyRoundRef.current === roundId ||
      profile.recordedRounds.includes(roundId)
    ) {
      return;
    }
    recordedDailyRoundRef.current = roundId;
    void submitCompletion(
      game.guessedIds,
      game.status === "lost" && game.guessedIds.length < MAX_GUESSES,
    )
      .catch(() => {
        recordedDailyRoundRef.current = undefined;
      });
  }, [
    audit,
    challenge.date,
    game.guessedIds,
    game.status,
    mode,
    profile.recordedRounds,
    submitCompletion,
  ]);

  function handleSubmit(playerId = selectedId) {
    if (!playerId) return false;

    dispatch({
      type: "guess",
      playerId,
      mysteryId: mysteryPlayer.id,
      now: Date.now(),
    });
    setSelectedId(undefined);
    return true;
  }

  return (
    <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <ModeSidebar
        mode={mode}
        secondsLeft={secondsLeft}
        guesses={game.guessedIds.length}
        maxGuesses={MAX_GUESSES}
        status={game.status}
        roundNumber={challenge.roundNumber}
        bestOf={1}
      />

      <main className="app-game-main">
        <div className="app-game-container min-w-0">
          {!isFinished ? (
            <>
              <h1 className="sr-only">今日挑战</h1>

              <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
                <span className="text-xs text-muted-foreground">
                  剩余时间
                </span>
                <Timer
                  seconds={secondsLeft}
                  className="text-lg text-primary"
                />
                <span className="font-mono text-xs">
                  {game.guessedIds.length} / {MAX_GUESSES}
                </span>
              </div>
            </>
          ) : null}

          {isFinished ? (
            <div>
              <DailyResultPanel
                outcome={game.status === "won" ? "won" : "lost"}
                attempts={game.guessedIds.length}
                maxGuesses={MAX_GUESSES}
                mysteryPlayer={mysteryPlayer}
                titleRef={resultTitleRef}
                lossReason={lossReason}
              />
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <PlayerSearch
                  players={availablePlayers}
                  selectedPlayer={selectedPlayer}
                  open={searchOpen}
                  onOpenChange={setSearchOpen}
                  onSelect={(playerId) => {
                    setSelectedId(playerId);
                    setSearchOpen(false);
                  }}
                  onSubmit={handleSubmit}
                />
              </div>

              <div className="mt-6">
                <GuessTable
                  guesses={guesses}
                  opponentGuesses={opponentGuesses}
                  opponentVisibility="hidden"
                  mysteryPlayer={mysteryPlayer}
                  mode={mode}
                  maxGuesses={MAX_GUESSES}
                  showProgressCount={false}
                />
              </div>

              <div className="mt-5 flex items-center text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span>结果图例</span>
                  <InfoTip
                    label="查看结果图例"
                    side="right"
                    className="size-10"
                  >
                    蓝色代表完全一致，浅蓝色代表国籍同洲；国籍卡显示两国首都间的直线距离。向上箭头表示目标数值更高，向下箭头表示更低。
                  </InfoTip>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      {resultOpen ? (
        <CelebrationOverlay
          context="daily"
          outcome={game.status === "won" ? "win" : "loss"}
          seriesComplete
          score={`${game.guessedIds.length} / ${MAX_GUESSES}`}
          mysteryPlayer={mysteryPlayer}
          lossReason={lossReason}
          onClose={() => setResultDismissed(true)}
          onCloseAutoFocus={(event) =>
            focusDailyResultAfterDialog(event, resultTitleRef.current)
          }
        />
      ) : null}
    </div>
  );
}
