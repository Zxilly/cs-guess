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
import { IdentityDrawDialog } from "@/components/IdentityDrawDialog";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PanelHeader } from "@/components/PanelHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { players, type Player } from "@/data/players";
import {
  IDENTITY_POOLS,
  playersInPool,
  type PendingIdentityDraw,
  type IdentityPoolId,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";
import {
  prepareIdentityDraw,
  reconcilePendingIdentityDraw,
  restorePreparedIdentityDraw,
} from "@/lib/identity-draw";
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

interface PreparedDraw {
  forPlayerId: string;
  items: readonly Player[];
  winner: Player;
  winnerIndex: number;
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
  const identity = useAnonymousProfile();
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
  const [readyPools, setReadyPools] = useState<Set<IdentityPoolId>>(
    () => new Set(),
  );
  const [prepareVersion, setPrepareVersion] = useState(0);
  const revealTimerRef = useRef<number | null>(null);
  const drawInProgressRef = useRef(false);
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
  const preparedDrawsRef = useRef(
    new Map<IdentityPoolId, PreparedDraw>(),
  );
  const setPreviewDrawCredits = identity.setPreviewDrawCredits;
  const preparedOnboardingDraw = useMemo(
    () =>
      onboarding ? prepareDraw("common", identity.player.id) : null,
    [identity.player.id, onboarding],
  );
  if (draw) lastDrawRef.current = draw;
  const displayedDraw = draw ?? lastDrawRef.current;

  useEffect(() => {
    if (!preparedOnboardingDraw) return;
    const controller = new AbortController();
    void preloadPlayerImages(preparedOnboardingDraw.items, {
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [preparedOnboardingDraw]);

  useEffect(() => {
    if (onboarding) return;
    const controller = new AbortController();
    const newlyPreparedImages: Player[] = [];
    const cachedImages: Player[] = [];
    const nextReadyPools = new Set<IdentityPoolId>();

    for (const pool of IDENTITY_POOLS) {
      if (
        identity.profile.stats.wins < pool.unlockWins ||
        identity.profile.drawCredits < 1
      ) {
        preparedDrawsRef.current.delete(pool.id);
        continue;
      }
      let cached = preparedDrawsRef.current.get(pool.id);
      if (cached?.forPlayerId !== identity.player.id) {
        const prepared = prepareDraw(pool.id, identity.player.id);
        if (!prepared) continue;
        cached = {
          forPlayerId: identity.player.id,
          ...prepared,
        };
        preparedDrawsRef.current.set(pool.id, cached);
        newlyPreparedImages.push(...prepared.items);
      } else {
        cachedImages.push(...cached.items);
      }
      nextReadyPools.add(pool.id);
    }
    setReadyPools(nextReadyPools);

    const imagesToPreload = [
      ...newlyPreparedImages,
      ...cachedImages,
    ];
    if (imagesToPreload.length > 0) {
      void preloadPlayerImages(imagesToPreload, {
        signal: controller.signal,
      });
    }

    return () => controller.abort();
  }, [
    identity.player.id,
    identity.profile.drawCredits,
    identity.profile.stats.wins,
    onboarding,
    prepareVersion,
  ]);

  useEffect(() => {
    if (onboarding) return;
    if (audit === "identity-rolling" || audit === "identity-result") {
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
    if (drawInProgressRef.current || identity.profile.drawCredits < 1) return;
    if (onboarding && poolId !== "common") return;
    const prepared =
      onboarding && poolId === "common"
        ? preparedOnboardingDraw
        : preparedDrawsRef.current.get(poolId);
    if (
      !prepared ||
      (!onboarding &&
        (!("forPlayerId" in prepared) ||
          prepared.forPlayerId !== identity.player.id))
    ) {
      return;
    }

    drawInProgressRef.current = true;
    const startingPendingRevision = pendingDrawRevisionRef.current;
    setDrawError(null);
    rollSequenceRef.current += 1;
    if (!onboarding) {
      const pendingDraw: PendingIdentityDraw = {
        poolId,
        itemIds: prepared.items.map((player) => player.id),
        winnerId: prepared.winner.id,
        winnerIndex: prepared.winnerIndex,
        createdAt: Date.now(),
      };
      const spent = await identity.spendDrawCredit(
        poolId,
        pendingDraw,
        replacedWinnerId,
      );
      if (!spent) {
        drawInProgressRef.current = false;
        if (pendingDrawRevisionRef.current === startingPendingRevision) {
          setDrawError("抽取次数已变化，请检查其他标签页后重试。");
        }
        return;
      }
      preparedDrawsRef.current.delete(poolId);
      setReadyPools((current) => {
        const next = new Set(current);
        next.delete(poolId);
        return next;
      });
      setPrepareVersion((current) => current + 1);
    }
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
    if (!open && draw?.revealed) keepCurrentIdentity();
  }

  function keepCurrentIdentity() {
    if (!draw?.revealed) return;
    if (
      !identity.discardPendingDraw(draw.poolId, draw.winner.id)
    ) {
      setDrawError("未能保存选择，请重试。");
      return;
    }
    setDraw(null);
    setDrawError(null);
  }

  function acceptDrawnIdentity() {
    if (!draw?.revealed) return;
    if (onboarding) {
      const completed = identity.completeIdentitySetup(draw.winner.id);
      if (!completed) return;
      setDraw(null);
      navigate(returnTo, { replace: true });
      return;
    }
    const adopted = identity.adoptIdentity(draw.poolId, draw.winner.id);
    if (!adopted) {
      setDrawError("身份保存失败，请保留此窗口并重试。");
      return;
    }
    setDraw(null);
    setDrawError(null);
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
        subtitle={onboarding ? "首次设置" : "玩家身份"}
        action={
          onboarding ? undefined : (
            <Button asChild variant="outline" size="sm" className="rounded-none">
              <Link to={returnTo}>
                <ArrowLeftIcon />
                返回
              </Link>
            </Button>
          )
        }
      />

      <main className="app-main">
        <PageIntro
          eyebrow={onboarding ? "First Run" : "Player Identity"}
          title={onboarding ? "设置初始身份" : "我的身份"}
          description={
            onboarding
              ? "抽取并确认一个匿名身份，用于对战昵称与战绩记录。"
              : undefined
          }
          help={
            <InfoTip label="查看身份规则" side="right" className="size-10">
              {onboarding
                ? "初始身份从 Major 参赛池抽取，确认后会固定保留。"
                : "胜利一局或累计输掉两局，均可获得一次抽取机会。"}
            </InfoTip>
          }
          aside={
            <Badge
              variant={identity.profile.drawCredits > 0 ? "default" : "outline"}
              className="rounded-none px-3 py-1.5 font-mono"
            >
              <DiceFiveIcon />
              {identity.profile.drawCredits} 次抽取
            </Badge>
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
                  {onboarding ? "待设置身份" : "当前身份"}
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
                    {onboarding ? "等待抽取" : identity.player.nickname}
                  </p>
                  <p className="mt-3 truncate text-sm text-muted-foreground">
                    {onboarding
                      ? "从 Major 参赛选手中抽取固定匿名身份"
                      : `${countryNameZh(identity.player.countryCode)} · ${identity.player.team}`}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-9">
                <Badge variant="outline" className="rounded-none font-mono">
                  {onboarding
                    ? "Major 参赛池"
                    : IDENTITY_POOLS.find(
                        (pool) => pool.id === identity.currentPool,
                      )?.label}
                </Badge>
              </div>
            </div>

            {onboarding ? (
              <div className="border-t border-foreground/20 px-5 py-4 text-xs text-muted-foreground">
                身份确认后将持续用于后续对局。
              </div>
            ) : (
              <div className="grid grid-cols-3 border-t border-foreground/20">
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrophyIcon />
                    战绩
                  </p>
                  <p className="mt-1 font-mono text-xs leading-5 font-semibold sm:text-sm">
                    {identity.profile.stats.wins}胜{" "}
                    {identity.profile.stats.losses}负{" "}
                    {identity.profile.stats.draws}平
                  </p>
                </div>
                <div className="border-x border-foreground/20 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ChartLineUpIcon />
                    胜率
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.winRate}%
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FireIcon />
                    连胜
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.profile.stats.currentStreak} 连胜
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card className="min-w-0 gap-0 rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
            <PanelHeader
              title={onboarding ? "初始选手池" : "选择选手池"}
              icon={<DiceFiveIcon className="size-5 text-primary" />}
              action={
                <InfoTip label="查看抽取说明" side="left" className="size-10">
                  <p>
                    {onboarding
                      ? "首次只能从 Major 参赛池抽取，确认后身份会固定保留。"
                      : "抽取消耗一次机会；结果可使用、保留当前身份或继续重抽。"}
                  </p>
                  <p className="mt-1">
                    <strong>Major 参赛池：</strong>参加过 1–4 次且未夺冠。
                  </p>
                  <p className="mt-1">
                    <strong>Major 资深池：</strong>参加过至少 5 次且未夺冠。
                  </p>
                  <p className="mt-1">
                    <strong>Major 冠军池：</strong>至少赢得过一次冠军。
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
                  (onboarding ||
                    (readyPools.has(pool.id) &&
                      preparedDrawsRef.current.get(pool.id)?.forPlayerId ===
                        identity.player.id));

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
                              当前身份池
                            </span>
                          ) : unlocked ? (
                            <span className="border border-foreground/25 px-1.5 py-0.5 font-mono text-xs text-foreground">
                              已解锁
                            </span>
                          ) : null}
                        </div>
                        {!unlocked ? (
                          <p className="mt-1 font-mono text-xs text-foreground">
                            再胜 {pool.unlockWins - identity.profile.stats.wins}{" "}
                            场解锁
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
                        onClick={() => {
                          if (canDraw) startDraw(pool.id);
                        }}
                      >
                        {canDraw
                          ? onboarding
                            ? "抽取初始身份"
                            : "抽取 · 消耗 1 次"
                          : identity.profile.drawCredits < 1
                            ? "抽取 · 暂无机会"
                            : "抽取 · 正在准备"}
                      </Button>
                    ) : (
                      <span className="min-w-0 text-sm text-muted-foreground sm:min-w-28 sm:text-right">
                        {draw
                          ? "抽取中"
                          : !unlocked
                            ? `${pool.unlockWins} 胜解锁`
                            : identity.profile.drawCredits < 1
                              ? "暂无机会"
                              : "正在准备头像"}
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
          rerollReady={
            readyPools.has(displayedDraw.poolId) &&
            preparedDrawsRef.current.get(displayedDraw.poolId)
              ?.forPlayerId ===
              identity.player.id
          }
          acceptLabel={
            onboarding
              ? returnTo === "/"
                ? "确认身份并进入大厅"
                : "确认身份并继续"
              : "使用新身份"
          }
          onOpenChange={changeDrawDialog}
          onKeep={keepCurrentIdentity}
          onReroll={rerollIdentity}
          onAccept={acceptDrawnIdentity}
          onCloseAutoFocus={
            onboarding ? undefined : restoreDrawButtonFocus
          }
        />
      ) : null}
    </div>
  );
}
