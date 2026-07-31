import { t } from "@lingui/core/macro";
import {
  ChartLineUpIcon,
  DiceFiveIcon,
  FireIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/InfoTip";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { Player } from "@/data/players";
import {
  IDENTITY_POOLS,
  type AnonymousStats,
  type IdentityPoolId,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";
import { displayTeamName } from "@/lib/player-display";

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
    <section
      className="border border-foreground/25"
      aria-label={t`我的身份`}
      data-layout={compact ? "compact-player-identity" : undefined}
    >
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
          <PlayerAvatar
            player={player}
            className={compact ? "size-12 sm:size-14" : "size-14"}
            eager
          />
          <div className="min-w-0">
            <p
              data-layout={compact ? "compact-identity-pool" : undefined}
              className={
                compact
                  ? "whitespace-normal font-mono text-xs leading-5 uppercase tracking-[0.08em] text-muted-foreground"
                  : "truncate font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground"
              }
            >
              {t`我的身份 ·`} {
                IDENTITY_POOLS.find((pool) => pool.id === currentPool)?.label
              }
            </p>
            <p className="mt-1 truncate text-xl font-semibold tracking-[-0.02em]">
              {player.nickname}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {countryNameZh(player.countryCode)} · {displayTeamName(player.team)}
            </p>
            {compact ? (
              <p
                data-layout="compact-identity-credit-rule"
                className="mt-1 whitespace-normal font-mono text-xs leading-5 text-muted-foreground"
              >
                {t`${drawCredits} 次抽取 · 胜 1 局或累计负 2 局 +1`}
              </p>
            ) : null}
          </div>
        </div>

        {disabled ? (
          <Button
            type="button"
            variant="ghost"
            className={
              compact
                ? "h-11 justify-center rounded-none border-t border-foreground/20 px-3 text-primary sm:h-auto sm:border-t-0 sm:border-l sm:px-5"
                : "h-12 justify-center rounded-none px-5 text-primary sm:h-auto"
            }
            data-layout={compact ? "identity-manage-action" : undefined}
            disabled
          >
            <DiceFiveIcon />
            <span>{t`管理身份`}</span>
          </Button>
        ) : (
          <Button
            asChild
            variant="ghost"
            className={
              compact
                ? "h-11 justify-center rounded-none border-t border-foreground/20 px-3 text-primary sm:h-auto sm:border-t-0 sm:border-l sm:px-5"
                : "h-12 justify-center rounded-none px-5 text-primary sm:h-auto"
            }
            data-layout={compact ? "identity-manage-action" : undefined}
          >
            <Link to={manageHref}>
              <DiceFiveIcon />
              <span>{t`管理身份`}</span>
            </Link>
          </Button>
        )}
      </div>

      {!compact ? (
        <>
          <div className="grid grid-cols-3 border-t border-foreground/20">
            <div className="px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TrophyIcon />
                {t`胜负`}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {stats.wins}W · {stats.losses}L
              </p>
            </div>
            <div className="border-x border-foreground/20 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ChartLineUpIcon />
                {t`胜率`}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {winRate}%
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FireIcon />
                {t`连胜`}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {stats.currentStreak}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-foreground/20 px-4 py-2 sm:px-5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge
                variant={drawCredits > 0 ? "default" : "outline"}
                className="rounded-none font-mono"
              >
                {t`${drawCredits} 次抽取`}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {t`胜 1 局或累计负 2 局 +1`}
              </span>
            </div>
            <InfoTip
              label={t`查看身份与抽取规则`}
              side="left"
              className="size-10"
            >
              <p>{t`胜利一局获得 1 次抽取；每累计输掉两局获得 1 次。`}</p>
              {drawCredits < 1 ? (
                <p className="mt-1">
                  {t`当前再输`} {2 - lossesTowardCredit} {t`局即可获得下一次机会。`}
                </p>
              ) : null}
              {nextLockedPool ? (
                <p className="mt-1">
                  {t`累计`} {nextLockedPool.unlockWins} {t`胜解锁`}
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
