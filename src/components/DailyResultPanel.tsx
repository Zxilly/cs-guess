import {
  CalendarDotsIcon,
  CheckCircleIcon,
  GlobeHemisphereWestIcon,
  MedalIcon,
  ArrowClockwiseIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode, Ref } from "react";

import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerRoleLabel } from "@/components/PlayerRoleLabel";
import { TeamLogo } from "@/components/TeamLogo";
import { Button } from "@/components/ui/button";
import type { Player } from "@/data/players";
import { countryNameZh } from "@/lib/country-geography";
import {
  displayTeamName,
  UNATTACHED_TEAM_LABEL,
} from "@/lib/player-display";
import {
  soloLossCopy,
  type SoloLossReason,
} from "@/lib/solo-result-copy";

interface DailyResultPanelProps {
  outcome: "won" | "lost";
  attempts: number;
  maxGuesses: number;
  mysteryPlayer: Player;
  context?: "daily" | "solo";
  onPlayAgain?: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
  lossReason?: SoloLossReason;
}

export function DailyResultPanel({
  outcome,
  attempts,
  maxGuesses,
  mysteryPlayer,
  context = "daily",
  onPlayAgain,
  titleRef,
  lossReason,
}: DailyResultPanelProps) {
  const won = outcome === "won";
  const isDaily = context === "daily";
  const ResultIcon = won ? CheckCircleIcon : XCircleIcon;
  const teamName = displayTeamName(mysteryPlayer.team);
  const soloLoss = soloLossCopy(lossReason, maxGuesses);
  const dailyLossSummary =
    lossReason === "timeout"
      ? "三分钟倒计时已结束，今日答案已经揭晓。"
      : lossReason === "attempts-exhausted"
        ? "八次猜测机会已用完，今日答案已经揭晓。"
        : "今日答案已经揭晓。";

  return (
    <section
      aria-labelledby="game-result-title"
      className="border border-foreground/25 bg-background"
    >
      <div className="h-1 bg-primary" aria-hidden="true" />

      <header className="flex flex-col gap-5 border-b border-foreground/15 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center border border-primary/35 bg-primary/[0.06] text-primary">
            <ResultIcon className="size-5" weight="duotone" />
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-primary">
              {isDaily ? "Daily result" : "Solo result"}
            </p>
            <h2
              ref={titleRef}
              id="game-result-title"
              tabIndex={-1}
              className="mt-1.5 text-2xl font-bold tracking-[-0.035em] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:text-3xl"
            >
              {isDaily
                ? won
                  ? "今日挑战完成"
                  : "今日挑战结束"
                : won
                  ? "单人练习完成"
                  : soloLoss.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isDaily
                ? won
                  ? "你成功锁定了今日答案。"
                  : dailyLossSummary
                : won
                  ? "你成功锁定了本局答案。"
                  : soloLoss.panelSummary}
            </p>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-t border-foreground/15 pt-4 sm:block sm:border-t-0 sm:pt-0 sm:text-right">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
            已用尝试
          </p>
          <p className="font-mono text-2xl font-semibold tracking-[-0.04em]">
            {attempts} / {maxGuesses}
          </p>
        </div>
      </header>

      <div className="flex min-w-0 items-center gap-5 px-5 py-6 sm:px-7">
        <PlayerAvatar
          player={mysteryPlayer}
          className="size-24 sm:size-28"
          eager
        />
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
            {isDaily ? "今日答案" : "本局答案"}
          </p>
          <h3 className="mt-2 truncate text-3xl font-bold tracking-[-0.04em]">
            {mysteryPlayer.nickname}
          </h3>
          <p className="mt-1 truncate text-sm text-muted-foreground sm:text-base">
            {mysteryPlayer.name}
          </p>
        </div>
      </div>

      <dl className="border-t border-foreground/20 lg:grid lg:grid-cols-6">
        <ResultItem label="战队">
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo
              name={teamName}
              src={
                teamName === UNATTACHED_TEAM_LABEL
                  ? undefined
                  : mysteryPlayer.teamLogoUrl
              }
            />
            <span className="truncate">{teamName}</span>
          </span>
        </ResultItem>
        <ResultItem label="国家或地区" icon={<GlobeHemisphereWestIcon />}>
          {countryNameZh(mysteryPlayer.countryCode)}
        </ResultItem>
        <ResultItem label="年龄" icon={<CalendarDotsIcon />}>
          {mysteryPlayer.age}
        </ResultItem>
        <ResultItem label="位置">
          <PlayerRoleLabel role={mysteryPlayer.role} />
        </ResultItem>
        <ResultItem label="Major 次数" icon={<MedalIcon />}>
          {mysteryPlayer.majorAppearances}
        </ResultItem>
        <ResultItem label="Major 冠军" icon={<MedalIcon />}>
          {mysteryPlayer.majorWins}
        </ResultItem>
      </dl>
      {!isDaily && onPlayAgain ? (
        <footer className="flex justify-end border-t border-foreground/20 px-5 py-4 sm:px-7">
          <Button className="w-full rounded-none sm:w-auto" onClick={onPlayAgain}>
            <ArrowClockwiseIcon />
            开始下一题
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

function ResultItem({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-foreground/15 px-5 py-4 last:border-b-0 lg:block lg:min-w-0 lg:border-r lg:border-b-0 lg:px-5 lg:last:border-r-0">
      <dt className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm font-semibold lg:mt-3 lg:text-left">
        {children}
      </dd>
    </div>
  );
}
