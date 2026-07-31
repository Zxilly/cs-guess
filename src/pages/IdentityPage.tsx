import { t } from "@lingui/core/macro";
import {
  ArrowLeftIcon,
  ChartLineUpIcon,
  DiceFiveIcon,
  FireIcon,
  IdentificationCardIcon,
  LockSimpleIcon,
  ShieldCheckIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import {
  IdentityDrawDialog,
  type IdentityDrawPendingAction,
} from "@/components/IdentityDrawDialog";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PanelHeader } from "@/components/PanelHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { players, type Player } from "@/data/players";
import {
  IDENTITY_POOLS,
  playersInPool,
  type PendingIdentityDraw,
  type IdentityPoolId,
  useIdentityProfile,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";
import {
  prepareIdentityDraw,
  reconcilePendingIdentityDraw,
  restorePreparedIdentityDraw,
} from "@/lib/identity-draw";
import { displayTeamName } from "@/lib/player-display";
import { preloadPlayerImages } from "@/lib/player-image-preload";
import { normalizeIdentityReturnTo } from "@/machines/user-journey-machine";

interface DrawSequence {
  rollKey: number;
  poolId: IdentityPoolId;
  items: readonly Player[];
  winner: Player;
  winnerIndex: number;
  revealed: boolean;
}

function prepareDraw(poolId: IdentityPoolId, currentPlayerId: string) {
  return prepareIdentityDraw(playersInPool(poolId), currentPlayerId);
}

function restorePendingDraw(
  pendingDraw: PendingIdentityDraw | undefined,
): DrawSequence | null {
  if (!pendingDraw) return null;
  const restored = restorePreparedIdentityDraw(pendingDraw, players);
  if (!restored) return null;
  return {
    rollKey: 0,
    poolId: pendingDraw.poolId,
    ...restored,
    revealed: true,
  };
}

function pendingDrawRevision(pendingDraw: PendingIdentityDraw | undefined) {
  return pendingDraw
    ? `${pendingDraw.createdAt}:${pendingDraw.poolId}:${pendingDraw.winnerId}`
    : "";
}

export function IdentityPage() {
  const identity = useIdentityProfile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = normalizeIdentityReturnTo(searchParams.get("return"));
  const audit = import.meta.env.DEV ? searchParams.get("audit") : null;
  const onboarding =
    audit === "identity-onboarding" ||
    audit === "onboarding-rolling" ||
    audit === "onboarding-result" ||
    !identity.profile.identityConfirmed;
  const visiblePools = onboarding ? IDENTITY_POOLS.slice(0, 1) : IDENTITY_POOLS;
  const [draw, setDraw] = useState<DrawSequence | null>(() => {
    if (
      audit === "identity-rolling" ||
      audit === "identity-result" ||
      audit === "onboarding-rolling" ||
      audit === "onboarding-result"
    ) {
      const prepared = prepareDraw("common", identity.player.id);
      return prepared
        ? {
            rollKey: 1,
            poolId: "common",
            ...prepared,
            revealed:
              audit === "identity-result" ||
              audit === "onboarding-result",
          }
        : null;
    }
    return onboarding ? null : restorePendingDraw(identity.profile.pendingDraw);
  });
  const [drawError, setDrawError] = useState<string | null>(null);
  const [pendingDrawPool, setPendingDrawPool] =
    useState<IdentityPoolId | null>(null);
  const readyPools = useMemo(
    () =>
      new Set(
        visiblePools
          .filter(
            (pool) =>
              identity.profile.stats.wins >= pool.unlockWins &&
              identity.profile.drawCredits > 0,
          )
          .map((pool) => pool.id),
      ),
    [
      identity.profile.drawCredits,
      identity.profile.stats.wins,
      visiblePools,
    ],
  );
  const revealTimerRef = useRef<number | null>(null);
  const drawInProgressRef = useRef(false);
  const resultActionInProgressRef = useRef(false);
  const rollSequenceRef = useRef(0);
  const lastDrawRef = useRef<DrawSequence | null>(draw);
  const drawButtonRefs = useRef(
    new Map<IdentityPoolId, HTMLButtonElement>(),
  );
  const previewCreditsAppliedRef = useRef(false);
  const pendingDrawRevisionRef = useRef(
    pendingDrawRevision(identity.profile.pendingDraw),
  );
  pendingDrawRevisionRef.current = pendingDrawRevision(
    identity.profile.pendingDraw,
  );
  const setPreviewDrawCredits = identity.setPreviewDrawCredits;
  if (draw) lastDrawRef.current = draw;
  const displayedDraw = draw ?? lastDrawRef.current;
  const pendingAction: IdentityDrawPendingAction = identity.discardPending
    ? "keep"
    : identity.adoptPending
      ? "accept"
      : identity.drawPending && draw
        ? "reroll"
        : null;

  useEffect(() => {
    if (drawInProgressRef.current) return;
    if (
      audit === "identity-rolling" ||
      audit === "identity-result" ||
      audit === "onboarding-rolling" ||
      audit === "onboarding-result"
    ) {
      return;
    }
    const reconciliation = reconcilePendingIdentityDraw(
      draw,
      identity.profile.pendingDraw,
      players,
    );
    if (reconciliation.action === "keep") return;

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    drawInProgressRef.current = false;
    setDrawError(null);

    if (reconciliation.action === "close") {
      if (draw) setDraw(null);
      return;
    }

    rollSequenceRef.current += 1;
    setDraw({
      rollKey: rollSequenceRef.current,
      ...reconciliation.draw,
      poolId: reconciliation.draw.poolId as IdentityPoolId,
      revealed: true,
    });
  }, [audit, draw, identity.profile.pendingDraw, onboarding]);

  useEffect(() => {
    if (!import.meta.env.DEV || previewCreditsAppliedRef.current) return;
    const previewCredits = Number(searchParams.get("previewCredits"));
    if (!Number.isInteger(previewCredits) || previewCredits < 1) return;

    previewCreditsAppliedRef.current = true;
    setPreviewDrawCredits(Math.min(previewCredits, 20));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("previewCredits");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setPreviewDrawCredits, setSearchParams]);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  async function beginDraw(
    poolId: IdentityPoolId,
    replacedWinnerId?: string,
  ) {
    if (
      drawInProgressRef.current ||
      identity.profileMutationPending ||
      identity.profile.drawCredits < 1
    ) {
      return;
    }
    if (onboarding && poolId !== "common") return;
    drawInProgressRef.current = true;
    setPendingDrawPool(poolId);
    const startingPendingRevision = pendingDrawRevisionRef.current;
    setDrawError(null);
    rollSequenceRef.current += 1;
    let pendingDraw: PendingIdentityDraw | null | undefined;
    try {
      pendingDraw = await identity.spendDrawCredit(
        poolId,
        replacedWinnerId,
      );
    } catch {
      pendingDraw = null;
    } finally {
      setPendingDrawPool(null);
    }
    const prepared = pendingDraw
      ? restorePreparedIdentityDraw(pendingDraw, players)
      : null;
    if (!pendingDraw || !prepared) {
      drawInProgressRef.current = false;
      if (pendingDrawRevisionRef.current === startingPendingRevision) {
        setDrawError(t`抽取次数已变化，请检查网络或其他标签页后重试。`);
      }
      return;
    }
    void preloadPlayerImages(prepared.items);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setDraw({
      rollKey: rollSequenceRef.current,
      poolId,
      ...prepared,
      revealed: reducedMotion,
    });

    if (reducedMotion) {
      drawInProgressRef.current = false;
      return;
    }
    revealTimerRef.current = window.setTimeout(
      () => {
        drawInProgressRef.current = false;
        setDraw((current) =>
          current ? { ...current, revealed: true } : current,
        );
        revealTimerRef.current = null;
      },
      3100,
    );
  }

  function startDraw(poolId: IdentityPoolId) {
    if (draw) return;
    void beginDraw(poolId);
  }

  function rerollIdentity() {
    if (!draw?.revealed) return;
    void beginDraw(draw.poolId, draw.winner.id);
  }

  function changeDrawDialog(open: boolean) {
    if (onboarding) return;
    if (identity.profileMutationPending) return;
    if (!open && draw?.revealed) void keepCurrentIdentity();
  }

  async function keepCurrentIdentity() {
    if (
      !draw?.revealed ||
      resultActionInProgressRef.current ||
      identity.profileMutationPending
    ) {
      return;
    }
    resultActionInProgressRef.current = true;
    setDrawError(null);
    try {
      if (!(await identity.discardPendingDraw(draw.poolId, draw.winner.id))) {
        setDrawError(t`未能保存选择，请重试。`);
        return;
      }
      setDraw(null);
    } finally {
      resultActionInProgressRef.current = false;
    }
  }

  async function acceptDrawnIdentity() {
    if (
      !draw?.revealed ||
      resultActionInProgressRef.current ||
      identity.profileMutationPending
    ) {
      return;
    }
    resultActionInProgressRef.current = true;
    setDrawError(null);
    try {
      if (onboarding) {
        const completed = await identity.completeIdentitySetup(draw.winner.id);
        if (!completed) {
          setDrawError(t`身份保存失败，请保留此窗口并重试。`);
          return;
        }
        setDraw(null);
        navigate(returnTo, { replace: true });
        return;
      }
      const adopted = await identity.adoptIdentity(
        draw.poolId,
        draw.winner.id,
      );
      if (!adopted) {
        setDrawError(t`身份保存失败，请保留此窗口并重试。`);
        return;
      }
      setDraw(null);
    } finally {
      resultActionInProgressRef.current = false;
    }
  }

  function restoreDrawButtonFocus(event: Event) {
    event.preventDefault();
    const poolId = lastDrawRef.current?.poolId;
    if (!poolId) return;
    window.requestAnimationFrame(() => {
      drawButtonRefs.current
        .get(poolId)
        ?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={onboarding ? t`首次设置` : t`玩家身份`}
        action={
          onboarding ? undefined : (
            <Button asChild variant="outline" size="sm" className="rounded-none">
              <Link to={returnTo}>
                <ArrowLeftIcon />
                {t`返回`}
              </Link>
            </Button>
          )
        }
      />

      <main className="app-main">
        <PageIntro
          eyebrow={onboarding ? "First Run" : "Player Identity"}
          title={onboarding ? t`设置初始身份` : t`我的身份`}
          description={
            onboarding
              ? t`抽取并确认一个匿名身份，用于对战昵称与战绩记录。`
              : undefined
          }
          help={
            <InfoTip label={t`查看身份规则`} side="right" className="size-10">
              {onboarding
                ? t`初始身份从 Major 参赛池抽取，确认后会固定保留。`
                : t`胜利一局或累计输掉两局，均可获得一次抽取机会。`}
            </InfoTip>
          }
          aside={
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <Badge
                variant={
                  identity.profile.drawCredits > 0 ? "default" : "outline"
                }
                className="rounded-none px-3 py-1.5 font-mono"
              >
                <DiceFiveIcon />
                {t`${identity.profile.drawCredits} 次抽取`}
              </Badge>
              {!onboarding ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {t`胜 1 局或累计负 2 局，可获得 1 次`}
                </p>
              ) : null}
            </div>
          }
        />

        <div
          className="app-section-offset grid gap-5 lg:grid-cols-2"
          data-layout="identity-equal-columns"
        >
          <Card className="min-w-0 overflow-hidden rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
            <div className="relative flex min-h-52 flex-col justify-between p-5 sm:min-h-64 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  {onboarding ? t`待设置身份` : t`当前身份`}
                </p>
                <IdentificationCardIcon
                  className="size-8 text-primary"
                  weight="light"
                />
              </div>

              <div className="mt-6 flex min-w-0 items-end gap-5 sm:mt-10">
                {!onboarding ? (
                  <PlayerAvatar
                    player={identity.player}
                    className="size-24 shrink-0 sm:size-28"
                    eager
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="break-words text-4xl font-bold tracking-[-0.06em] sm:text-5xl">
                    {onboarding ? t`等待抽取` : identity.player.nickname}
                  </p>
                  <p className="mt-3 truncate text-sm text-muted-foreground">
                    {onboarding
                      ? t`从 Major 参赛选手中抽取固定匿名身份`
                      : `${countryNameZh(identity.player.countryCode)} · ${displayTeamName(identity.player.team)}`}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-9">
                <Badge variant="outline" className="rounded-none font-mono">
                  {onboarding
                    ? t`Major 参赛池`
                    : IDENTITY_POOLS.find(
                        (pool) => pool.id === identity.currentPool,
                      )?.label}
                </Badge>
              </div>
            </div>

            {onboarding ? (
              <div className="border-t border-foreground/20 px-5 py-4 text-xs text-muted-foreground">
                {t`身份确认后将持续用于后续对局。`}
              </div>
            ) : (
              <div className="grid grid-cols-3 border-t border-foreground/20">
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrophyIcon />
                    {t`战绩`}
                  </p>
                  <p className="mt-1 font-mono text-xs leading-5 font-semibold sm:text-sm">
                    {identity.profile.stats.wins}{t`胜`}{" "}
                    {identity.profile.stats.losses}{t`负`}{" "}
                    {identity.profile.stats.draws}{t`平`}
                  </p>
                </div>
                <div className="border-x border-foreground/20 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ChartLineUpIcon />
                    {t`胜率`}
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.winRate}%
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FireIcon />
                    {t`连胜`}
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.profile.stats.currentStreak} {t`连胜`}
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card className="min-w-0 gap-0 rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
            <PanelHeader
              title={onboarding ? t`初始选手池` : t`选择选手池`}
              icon={<DiceFiveIcon className="size-5 text-primary" />}
              action={
                <InfoTip label={t`查看抽取说明`} side="left" className="size-10">
                  <p>
                    {onboarding
                      ? t`首次只能从 Major 参赛池抽取，确认后身份会固定保留。`
                      : t`抽取消耗一次机会；结果可使用、保留当前身份或继续重抽。`}
                  </p>
                  <p className="mt-1">
                    <strong>{t`Major 参赛池：`}</strong>{t`参加过 1–4 次且未夺冠。`}
                  </p>
                  <p className="mt-1">
                    <strong>{t`Major 资深池：`}</strong>{t`参加过至少 5 次且未夺冠。`}
                  </p>
                  <p className="mt-1">
                    <strong>{t`Major 冠军池：`}</strong>{t`至少赢得过一次冠军。`}
                  </p>
                </InfoTip>
              }
            />

            {!draw && drawError ? (
              <p
                className="border-b border-foreground/20 px-5 py-3 text-sm text-destructive"
                role="alert"
              >
                {drawError}
              </p>
            ) : null}

            <div className="grid flex-1 auto-rows-fr">
              {visiblePools.map((pool) => {
                const unlocked =
                  identity.profile.stats.wins >= pool.unlockWins;
                const canDraw =
                  unlocked &&
                  identity.profile.drawCredits > 0 &&
                  !draw &&
                  !identity.profileMutationPending &&
                  readyPools.has(pool.id);
                const requestingDraw = pendingDrawPool === pool.id;

                return (
                  <div
                    key={pool.id}
                    className="grid min-w-0 gap-4 border-b border-foreground/20 p-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,auto)] sm:items-center"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {unlocked ? (
                        <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                      ) : (
                        <LockSimpleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{pool.label}</p>
                          {!onboarding && pool.id === identity.currentPool ? (
                            <span className="border border-primary px-1.5 py-0.5 font-mono text-xs text-primary">
                              {t`当前身份池`}
                            </span>
                          ) : unlocked ? (
                            <span className="border border-foreground/25 px-1.5 py-0.5 font-mono text-xs text-foreground">
                              {t`已解锁`}
                            </span>
                          ) : null}
                        </div>
                        {!unlocked ? (
                          <p className="mt-1 font-mono text-xs text-foreground">
                            {t`再胜`} {pool.unlockWins - identity.profile.stats.wins}{" "}
                            {t`场解锁`}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {unlocked && !draw ? (
                      <Button
                        ref={(node) => {
                          if (node) {
                            drawButtonRefs.current.set(pool.id, node);
                          } else {
                            drawButtonRefs.current.delete(pool.id);
                          }
                        }}
                        type="button"
                        size="sm"
                        variant={canDraw ? "default" : "outline"}
                        className="app-control h-12 min-w-0 rounded-none px-3 sm:min-w-28"
                        aria-disabled={!canDraw}
                        disabled={identity.profileMutationPending}
                        aria-busy={requestingDraw}
                        onClick={() => {
                          if (canDraw) startDraw(pool.id);
                        }}
                      >
                        {requestingDraw ? (
                          <>
                            <Spinner aria-hidden="true" />
                            {t`正在请求…`}
                          </>
                        ) : canDraw
                          ? onboarding
                            ? t`抽取初始身份`
                            : t`抽取 · 消耗 1 次`
                          : identity.profile.drawCredits < 1
                            ? t`抽取 · 暂无机会`
                            : t`抽取 · 正在准备`}
                      </Button>
                    ) : (
                      <span className="min-w-0 text-sm text-muted-foreground sm:min-w-28 sm:text-right">
                        {draw
                          ? t`抽取中`
                          : !unlocked
                            ? t`${pool.unlockWins} 胜解锁`
                            : identity.profile.drawCredits < 1
                              ? t`暂无机会`
                              : t`正在准备头像`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </main>

      {displayedDraw ? (
        <IdentityDrawDialog
          open={Boolean(draw)}
          poolLabel={
            IDENTITY_POOLS.find((pool) => pool.id === displayedDraw.poolId)
              ?.label ?? ""
          }
          rollKey={displayedDraw.rollKey}
          items={displayedDraw.items}
          winner={displayedDraw.winner}
          winnerIndex={displayedDraw.winnerIndex}
          revealed={displayedDraw.revealed}
          errorMessage={drawError}
          remainingCredits={onboarding ? 0 : identity.profile.drawCredits}
          allowKeepCurrent={!onboarding}
          allowReroll={!onboarding}
          rerollReady={readyPools.has(displayedDraw.poolId)}
          pendingAction={pendingAction}
          acceptLabel={
            onboarding
              ? returnTo === "/"
                ? t`确认身份并进入大厅`
                : t`确认身份并继续`
              : t`使用新身份`
          }
          onOpenChange={changeDrawDialog}
          onKeep={() => void keepCurrentIdentity()}
          onReroll={rerollIdentity}
          onAccept={() => void acceptDrawnIdentity()}
          onCloseAutoFocus={
            onboarding ? undefined : restoreDrawButtonFocus
          }
        />
      ) : null}
    </div>
  );
}
