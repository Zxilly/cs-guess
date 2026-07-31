import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowCounterClockwiseIcon,
  LightningIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";
import useSWRMutation from "swr/mutation";

import { AppHeader } from "@/components/AppHeader";
import { DifficultySelector } from "@/components/DifficultySelector";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { OperationStatusDialog } from "@/components/OperationStatusDialog";
import { SeriesSelector } from "@/components/SeriesSelector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useMatchmakingQueue } from "@/hooks/use-matchmaking-queue";
import {
  ApiError,
  cancelQuickMatchByRequestId,
  cancelQuickMatch,
  createQuickMatch,
  discardQuickMatchCredentials,
  loadCredentials,
  playingCountFor,
  queueCountFor,
  readString,
  saveCredentials,
} from "@/lib/realtime";
import {
  loadQuickMatchPreferences,
  saveQuickMatchPreferences,
  type QuickMatchPreferences,
} from "@/lib/match-preferences";
import {
  QuickMatchSubmission,
  QuickMatchTimeoutError,
  type QuickMatchSnapshot,
} from "@/lib/quick-match-submission";
import {
  loadSoloDifficulty,
  parseSoloDifficulty,
  saveSoloDifficulty,
} from "@/lib/solo-game";
import { trackEvent } from "@/lib/analytics";
import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
  PartySize,
} from "@/types/game";

export function QuickMatch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const audit = import.meta.env.DEV ? searchParams.get("audit") : null;
  const existingSession = useRef(loadCredentials("quick"));
  const navigateRef = useRef(navigate);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const submission = useRef<QuickMatchSubmission | null>(null);
  const lastPreferences = useRef<QuickMatchPreferences | undefined>(undefined);
  const preferencesLoaded = useRef(false);
  if (!preferencesLoaded.current) {
    lastPreferences.current = loadQuickMatchPreferences();
    preferencesLoaded.current = true;
  }
  const identity = useAnonymousProfile();
  const profileRef = useRef(identity.profile);
  const [partySize, setPartySize] = useState<PartySize>(
    searchParams.has("players")
      ? searchParams.get("players") === "4"
        ? 4
        : 2
      : lastPreferences.current?.partySize ?? 2,
  );
  const [bestOf, setBestOf] = useState<BestOf>(() => {
    const value = Number(searchParams.get("bestOf"));
    return value === 1 || value === 3 || value === 5
      ? value
      : lastPreferences.current?.bestOf ?? 3;
  });
  const [difficulty, setDifficulty] = useState<GameDifficulty>(
    () =>
      parseSoloDifficulty(searchParams.get("difficulty")) ??
      lastPreferences.current?.difficulty ??
      loadSoloDifficulty(),
  );
  const [visibility, setVisibility] = useState<OpponentVisibility>(
    searchParams.get("visibility") === "open" ||
      searchParams.get("visibility") === "hidden"
      ? (searchParams.get("visibility") as OpponentVisibility)
      : lastPreferences.current?.visibility ?? "hidden",
  );
  const [error, setError] = useState(
    audit === "quick-error"
      ? t`加入匹配队列失败，请检查网络后重试。`
      : "",
  );
  const [submittedSettings, setSubmittedSettings] =
    useState<Readonly<QuickMatchSnapshot> | null>(() =>
      audit === "quick-submitting"
        ? {
            identityId: identity.player.id,
            visibility,
            bestOf,
            partySize,
            difficulty,
          }
        : null,
    );
  const { trigger: triggerQuickMatch, isMutating } = useSWRMutation(
    ["quick-match-command", identity.profile.anonymousId],
    async (
      _key,
      { arg }: { arg: QuickMatchSnapshot },
    ) => {
      await submission.current?.submit(arg);
    },
  );
  const pending = audit === "quick-submitting" || isMutating;
  const queue = useMatchmakingQueue();
  navigateRef.current = navigate;
  profileRef.current = identity.profile;

  useEffect(() => {
    const current = new QuickMatchSubmission({
      createClientRequestId: () => crypto.randomUUID(),
      request: (snapshot, clientRequestId, signal) =>
        createQuickMatch(
          snapshot.identityId,
          snapshot.visibility,
          snapshot.bestOf,
          snapshot.partySize,
          snapshot.difficulty,
          signal,
          clientRequestId,
          profileRef.current,
        ),
      persist: (ticket) => {
        saveCredentials(ticket, "quick");
      },
      commit: () => {
        navigateRef.current("/matching", { replace: true });
      },
      compensate: (ticket) =>
        cancelQuickMatch({
          roomCode: ticket.room_code,
          playerId: ticket.player_id,
          sessionToken: ticket.session_token,
          socketIoUrl: "/socket.io",
          mode: "quick",
        }),
      cancelByRequestId: cancelQuickMatchByRequestId,
      discard: discardQuickMatchCredentials,
      onPending: (_value, snapshot) => {
        if (snapshot) setSubmittedSettings(snapshot);
      },
      onError: (caught) => {
        setError(
          caught instanceof ApiError || caught instanceof QuickMatchTimeoutError
            ? caught.message
            : t`匹配失败，请稍后重试。`,
        );
      },
    });
    submission.current = current;
    return () => {
      current.dispose();
      if (submission.current === current) {
        submission.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const session = existingSession.current;
    if (!session) return;
    const phase = readString(session.snapshot, "phase") ?? "waiting";
    navigate(phase === "waiting" ? "/matching" : "/play/quick", {
      replace: true,
    });
  }, [navigate]);

  useEffect(() => {
    if (audit === "quick-error") return;
    setError("");
  }, [
    audit,
    partySize,
    visibility,
    difficulty,
    bestOf,
    identity.player.id,
  ]);

  function startMatching(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const settings: QuickMatchPreferences = {
      partySize,
      bestOf,
      difficulty,
      visibility,
    };
    saveQuickMatchPreferences(settings);
    lastPreferences.current = settings;
    trackEvent("matchmaking-started", settings);
    void triggerQuickMatch({
      identityId: identity.player.id,
      ...settings,
    });
  }

  function restoreLastPreferences() {
    const settings = lastPreferences.current;
    if (!settings || pending) return;
    setPartySize(settings.partySize);
    setBestOf(settings.bestOf);
    setDifficulty(settings.difficulty);
    setVisibility(settings.visibility);
    saveSoloDifficulty(settings.difficulty);
  }

  const displayedSettings =
    pending && submittedSettings
      ? submittedSettings
      : {
          identityId: identity.player.id,
          visibility,
          bestOf,
          partySize,
          difficulty,
        };
  const waitingCounts: Record<BestOf, number> = {
    1: queueCountFor(queue.counts, partySize, 1, visibility, difficulty),
    3: queueCountFor(queue.counts, partySize, 3, visibility, difficulty),
    5: queueCountFor(queue.counts, partySize, 5, visibility, difficulty),
  };
  const playingCounts: Record<BestOf, number> = {
    1: playingCountFor(queue.counts, partySize, 1, difficulty, visibility),
    3: playingCountFor(queue.counts, partySize, 3, difficulty, visibility),
    5: playingCountFor(queue.counts, partySize, 5, difficulty, visibility),
  };
  const canRestoreLastPreferences =
    Boolean(lastPreferences.current) &&
    (partySize !== lastPreferences.current?.partySize ||
      bestOf !== lastPreferences.current?.bestOf ||
      difficulty !== lastPreferences.current?.difficulty ||
      visibility !== lastPreferences.current?.visibility);

  function chooseDifficulty(nextDifficulty: GameDifficulty) {
    setDifficulty(nextDifficulty);
    saveSoloDifficulty(nextDifficulty);
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={displayedSettings.partySize === 4 ? t`4 人乱斗` : t`实时 1v1`}
        backToLobby
      />

      <main className="app-main">
        <PageIntro
          eyebrow="Quick Match"
          title={t`设置对战参数`}
          aside={
            lastPreferences.current ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-none"
                disabled={!canRestoreLastPreferences || pending}
                onClick={restoreLastPreferences}
              >
                <ArrowCounterClockwiseIcon />
                {canRestoreLastPreferences ? t`恢复上次配置` : t`已使用上次配置`}
              </Button>
            ) : undefined
          }
          help={
            <InfoTip label={t`匹配规则`} side="right" className="size-6">
              {t`只会匹配人数、赛制、题库难度和猜测可见性完全相同的玩家。`}
            </InfoTip>
          }
        />

        <Card
          asChild
          className="mt-6 mb-24 gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0 lg:mb-0"
        >
          <form onSubmit={startMatching} aria-busy={pending}>
            <section className="border-b border-foreground/20 p-5 sm:p-6">
              <PlayerIdentity
                player={identity.player}
                stats={identity.profile.stats}
                drawCredits={identity.profile.drawCredits}
                lossesTowardCredit={identity.profile.lossesTowardCredit}
                winRate={identity.winRate}
                currentPool={identity.currentPool}
                manageHref={`/identity?return=${encodeURIComponent(
                  `/quick?players=${partySize}&bestOf=${bestOf}&difficulty=${difficulty}&visibility=${visibility}`,
                )}`}
                disabled={pending}
                compact
              />
            </section>

            <div className="grid lg:grid-cols-2 lg:grid-rows-[auto_auto_auto] lg:gap-y-5">
              <section className="grid gap-y-5 border-b border-foreground/20 p-5 sm:p-6 lg:row-span-3 lg:grid-rows-[subgrid] lg:border-r lg:border-b-0">
                <h2 className="flex min-h-10 items-center text-lg font-semibold">
                  {t`对战设置`}
                </h2>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      {t`对战规模`}
                    </p>
                    <InfoTip label={t`对战规模说明`} side="right" className="size-9">
                      {t`1v1 是双人竞速；4 人乱斗会展示三位对手的独立进度。`}
                    </InfoTip>
                  </div>
                  <div
                    className="mt-2 grid grid-cols-2 border border-foreground/25"
                    role="group"
                    aria-label={t`对战规模`}
                  >
                    {([2, 4] as const).map((size) => (
                      <Button
                        key={size}
                        type="button"
                        variant={partySize === size ? "default" : "ghost"}
                        aria-pressed={partySize === size}
                        disabled={pending}
                        onClick={() => setPartySize(size)}
                        className="min-h-24 rounded-none border-r border-foreground/20 text-sm last:border-r-0"
                      >
                        {size === 4 ? <UsersThreeIcon /> : <UsersIcon />}
                        {size === 4 ? t`4 人乱斗` : "1v1"}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      {t`对手猜测`}
                    </p>
                    <InfoTip label={t`猜测可见性说明`} side="right" className="size-9">
                      {t`隐藏模式只展示命中的属性；明牌模式会显示具体猜测选手。`}
                    </InfoTip>
                  </div>
                  <div
                    className="mt-2 grid grid-cols-2 border border-foreground/25"
                    role="group"
                    aria-label={t`对手猜测可见性`}
                  >
                    {(["hidden", "open"] as const).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={visibility === option ? "default" : "ghost"}
                        aria-pressed={visibility === option}
                        disabled={pending}
                        onClick={() => setVisibility(option)}
                        className="min-h-24 rounded-none border-r border-foreground/20 text-sm last:border-r-0"
                      >
                        {option === "hidden" ? t`隐藏猜测` : t`明牌模式`}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid gap-y-5 p-5 sm:p-6 lg:row-span-3 lg:grid-rows-[subgrid]">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="flex min-h-10 items-center text-lg font-semibold">
                    {t`题库与赛制`}
                  </h2>
                  <p className="text-right font-mono text-xs text-primary">
                    {queue.live ? (
                      <>
                        {waitingCounts[bestOf]} {t`人等待`}
                        <span className="mx-1.5 text-muted-foreground">·</span>
                        {playingCounts[bestOf]} {t`人游戏中`}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <span className="size-1.5 bg-muted-foreground/40" />
                        {t`连接队列中`}
                      </span>
                    )}
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      {t`题库难度`}
                    </p>
                    <InfoTip label={t`题库难度说明`} side="right" className="size-9">
                      {t`简单为高成就选手；完整包含所有参加过 Major
                      的选手，包括退役与无队伍选手；困难包含全部选手。`}
                    </InfoTip>
                  </div>
                  <div className="mt-2">
                    <DifficultySelector
                      value={difficulty}
                      onChange={chooseDifficulty}
                      disabled={pending}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      {t`比赛赛制`}
                    </p>
                    <InfoTip label={t`赛制说明`} side="right" className="size-9">
                      {t`BO1 一局定胜负，BO3 先赢两局，BO5 先赢三局。`}
                    </InfoTip>
                  </div>
                  <div className="mt-2">
                    <SeriesSelector
                      value={bestOf}
                      onChange={setBestOf}
                      disabled={pending}
                      waitingCounts={waitingCounts}
                    />
                  </div>
                </div>
              </section>
            </div>

            <p className="sr-only" role="status" aria-live="polite">
              {pending ? t`正在加入队列，请稍候。` : ""}
            </p>

            <footer className="fixed inset-x-0 bottom-0 z-30 flex border-t border-foreground/20 bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.08)] backdrop-blur sm:justify-end lg:static lg:grid lg:grid-cols-2 lg:gap-6 lg:bg-transparent lg:p-6 lg:shadow-none lg:backdrop-blur-none">
              <Button
                ref={submitButtonRef}
                type="submit"
                className="h-12 w-full justify-between rounded-none sm:max-w-sm lg:col-start-2 lg:max-w-none"
                disabled={pending}
              >
                {pending
                  ? t`正在加入队列…`
                  : t`开始匹配`}
                {pending ? (
                  <Spinner role="presentation" aria-hidden="true" />
                ) : (
                  <LightningIcon />
                )}
              </Button>
            </footer>
          </form>
        </Card>
      </main>
      <OperationStatusDialog
        open={pending}
        kind="progress"
        eyebrow="MATCHMAKING"
        title={t`正在加入匹配队列`}
        description={t`正在确认身份与对战参数，完成后会自动进入等待页面。`}
      />
      <OperationStatusDialog
        open={Boolean(error)}
        kind="error"
        eyebrow="MATCHMAKING"
        title={t`未能加入匹配队列`}
        description={error}
        returnFocusRef={submitButtonRef}
        onOpenChange={(open) => {
          if (!open) setError("");
        }}
      >
        <Button
          type="button"
          className="w-full rounded-none sm:w-auto"
          onClick={() => setError("")}
        >
          {t`返回设置`}
        </Button>
      </OperationStatusDialog>
    </div>
  );
}
