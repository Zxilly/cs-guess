import { t } from "@lingui/core/macro";
import { useEffect, useReducer, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { mutate } from "swr";
import useSWRImmutable from "swr/immutable";
import useSWRMutation from "swr/mutation";

import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { DailyResultPanel } from "@/components/DailyResultPanel";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { ModeSidebar } from "@/components/ModeSidebar";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Timer } from "@/components/Timer";
import { players } from "@/data/players";
import {
  acceptAuthoritativeProfileCompletion,
  ensureAnonymousProfileReady,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
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
import { trackEvent } from "@/lib/analytics";
import {
  completeServerSoloRound,
  createServerSoloRound,
  loadServerSoloRound,
} from "@/lib/solo-round-api";
import { maxGuessesForDifficulty } from "@/types/game";

export function SoloGamePage() {
  const [searchParams] = useSearchParams();
  const difficulty = parseSoloDifficulty(searchParams.get("difficulty"));
  const audit = import.meta.env.DEV ? searchParams.get("audit") : null;

  if (!difficulty) return <Navigate to="/solo" replace />;
  return (
    <SoloGame key={difficulty} difficulty={difficulty} audit={audit} />
  );
}

function SoloGame({
  difficulty,
  audit,
}: {
  difficulty: SoloDifficulty;
  audit: string | null;
}) {
  const { profile } = useAnonymousProfile();
  const anonymousId = profile.anonymousId;
  const syncToken = profile.syncToken;
  const [initialProgress] = useState(() => {
    const loaded = loadSoloProgress(difficulty);
    if (!import.meta.env.DEV || !audit?.startsWith("solo-")) return loaded;
    const mysteryId = soloMysteryPool(difficulty)[0]?.id ?? "donk";
    const base = {
      ...loaded.state,
      mysteryId,
      guessedIds: [] as string[],
      status: "playing" as const,
      deadline: Date.now() + 3_600_000,
      resultDismissed: false,
    };
    if (audit === "solo-won" || audit === "solo-result-panel") {
      return {
        state: {
          ...base,
          guessedIds: [mysteryId],
          status: "won" as const,
          resultReason: "guessed" as const,
          resultDismissed: audit === "solo-result-panel",
        },
      };
    }
    if (audit === "solo-lost") {
      const maxGuesses = maxGuessesForDifficulty(difficulty);
      return {
        state: {
          ...base,
          guessedIds: players
            .filter((player) => player.id !== mysteryId)
            .slice(0, maxGuesses)
            .map((player) => player.id),
          status: "lost" as const,
          resultReason: "attempts-exhausted" as const,
        },
      };
    }
    return { state: base };
  });
  const [game, dispatch] = useReducer(soloGameReducer, initialProgress.state);
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [resetReason, setResetReason] = useState(
    initialProgress.resetReason,
  );
  const [now, setNow] = useState(Date.now);
  const [authoritativeReady, setAuthoritativeReady] = useState(
    Boolean(audit),
  );
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
  const maxGuesses = maxGuessesForDifficulty(difficulty);
  const secondsLeft = soloSecondsUntil(game.deadline, now);
  const resultOpen = isFinished && !game.resultDismissed;
  const lossReason =
    game.resultReason === "timeout" ||
    game.resultReason === "attempts-exhausted"
      ? game.resultReason
      : undefined;
  const soloRoundKey = [
    "solo-round",
    anonymousId,
    difficulty,
    game.roundId,
  ] as const;
  const { data: serverRound } = useSWRImmutable(
    audit ? null : soloRoundKey,
    async () => {
      await ensureAnonymousProfileReady();
      const credentials = { anonymousId, syncToken };
      const existing = await loadServerSoloRound(
        credentials,
        game.roundId,
      );
      const round =
        existing ??
        (await createServerSoloRound(credentials, difficulty));
      void mutate(
        [
          "solo-round",
          anonymousId,
          difficulty,
          round.roundId,
        ],
        round,
        { revalidate: false },
      );
      return round;
    },
  );
  const { trigger: triggerCompletion } = useSWRMutation(
    ["solo-round-completion", anonymousId],
    async (
      _key,
      {
        arg,
      }: {
        arg: {
          roundId: string;
          guessIds: readonly string[];
          timedOut: boolean;
        };
      },
    ) => {
      const remote = await completeServerSoloRound(
        profile,
        arg.roundId,
        arg.guessIds,
        arg.timedOut,
      );
      acceptAuthoritativeProfileCompletion(remote);
      return remote;
    },
  );

  useEffect(() => {
    saveSoloDifficulty(difficulty);
  }, [difficulty]);

  useEffect(() => {
    saveSoloProgress(game);
  }, [game]);

  useEffect(() => {
    if (audit) return;
    setAuthoritativeReady(false);
    if (!serverRound) return;
    dispatch({
      type: "bind-server-round",
      round: {
        roundId: serverRound.roundId,
        roundNumber: serverRound.roundNumber,
        difficulty: serverRound.difficulty,
        mysteryId: serverRound.mysteryPlayer.id,
        deadline: serverRound.deadlineUnixMs,
      },
    });
    setNow(Date.now());
    setAuthoritativeReady(true);
  }, [audit, serverRound]);

  useEffect(() => {
    if (audit || !authoritativeReady) return;
    if (game.status !== "playing") return;
    const update = () => {
      const current = Date.now();
      setNow(current);
      if (current >= game.deadline) dispatch({ type: "expire" });
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [audit, authoritativeReady, game.deadline, game.status]);

  useEffect(() => {
    if (
      audit ||
      !authoritativeReady ||
      game.status === "playing" ||
      recordedRoundRef.current === game.roundId ||
      profile.recordedRounds.includes(game.roundId)
    ) {
      return;
    }
    recordedRoundRef.current = game.roundId;
    void triggerCompletion({
      roundId: game.roundId,
      guessIds: game.guessedIds,
      timedOut: game.resultReason === "timeout",
    })
      .catch(() => {
        recordedRoundRef.current = undefined;
      });
  }, [
    audit,
    authoritativeReady,
    game,
    profile.recordedRounds,
    triggerCompletion,
  ]);

  function submitGuess(playerId = selectedId) {
    if (!playerId || !authoritativeReady) return false;
    trackEvent("guess-submitted", {
      mode: "solo",
      attempt: game.guessedIds.length + 1,
    });
    dispatch({ type: "guess", playerId });
    setSelectedId(undefined);
    return true;
  }

  function restart() {
    setAuthoritativeReady(false);
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
        maxGuesses={maxGuesses}
        status={game.status}
        roundNumber={game.roundNumber}
        bestOf={1}
        modeLabel={t`单人练习 · ${difficultyOption.label}`}
        backHref="/solo"
        backLabel={t`难度选择`}
      />

      <main className="app-game-main">
        <div className="app-game-container min-w-0">
          {resetReason === "catalog-changed" ? (
            <p
              className="mb-5 border border-foreground/20 px-4 py-3 text-sm text-muted-foreground"
              role="status"
            >
              {t`选手目录已更新，已安全开始新的练习回合。`}
            </p>
          ) : resetReason === "progress-reset" ? (
            <p
              className="mb-5 border border-foreground/20 px-4 py-3 text-sm text-muted-foreground"
              role="status"
            >
              {t`旧练习进度无法恢复，已安全开始新的练习回合。`}
            </p>
          ) : null}
          {!isFinished ? (
            <>
              <h1 className="sr-only">{t`单人练习`}</h1>

              <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
                <span className="text-xs text-muted-foreground">
                  {t`剩余时间`}
                </span>
                <Timer seconds={secondsLeft} className="text-lg text-primary" />
                <span className="font-mono text-xs">
                  {game.guessedIds.length} / {maxGuesses}
                </span>
              </div>

            </>
          ) : null}

          {isFinished ? (
            <DailyResultPanel
              context="solo"
              outcome={game.status === "won" ? "won" : "lost"}
              attempts={game.guessedIds.length}
              maxGuesses={maxGuesses}
              mysteryPlayer={mysteryPlayer}
              onPlayAgain={restart}
              titleRef={resultTitleRef}
              lossReason={lossReason}
            />
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
                  maxGuesses={maxGuesses}
                  showProgressCount={false}
                />
              </div>

              <div className="mt-5 flex items-center text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span>{t`结果图例`}</span>
                  <InfoTip
                    label={t`查看结果图例`}
                    side="right"
                    className="size-10"
                  >
                    {t`蓝色代表完全一致，浅蓝色代表国籍同洲；国籍卡显示两国首都间的直线距离。向上箭头表示目标数值更高，向下箭头表示更低。`}
                  </InfoTip>
                </div>
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
          score={`${game.guessedIds.length} / ${maxGuesses}`}
          maxGuesses={maxGuesses}
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
