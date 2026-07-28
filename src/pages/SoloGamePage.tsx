import { useEffect, useReducer, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";

import { BattleContext } from "@/components/BattleContext";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { DailyResultPanel } from "@/components/DailyResultPanel";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { ModeSidebar } from "@/components/ModeSidebar";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Timer } from "@/components/Timer";
import { players } from "@/data/players";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import {
  loadSoloProgress,
  parseSoloDifficulty,
  saveSoloDifficulty,
  saveSoloProgress,
  SOLO_DIFFICULTIES,
  soloGameReducer,
  soloMysteryPool,
  soloSecondsUntil,
  type SoloDifficulty,
} from "@/lib/solo-game";
import { focusDailyResultAfterDialog } from "@/lib/daily-result-focus";
import { recordFinishedSoloRoundOnce } from "@/lib/solo-round-record";
import { MAX_GUESSES } from "@/types/game";

export function SoloGamePage() {
  const [searchParams] = useSearchParams();
  const difficulty = parseSoloDifficulty(searchParams.get("difficulty"));

  if (!difficulty) return <Navigate to="/solo" replace />;
  return <SoloGame key={difficulty} difficulty={difficulty} />;
}

function SoloGame({ difficulty }: { difficulty: SoloDifficulty }) {
  const { profile, recordRound } = useAnonymousProfile();
  const [initialProgress] = useState(() => loadSoloProgress(difficulty));
  const [game, dispatch] = useReducer(soloGameReducer, initialProgress.state);
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [resetReason, setResetReason] = useState(
    initialProgress.resetReason,
  );
  const [now, setNow] = useState(Date.now);
  const recordedRoundRef = useRef<string | undefined>(undefined);
  const resultTitleRef = useRef<HTMLHeadingElement>(null);

  const mysteryPlayer =
    players.find((player) => player.id === game.mysteryId) ??
    soloMysteryPool(difficulty)[0];
  const difficultyOption =
    SOLO_DIFFICULTIES.find((option) => option.id === difficulty) ??
    SOLO_DIFFICULTIES[0];
  const guesses = game.guessedIds.flatMap((id) =>
    players.filter((player) => player.id === id),
  );
  const availablePlayers = players.filter(
    (player) => !game.guessedIds.includes(player.id),
  );
  const selectedPlayer = players.find((player) => player.id === selectedId);
  const isFinished = game.status !== "playing";
  const secondsLeft = soloSecondsUntil(game.deadline, now);
  const resultOpen = isFinished && !game.resultDismissed;
  const lossReason =
    game.resultReason === "timeout" ||
    game.resultReason === "attempts-exhausted"
      ? game.resultReason
      : undefined;

  useEffect(() => {
    saveSoloDifficulty(difficulty);
  }, [difficulty]);

  useEffect(() => {
    saveSoloProgress(game);
  }, [game]);

  useEffect(() => {
    if (game.status !== "playing") return;
    const update = () => {
      const current = Date.now();
      setNow(current);
      if (current >= game.deadline) dispatch({ type: "expire" });
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [game.deadline, game.status]);

  useEffect(() => {
    recordedRoundRef.current = recordFinishedSoloRoundOnce(
      recordedRoundRef.current,
      profile.recordedRounds,
      game,
      recordRound,
    );
  }, [game, profile.recordedRounds, recordRound]);

  function submitGuess(playerId = selectedId) {
    if (!playerId) return false;
    dispatch({ type: "guess", playerId });
    setSelectedId(undefined);
    return true;
  }

  function restart() {
    dispatch({ type: "restart" });
    setSelectedId(undefined);
    setSearchOpen(false);
    setResetReason(undefined);
    setNow(Date.now());
  }

  return (
    <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <ModeSidebar
        mode="solo"
        secondsLeft={secondsLeft}
        guesses={game.guessedIds.length}
        maxGuesses={MAX_GUESSES}
        status={game.status}
        roundNumber={game.roundNumber}
        bestOf={1}
        modeLabel={`单人练习 · ${difficultyOption.label}`}
        backHref="/solo"
        backLabel="难度选择"
      />

      <main className="min-w-0">
        <div className="app-game-container min-w-0">
          {resetReason === "catalog-changed" ? (
            <p
              className="mb-5 border border-foreground/20 px-4 py-3 text-sm text-muted-foreground"
              role="status"
            >
              选手目录已更新，已安全开始新的练习回合。
            </p>
          ) : resetReason === "progress-reset" ? (
            <p
              className="mb-5 border border-foreground/20 px-4 py-3 text-sm text-muted-foreground"
              role="status"
            >
              旧练习进度无法恢复，已安全开始新的练习回合。
            </p>
          ) : null}
          <header className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-6">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
                  单人练习 · {difficultyOption.label}
                </p>
                <InfoTip
                  label="单人练习规则"
                  side="right"
                  className="size-6 hover:bg-transparent hover:text-primary"
                >
                  {difficulty === "easy"
                    ? "目标来自 Major 冠军或参赛至少 5 次的知名选手。"
                    : difficulty === "full"
                      ? "目标可能是任意参加过 Major 的选手。"
                      : "目标可能来自完整选手目录，包括退役与无队伍选手。"}
                  在三分钟和八次机会内完成猜测。
                </InfoTip>
              </div>
              <h1 className="mt-3 text-balance text-[2rem] leading-[1.15] font-bold tracking-[-0.04em] sm:text-4xl">
                根据属性线索确定目标选手
              </h1>
            </div>

            <p className="shrink-0 text-right font-mono text-xs font-medium uppercase tracking-[0.08em]">
              SOLO · ROUND #{game.roundNumber}
            </p>
          </header>

          <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
            <span className="text-xs text-muted-foreground">
              {isFinished ? "练习结果" : "剩余时间"}
            </span>
            {isFinished ? (
              <span className="font-mono text-xs font-semibold text-primary">
                {game.status === "won" ? "练习完成" : "练习结束"}
              </span>
            ) : (
              <Timer seconds={secondsLeft} className="text-lg text-primary" />
            )}
            <span className="font-mono text-xs">
              {game.guessedIds.length} / {MAX_GUESSES}
            </span>
          </div>

          <BattleContext
            mode="solo"
            guesses={game.guessedIds.length}
            opponentGuesses={0}
            maxGuesses={MAX_GUESSES}
          />

          {isFinished ? (
            <div className="mt-6">
              <DailyResultPanel
                context="solo"
                outcome={game.status === "won" ? "won" : "lost"}
                attempts={game.guessedIds.length}
                maxGuesses={MAX_GUESSES}
                mysteryPlayer={mysteryPlayer}
                onPlayAgain={restart}
                titleRef={resultTitleRef}
                lossReason={lossReason}
              />
            </div>
          ) : (
            <>
              <div className="mt-6 min-w-0">
                <PlayerSearch
                  players={availablePlayers}
                  selectedPlayer={selectedPlayer}
                  open={searchOpen}
                  onOpenChange={setSearchOpen}
                  onSelect={(playerId) => {
                    setSelectedId(playerId);
                    setSearchOpen(false);
                  }}
                  onSubmit={submitGuess}
                />
              </div>

              <div className="mt-6">
                <GuessTable
                  guesses={guesses}
                  opponentGuesses={[]}
                  opponentVisibility="hidden"
                  mysteryPlayer={mysteryPlayer}
                  mode="solo"
                  maxGuesses={MAX_GUESSES}
                />
              </div>

              <div className="mt-5 flex flex-col gap-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
                <p className="font-mono">
                  {difficultyOption.poolLabel} · 结算后可继续
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      {resultOpen ? (
        <CelebrationOverlay
          context="solo"
          outcome={game.status === "won" ? "win" : "loss"}
          seriesComplete
          score={`${game.guessedIds.length} / ${MAX_GUESSES}`}
          mysteryPlayer={mysteryPlayer}
          onClose={() => dispatch({ type: "dismiss-result" })}
          onCloseAutoFocus={(event) =>
            focusDailyResultAfterDialog(event, resultTitleRef.current)
          }
          lossReason={lossReason}
        />
      ) : null}
    </div>
  );
}
