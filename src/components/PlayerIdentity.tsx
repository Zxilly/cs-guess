import {
  ChartLineUpIcon,
  DiceFiveIcon,
  FireIcon,
  IdentificationCardIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/InfoTip";
import type { Player } from "@/data/players";
import {
  IDENTITY_POOLS,
  type AnonymousStats,
  type IdentityPoolId,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";

interface PlayerIdentityProps {
  player: Player;
  stats: AnonymousStats;
  drawCredits: number;
  lossesTowardCredit: number;
  winRate: number;
  currentPool: IdentityPoolId;
  disabled?: boolean;
  manageHref: string;
  compact?: boolean;
}

export function PlayerIdentity({
  player,
  stats,
  drawCredits,
  lossesTowardCredit,
  winRate,
  currentPool,
  disabled,
  manageHref,
  compact = false,
}: PlayerIdentityProps) {
  const nextLockedPool = IDENTITY_POOLS.find(
    (pool) => stats.wins < pool.unlockWins,
  );

  return (
    <section className="border border-foreground/25" aria-label="我的身份">
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-4 px-4 py-4 sm:px-5">
          <IdentificationCardIcon
            className="size-7 shrink-0 text-primary"
            weight="light"
          />
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              我的身份 · {
                IDENTITY_POOLS.find((pool) => pool.id === currentPool)?.label
              }
            </p>
            <p className="mt-1 truncate text-xl font-semibold tracking-[-0.02em]">
              {player.nickname}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {countryNameZh(player.countryCode)} · {player.team}
              {compact ? ` · ${drawCredits} 次抽取` : ""}
            </p>
          </div>
        </div>

        {disabled ? (
          <Button
            type="button"
            variant="ghost"
            className="h-12 justify-center rounded-none border-t border-foreground/20 px-5 text-primary sm:h-auto sm:border-t-0 sm:border-l"
            disabled
          >
            <DiceFiveIcon />
            管理身份
          </Button>
        ) : (
          <Button
            asChild
            variant="ghost"
            className="h-12 justify-center rounded-none border-t border-foreground/20 px-5 text-primary sm:h-auto sm:border-t-0 sm:border-l"
          >
            <Link to={manageHref}>
              <DiceFiveIcon />
              管理身份
            </Link>
          </Button>
        )}
      </div>

      {!compact ? (
        <>
          <div className="grid grid-cols-3 border-t border-foreground/20">
            <div className="px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <TrophyIcon />
                胜负
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {stats.wins}W · {stats.losses}L
              </p>
            </div>
            <div className="border-x border-foreground/20 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ChartLineUpIcon />
                胜率
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {winRate}%
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <FireIcon />
                连胜
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {stats.currentStreak}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-foreground/20 px-4 py-2 sm:px-5">
            <Badge
              variant={drawCredits > 0 ? "default" : "outline"}
              className="rounded-none font-mono"
            >
              {drawCredits} 次抽取
            </Badge>
            <InfoTip
              label="查看身份与抽取规则"
              side="left"
              className="size-10"
            >
              <p>胜利一局获得 1 次抽取；每累计输掉两局获得 1 次。</p>
              {drawCredits < 1 ? (
                <p className="mt-1">
                  当前再输 {2 - lossesTowardCredit} 局即可获得下一次机会。
                </p>
              ) : null}
              {nextLockedPool ? (
                <p className="mt-1">
                  累计 {nextLockedPool.unlockWins} 胜解锁
                  {nextLockedPool.label}。
                </p>
              ) : null}
            </InfoTip>
          </div>
        </>
      ) : null}
    </section>
  );
}
