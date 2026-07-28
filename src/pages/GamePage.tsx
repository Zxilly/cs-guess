import { useEffect, useReducer, useRef, useState } from "react";

import { BattleContext } from "@/components/BattleContext";
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
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useDailyChallenge } from "@/hooks/use-daily-challenge";
import {
  dailySecondsLeft,
  loadDailyProgress,
  saveDailyProgress,
  type DailyProgress,
} from "@/lib/daily-challenge";
import type { ServerDailyChallenge } from "@/lib/daily-challenge-api";
import { focusDailyResultAfterDialog } from "@/lib/daily-result-focus";
import { recordFinishedDailyRoundOnce } from "@/lib/daily-round-record";
import type { SoloLossReason } from "@/lib/solo-result-copy";
import {
  MAX_GUESSES,
  type GameMode,
  type OpponentVisibility,
} from "@/types/game";

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

const modeContent: Record<
  GameMode,
  { eyebrow: string; title: string; description: string; round: string }
> = {
  daily: {
    eyebrow: "今日神秘选手",
    title: "根据属性对比确定目标选手",
    description: "所有玩家共享今日答案，在八次机会内完成挑战。",
    round: "DAILY",
  },
  solo: {
    eyebrow: "单人练习",
    title: "根据属性线索确定目标选手",
    description: "每局随机生成目标选手，结算后可开始下一题。",
    round: "SOLO",
  },
  quick: {
    eyebrow: "实时 1v1",
    title: "竞速确定目标选手",
    description: "双方猜测同一位神秘选手，先正确猜出的玩家赢得本局。",
    round: "BO3 · ROUND 1",
  },
  room: {
    eyebrow: "好友房间",
    title: "好友房同题竞速",
    description: "房间支持 2–8 位玩家，本轮使用相同题目与尝试上限。",
    round: "ROOM · CS-207",
  },
};

interface GamePageProps {
  mode: GameMode;
}

export function GamePage({ mode }: GamePageProps) {
  const { challenge, error, retry } = useDailyChallenge();

  if (!challenge) {
    return <DailyGameLoading error={error} onRetry={retry} />;
  }

  return <DailyGame mode={mode} challenge={challenge} />;
}

function DailyGame({
  mode,
  challenge,
}: GamePageProps & { challenge: ServerDailyChallenge }) {
  const { recordRound } = useAnonymousProfile();
  const [game, dispatch] = useReducer(
    gameReducer,
    challenge,
    (value) => loadDailyProgress(value, players),
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const resultTitleRef = useRef<HTMLHeadingElement>(null);
  const recordedDailyRoundRef = useRef<string | undefined>(undefined);
  const [now, setNow] = useState(Date.now);
  const [opponentVisibility, setOpponentVisibility] =
    useState<OpponentVisibility>("hidden");

  const roomCode = "CS-207";
  const isRoomHost = false;
  const mysteryPlayer = challenge.mysteryPlayer;
  const guesses = game.guessedIds.flatMap((id) =>
    players.filter((player) => player.id === id),
  );
  const opponentGuesses: Player[] = [];
  const availablePlayers = players.filter(
    (player) => !game.guessedIds.includes(player.id),
  );
  const selectedPlayer = players.find((player) => player.id === selectedId);
  const content = modeContent[mode];
  const roundLabel = `DAILY · ROUND #${challenge.roundNumber}`;
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
  }, [game.deadline, game.status]);

  useEffect(() => {
    saveDailyProgress(game);
  }, [game]);

  useEffect(() => {
    if (mode !== "daily") return;
    recordedDailyRoundRef.current = recordFinishedDailyRoundOnce(
      recordedDailyRoundRef.current,
      game,
      challenge,
      recordRound,
    );
  }, [challenge, game, mode, recordRound]);

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

      <main className="min-w-0">
        <div className="app-game-container min-w-0">
          <header className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-6">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
                  {content.eyebrow}
                </p>
                <InfoTip
                  label={`${content.eyebrow}规则`}
                  side="right"
                  className="size-6 hover:bg-transparent hover:text-primary"
                >
                  {content.description}
                </InfoTip>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                {content.title}
              </h1>
            </div>

            <div className="shrink-0 text-right">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.08em]">
                {roundLabel}
              </p>
            </div>
          </header>

          <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
            <span className="text-xs text-muted-foreground">
              {isFinished ? "挑战结果" : "剩余时间"}
            </span>
            {isFinished ? (
              <span className="font-mono text-xs font-semibold text-primary">
                {game.status === "won" ? "挑战完成" : "挑战结束"}
              </span>
            ) : (
              <Timer
                seconds={secondsLeft}
                className="text-lg text-primary"
              />
            )}
            <span className="font-mono text-xs">
              {game.guessedIds.length} / {MAX_GUESSES}
            </span>
          </div>

          <BattleContext
            mode={mode}
            guesses={game.guessedIds.length}
            opponentGuesses={opponentGuesses.length}
            maxGuesses={MAX_GUESSES}
            roomCode={roomCode}
            isRoomHost={isRoomHost}
          />

          {isFinished ? (
            <div className="mt-6">
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
                  onSubmit={handleSubmit}
                />
              </div>

              <div className="mt-6">
                <GuessTable
                  guesses={guesses}
                  opponentGuesses={opponentGuesses}
                  opponentVisibility={opponentVisibility}
                  mysteryPlayer={mysteryPlayer}
                  mode={mode}
                  maxGuesses={MAX_GUESSES}
                  onOpponentVisibilityChange={setOpponentVisibility}
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
                <p className="font-mono">每日题目 · 上海时间刷新</p>
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
