import {
  ArrowRightIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  DoorOpenIcon,
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
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { players } from "@/data/players";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { dailyChallenge } from "@/lib/daily-challenge";

interface ModeOptionProps {
  to: string;
  icon: Icon;
  title: string;
  meta: string;
}

function ModeOption({
  to,
  icon: ModeIcon,
  title,
  meta,
}: ModeOptionProps) {
  return (
    <Link
      to={to}
      className="group grid min-h-20 min-w-0 grid-cols-[32px_minmax(0,1fr)_20px] items-center gap-4 border-t border-foreground/20 px-4 py-3 transition-colors first:border-t-0 hover:bg-primary/[0.035] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:grid-cols-[36px_minmax(0,1fr)_20px] sm:px-5"
    >
      <ModeIcon className="size-7 text-primary" weight="light" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 font-mono text-[10px] uppercase leading-5 tracking-[0.06em] text-muted-foreground sm:text-[11px]">
          {meta}
        </p>
      </div>
      <span
        className="grid size-5 place-items-center text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"
        aria-hidden="true"
      >
        <ArrowRightIcon className="size-4" />
      </span>
    </Link>
  );
}

export function ModeLobby() {
  const challenge = dailyChallenge(players);
  const identity = useAnonymousProfile();

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle="职业选手竞猜"
        action={
          <div className="flex items-center gap-4">
            <div className="hidden text-right font-mono text-[11px] uppercase tracking-[0.08em] sm:block">
              <p className="text-muted-foreground">{challenge.date}</p>
              <p className="mt-1 text-primary">
                Round #{challenge.roundNumber}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="rounded-none">
              <Link
                to="/identity"
                aria-label={`管理玩家身份：${identity.player.nickname}`}
              >
                <IdentificationCardIcon />
                <span className="hidden max-w-28 truncate sm:inline">
                  {identity.player.nickname}
                </span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-none">
              <Link to="/stats">
                <ChartBarIcon />
                战绩
              </Link>
            </Button>
          </div>
        }
      />

      <main className="app-main app-main-optical">
        <PageIntro eyebrow="Game Lobby" title="选择游戏模式" />

        <div className="mt-8">
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
            className="flex min-h-80 flex-col gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
          >
            <section>
              <div className="flex items-center justify-between border-b border-foreground/20 px-5 py-4">
                <div className="flex items-center gap-2">
                  <CalendarDotsIcon className="size-5 text-primary" />
                  <h2 className="font-semibold">今日挑战</h2>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-primary">
                  每日刷新
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-between p-6 sm:p-8">
                <div>
                  <p className="font-mono text-6xl font-medium tracking-[-0.08em] text-primary">
                    #{challenge.roundNumber}
                  </p>
                  <p className="mt-5 text-2xl font-semibold">今日神秘选手</p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    3 分钟 · 6 次尝试 · 全服同题
                  </p>
                </div>
                <Link
                  to="/play/daily"
                  className="mt-8 inline-flex h-12 items-center justify-between bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
                >
                  开始今日挑战
                  <ArrowRightIcon className="size-4" />
                </Link>
              </div>
            </section>
          </Card>

          <Card
            asChild
            className="grid grid-rows-[auto_repeat(3,1fr)] gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
          >
            <section>
              <div className="flex items-center justify-between border-b border-foreground/20 px-5 py-3">
                <div className="flex items-center gap-2">
                  <SwordIcon className="size-5 text-primary" />
                  <h2 className="font-semibold">对战模式</h2>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    选择玩法
                  </span>
                  <InfoTip
                    label="了解对战模式"
                    side="bottom"
                    align="end"
                    className="size-10"
                  >
                    <p>
                      <strong>实时 1v1：</strong>
                      双方同题竞速，先猜中者获胜。
                    </p>
                    <p className="mt-1">
                      <strong>4 人乱斗：</strong>
                      四人同题竞速，率先猜中者获胜。
                    </p>
                    <p className="mt-1">
                      <strong>好友房间：</strong>
                      使用房间号加入，或创建 2–8 人房间。
                    </p>
                  </InfoTip>
                </div>
              </div>

              <ModeOption
                to="/quick"
                icon={LightningIcon}
                title="实时 1v1"
                meta="Online · BO1 / BO3 / BO5"
              />
              <ModeOption
                to="/quick?players=4"
                icon={UsersThreeIcon}
                title="4 人乱斗"
                meta="Online · 4 Players · BO1 / BO3 / BO5"
              />
              <ModeOption
                to="/room"
                icon={DoorOpenIcon}
                title="好友房间"
                meta="输入房间号 · 或创建房间"
              />
            </section>
          </Card>
        </div>
      </main>
    </div>
  );
}
