import {
  ArrowLeftIcon,
  ClockIcon,
  CrosshairIcon,
  HourglassMediumIcon,
  InfoIcon,
  ScalesIcon,
  TrophyIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";

import { Timer } from "@/components/Timer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { GameMode } from "@/types/game";

const modeNames: Record<GameMode, string> = {
  daily: "今日挑战",
  solo: "单人练习",
  quick: "实时 1v1",
  room: "好友房间",
};

interface ModeSidebarProps {
  mode: GameMode;
  secondsLeft: number;
  guesses: number;
  maxGuesses: number;
  status?: "waiting" | "playing" | "won" | "lost" | "draw";
  roundNumber?: number;
  bestOf?: number;
  modeLabel?: string;
  backHref?: string;
  backLabel?: string;
  onExit?: () => void;
}

export function ModeSidebar({
  mode,
  secondsLeft,
  guesses,
  maxGuesses,
  status = "playing",
  roundNumber,
  bestOf,
  modeLabel,
  backHref = "/",
  backLabel = "模式大厅",
  onExit,
}: ModeSidebarProps) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const isNumberedRound = mode === "daily" || mode === "solo";
  const finishedStatus = {
    waiting: {
      label: "等待开局",
      detail: "玩家就位后开始",
      icon: HourglassMediumIcon,
    },
    won: {
      label:
        mode === "daily"
          ? "挑战完成"
          : mode === "solo"
            ? "练习完成"
            : "本局胜利",
      detail: `已提交 ${guesses} 次猜测`,
      icon: TrophyIcon,
    },
    lost: {
      label:
        mode === "daily"
          ? "挑战结束"
          : mode === "solo"
            ? "练习结束"
            : "本局失利",
      detail: `已提交 ${guesses} 次猜测`,
      icon: XCircleIcon,
    },
    draw: {
      label: "本局平局",
      detail: `已提交 ${guesses} 次猜测`,
      icon: ScalesIcon,
    },
  }[status === "playing" ? "waiting" : status];
  const FinishedStatusIcon = finishedStatus.icon;

  return (
    <aside className="border-b border-foreground/20 bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
      <div className="flex h-full flex-col px-5 py-5 sm:px-8 lg:px-9 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 lg:block">
          <div className="min-w-0">
            <Link
              to="/"
              className="group flex min-w-0 items-center gap-3"
              onClick={onExit}
            >
              <CrosshairIcon
                className="size-9 text-primary motion-safe:transition-transform motion-safe:group-hover:rotate-45 motion-reduce:transform-none motion-reduce:transition-none"
                weight="regular"
              />
              <span className="truncate text-xl font-bold tracking-[0.08em]">
                CS GUESS
              </span>
            </Link>
          </div>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-none lg:mt-7"
          >
            <Link to={backHref} onClick={onExit}>
              <ArrowLeftIcon />
              {backLabel}
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t-2 border-primary pt-4 lg:mt-8 lg:block lg:pt-5">
          <div className="min-w-0 flex-1 basis-32">
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
              当前模式
            </p>
            <p className="mt-1 text-sm font-semibold lg:mt-2 lg:text-lg">
              {modeLabel ?? modeNames[mode]}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 border-l border-foreground/15 pl-3 font-mono text-xs uppercase tracking-[0.08em] sm:gap-4 sm:pl-4 lg:mt-5 lg:gap-5 lg:border-t lg:border-l-0 lg:pt-5 lg:pl-0">
            <div>
              <p className="text-muted-foreground">
                {isNumberedRound ? "Round" : "Series"}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {isNumberedRound
                  ? `#${roundNumber ?? "—"}`
                  : roundNumber
                    ? `R${roundNumber} · BO${bestOf ?? 3}`
                    : `READY · BO${bestOf ?? 3}`}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Date</p>
              <p className="mt-1 whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
                {today}
              </p>
            </div>
          </div>
        </div>

        {status === "playing" ? (
          <>
            <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
              <div className="flex items-center gap-2 text-sm">
                <ClockIcon className="size-4" />
                <span>剩余时间</span>
              </div>
              <Timer
                seconds={secondsLeft}
                className="mt-3 text-4xl text-primary"
              />
            </div>

            <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
              <p className="text-sm">猜测进度</p>
              <p className="mt-2 font-mono text-3xl font-medium">
                {guesses} / {maxGuesses}
              </p>
            </div>
          </>
        ) : (
          <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
            <p className="text-xs text-muted-foreground">对局状态</p>
            <div className="mt-3 flex items-start gap-3">
              <FinishedStatusIcon
                className="mt-0.5 size-5 shrink-0 text-primary"
                weight="regular"
              />
              <div>
                <p className="font-semibold">{finishedStatus.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {finishedStatus.detail}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto justify-start rounded-none px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-primary"
              >
                <InfoIcon />
                查看竞猜规则
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              className="w-64 rounded-none bg-foreground px-3 py-2 text-xs text-background shadow-none ring-0"
            >
              <ul className="space-y-1 leading-5">
                <li>搜索职业选手并提交猜测。</li>
                <li>蓝色代表完全一致，箭头表示数值方向。</li>
                <li>在八次机会与三分钟内锁定答案。</li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>

      </div>
    </aside>
  );
}
