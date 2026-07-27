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
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { IdentityDrawDialog } from "@/components/IdentityDrawDialog";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Player } from "@/data/players";
import {
  IDENTITY_POOLS,
  playersInPool,
  type IdentityPoolId,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";

interface DrawSequence {
  rollKey: number;
  poolId: IdentityPoolId;
  items: readonly Player[];
  winner: Player;
  winnerIndex: number;
  revealed: boolean;
}

function safeReturnPath(value: string | null) {
  if (
    value === "/" ||
    value === "/room" ||
    value === "/quick" ||
    value === "/quick?players=4" ||
    value === "/play/daily" ||
    value === "/matching" ||
    value === "/stats"
  ) {
    return value;
  }
  return "/";
}

function randomIndex(length: number) {
  if (length <= 1) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function createRouletteItems(candidates: readonly Player[], winner: Player) {
  const winnerIndex = 23;
  const items = Array.from(
    { length: 29 },
    () => candidates[randomIndex(candidates.length)],
  );
  items[winnerIndex] = winner;
  return { items, winnerIndex };
}

export function IdentityPage() {
  const identity = useAnonymousProfile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("return"));
  const onboarding = !identity.profile.identityConfirmed;
  const visiblePools = onboarding ? IDENTITY_POOLS.slice(0, 1) : IDENTITY_POOLS;
  const [draw, setDraw] = useState<DrawSequence | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const drawInProgressRef = useRef(false);
  const rollSequenceRef = useRef(0);
  const previewCreditsAppliedRef = useRef(false);
  const setPreviewDrawCredits = identity.setPreviewDrawCredits;

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

  function beginDraw(poolId: IdentityPoolId) {
    if (drawInProgressRef.current || identity.profile.drawCredits < 1) return;
    if (onboarding && poolId !== "common") return;
    const pool = playersInPool(poolId);
    const candidates = pool.filter(
      (candidate) => candidate.id !== identity.player.id,
    );
    const previews = candidates.length > 0 ? candidates : pool;
    if (previews.length === 0) return;

    drawInProgressRef.current = true;
    rollSequenceRef.current += 1;
    const winner = previews[randomIndex(previews.length)];
    const { items, winnerIndex } = createRouletteItems(previews, winner);
    if (!onboarding) identity.spendDrawCredit(poolId);
    setDraw({
      rollKey: rollSequenceRef.current,
      poolId,
      items,
      winner,
      winnerIndex,
      revealed: false,
    });

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    revealTimerRef.current = window.setTimeout(
      () => {
        drawInProgressRef.current = false;
        setDraw((current) =>
          current ? { ...current, revealed: true } : current,
        );
        revealTimerRef.current = null;
      },
      reducedMotion ? 150 : 3100,
    );
  }

  function startDraw(poolId: IdentityPoolId) {
    if (draw) return;
    beginDraw(poolId);
  }

  function rerollIdentity() {
    if (!draw?.revealed) return;
    beginDraw(draw.poolId);
  }

  function changeDrawDialog(open: boolean) {
    if (onboarding) return;
    if (!open && draw?.revealed) setDraw(null);
  }

  function keepCurrentIdentity() {
    if (draw?.revealed) setDraw(null);
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
    identity.adoptIdentity(draw.poolId, draw.winner.id);
    setDraw(null);
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
          title={onboarding ? "抽取你的初始身份" : "我的身份"}
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

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <Card className="overflow-hidden rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
            <div className="relative flex min-h-64 flex-col justify-between p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {onboarding ? "待设置身份" : "当前身份"}
                </p>
                <IdentificationCardIcon
                  className="size-8 text-primary"
                  weight="light"
                />
              </div>

              <div>
                <p className="mt-10 break-words text-5xl font-bold tracking-[-0.06em] sm:text-6xl">
                  {onboarding ? "等待抽取" : identity.player.nickname}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {onboarding
                    ? "从 Major 参赛选手中获得你的固定匿名身份"
                    : `${countryNameZh(identity.player.countryCode)} · ${identity.player.team}`}
                </p>
              </div>

              <div className="mt-9 flex flex-wrap items-center gap-2">
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
                抽取结果确认后自动进入模式大厅。
              </div>
            ) : (
              <div className="grid grid-cols-3 border-t border-foreground/20">
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <TrophyIcon />
                    胜负
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.profile.stats.wins}W ·{" "}
                    {identity.profile.stats.losses}L
                  </p>
                </div>
                <div className="border-x border-foreground/20 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ChartLineUpIcon />
                    胜率
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.winRate}%
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <FireIcon />
                    连胜
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {identity.profile.stats.currentStreak}
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card className="gap-0 rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
            <div className="flex items-center justify-between border-b border-foreground/20 px-5 py-4">
              <div className="flex items-center gap-2">
                <DiceFiveIcon className="size-5 text-primary" />
                <h2 className="font-semibold">
                  {onboarding ? "初始选手池" : "选择选手池"}
                </h2>
              </div>
              <InfoTip label="查看抽取说明" side="left" className="size-10">
                <p>
                  {onboarding
                    ? "首次只能从 Major 参赛池抽取，确认后身份会固定保留。"
                    : "抽取会更换当前身份，并消耗一次机会。"}
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
            </div>

            <div className="grid flex-1 auto-rows-fr">
              {visiblePools.map((pool) => {
                const unlocked =
                  identity.profile.stats.wins >= pool.unlockWins;
                const canDraw =
                  unlocked && identity.profile.drawCredits > 0 && !draw;

                return (
                  <div
                    key={pool.id}
                    className="grid gap-4 border-b border-foreground/20 p-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
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
                            <span className="font-mono text-[10px] text-primary">
                              当前
                            </span>
                          ) : null}
                        </div>
                        {!unlocked ? (
                          <p className="mt-1 font-mono text-[11px] text-foreground">
                            再胜 {pool.unlockWins - identity.profile.stats.wins}{" "}
                            场解锁
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {canDraw ? (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-none sm:min-w-28"
                        onClick={() => startDraw(pool.id)}
                      >
                        {onboarding ? "抽取初始身份" : "抽取一次"}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground sm:min-w-28 sm:text-right">
                        {draw
                          ? "抽取中"
                          : !unlocked
                            ? `${pool.unlockWins} 胜解锁`
                            : "暂无机会"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </main>

      {draw ? (
        <IdentityDrawDialog
          open
          poolLabel={
            IDENTITY_POOLS.find((pool) => pool.id === draw.poolId)?.label ?? ""
          }
          rollKey={draw.rollKey}
          items={draw.items}
          winner={draw.winner}
          winnerIndex={draw.winnerIndex}
          revealed={draw.revealed}
          remainingCredits={onboarding ? 0 : identity.profile.drawCredits}
          allowKeepCurrent={!onboarding}
          allowReroll={!onboarding}
          acceptLabel={onboarding ? "确认身份并进入大厅" : "使用新身份"}
          onOpenChange={changeDrawDialog}
          onKeep={keepCurrentIdentity}
          onReroll={rerollIdentity}
          onAccept={acceptDrawnIdentity}
        />
      ) : null}
    </div>
  );
}
