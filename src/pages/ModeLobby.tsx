import { t } from "@lingui/core/macro";
import {
  ArrowRightIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  CrosshairSimpleIcon,
  DoorOpenIcon,
  GithubLogoIcon,
  IdentificationCardIcon,
  LightningIcon,
  SwordIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Link } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PanelHeader } from "@/components/PanelHeader";
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useDailyChallengeMetadata } from "@/hooks/use-daily-challenge";
import { trackEvent } from "@/lib/analytics";

interface ModeOptionProps {
  to: string;
  icon: Icon;
  title: string;
  meta: string;
  analyticsMode: "solo" | "quick-duel" | "quick-group" | "room";
}

function ModeOption({
  to,
  icon: ModeIcon,
  title,
  meta,
  analyticsMode,
}: ModeOptionProps) {
  return (
    <Link
      to={to}
      onClick={() =>
        trackEvent("mode-selected", { mode: analyticsMode })
      }
      className="group grid min-h-16 min-w-0 grid-cols-[28px_minmax(0,1fr)_20px] items-center gap-3 border-t border-foreground/20 px-4 py-2.5 transition-colors first:border-t-0 hover:bg-primary/[0.035] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:min-h-20 sm:grid-cols-[36px_minmax(0,1fr)_20px] sm:gap-4 sm:px-5 sm:py-3"
    >
      <ModeIcon className="size-6 text-primary sm:size-7" weight="light" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 font-mono text-xs leading-5 tracking-[0.04em] text-muted-foreground">
          {meta}
        </p>
      </div>
      <span
        className="grid size-5 place-items-center text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-1 group-hover:text-primary motion-reduce:transform-none motion-reduce:transition-none"
        aria-hidden="true"
      >
        <ArrowRightIcon className="size-4" />
      </span>
    </Link>
  );
}

export function ModeLobby() {
  const { challenge } = useDailyChallengeMetadata();
  const identity = useAnonymousProfile();

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={t`职业选手竞猜`}
        action={
          <div
            className="flex items-center gap-1 sm:gap-4"
            aria-label={t`玩家快捷操作`}
          >
            <Button asChild variant="ghost" size="sm" className="rounded-none">
              <Link
                to="/identity"
                aria-label={t`管理玩家身份：${identity.player.nickname}`}
              >
                <IdentificationCardIcon />
                <span className="sm:hidden">{t`身份`}</span>
                <span className="hidden max-w-28 truncate sm:inline">
                  {identity.player.nickname}
                </span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-none">
              <Link to="/stats">
                <ChartBarIcon />
                {t`战绩`}
              </Link>
            </Button>
          </div>
        }
      />

      <main className="app-main app-main-optical">
        <PageIntro eyebrow="Game Lobby" title={t`选择游戏模式`} />

        <div className="mt-6 sm:mt-8">
          <PlayerIdentity
            player={identity.player}
            stats={identity.profile.stats}
            drawCredits={identity.profile.drawCredits}
            lossesTowardCredit={identity.profile.lossesTowardCredit}
            winRate={identity.winRate}
            currentPool={identity.currentPool}
            manageHref="/identity?return=%2F"
            compact
          />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card
            asChild
            className="flex flex-col gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0 lg:min-h-80"
          >
            <section>
              <PanelHeader
                title={t`今日挑战`}
                icon={<CalendarDotsIcon className="size-5 text-primary" />}
                action={
                  <span className="font-mono text-xs tracking-[0.04em] text-primary">
                    {t`每日刷新`}
                  </span>
                }
              />

              <div className="flex flex-1 flex-col justify-between p-4 sm:p-6">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xl font-semibold">{t`今日神秘选手`}</p>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {t`3 分钟 · 8 次尝试 · 全服同题`}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-xs font-medium tracking-[0.04em] text-primary">
                    {t`第 ${challenge?.roundNumber ?? "—"} 轮`}
                  </p>
                </div>
                <Link
                  to="/play/daily"
                  onClick={() =>
                    trackEvent("mode-selected", { mode: "daily" })
                  }
                  className="mt-4 inline-flex h-11 items-center justify-between bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 sm:mt-5"
                >
                  {t`开始今日挑战`}
                  <ArrowRightIcon className="size-4" />
                </Link>
              </div>
              <ModeOption
                to="/solo"
                icon={CrosshairSimpleIcon}
                title={t`单人练习`}
                meta={t`简单 / 完整 / 困难 · 3 分钟`}
                analyticsMode="solo"
              />
            </section>
          </Card>

          <Card
            asChild
            className="grid min-w-0 grid-rows-[auto_repeat(3,1fr)] gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
          >
            <section>
              <PanelHeader
                title={t`对战模式`}
                icon={<SwordIcon className="size-5 text-primary" />}
                action={
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
                      {t`选择玩法`}
                    </span>
                    <InfoTip
                      label={t`了解对战模式`}
                      side="bottom"
                      align="end"
                      className="size-10"
                    >
                      <p>
                        <strong>{t`实时 1v1：`}</strong>
                        {t`双方同题竞速，先猜中者获胜。`}
                      </p>
                      <p className="mt-1">
                        <strong>{t`4 人乱斗：`}</strong>
                        {t`四人同题竞速，率先猜中者获胜。`}
                      </p>
                      <p className="mt-1">
                        <strong>{t`好友房间：`}</strong>
                        {t`使用房间号加入，或创建 2–8 人房间。`}
                      </p>
                    </InfoTip>
                  </div>
                }
              />

              <ModeOption
                to="/quick"
                icon={LightningIcon}
                title={t`实时 1v1`}
                meta={t`在线匹配 · 1 / 3 / 5 局赛制`}
                analyticsMode="quick-duel"
              />
              <ModeOption
                to="/quick?players=4"
                icon={UsersThreeIcon}
                title={t`4 人乱斗`}
                meta={t`在线匹配 · 4 人 · 1 / 3 / 5 局赛制`}
                analyticsMode="quick-group"
              />
              <ModeOption
                to="/room"
                icon={DoorOpenIcon}
                title={t`好友房间`}
                meta={t`输入房间号 · 或创建房间`}
                analyticsMode="room"
              />
            </section>
          </Card>
        </div>

        <div className="mt-7 flex justify-center border-t border-foreground/15 pt-5 sm:justify-end">
          <a
            href="https://github.com/Zxilly/cs-guess"
            target="_blank"
            rel="noreferrer"
            aria-label={t`在 GitHub 查看 CS Guess 源码（新标签页打开）`}
            className="inline-flex min-h-11 items-center gap-2 px-2 text-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <GithubLogoIcon className="size-5" weight="regular" />
            {t`GitHub 源码`}
          </a>
        </div>
      </main>
    </div>
  );
}
