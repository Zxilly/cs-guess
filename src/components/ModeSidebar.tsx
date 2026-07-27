import {
  ArrowLeftIcon,
  ClockIcon,
  CrosshairIcon,
  InfoIcon,
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
  quick: "实时 1v1",
  room: "好友房间",
};

interface ModeSidebarProps {
  mode: GameMode;
  secondsLeft: number;
  guesses: number;
  maxGuesses: number;
  timerActive?: boolean;
  roundNumber?: number;
  bestOf?: number;
  modeLabel?: string;
  onExit?: () => void;
}

export function ModeSidebar({
  mode,
  secondsLeft,
  guesses,
  maxGuesses,
  timerActive = true,
  roundNumber,
  bestOf,
  modeLabel,
  onExit,
}: ModeSidebarProps) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());

  return (
    <aside className="border-b border-foreground/20 bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
      <div className="flex h-full flex-col px-5 py-5 sm:px-8 lg:px-9 lg:py-10">
        <div className="flex items-start justify-between gap-5 lg:block">
          <div>
            <Link
              to="/"
              className="group flex items-center gap-3"
              onClick={onExit}
            >
              <CrosshairIcon
                className="size-9 text-primary transition-transform group-hover:rotate-45"
                weight="regular"
              />
              <span className="text-xl font-bold tracking-[0.08em]">
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
            <Link to="/" onClick={onExit}>
              <ArrowLeftIcon />
              模式大厅
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4 border-t-2 border-primary pt-4 lg:mt-8 lg:block lg:pt-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              当前模式
            </p>
            <p className="mt-1 whitespace-nowrap text-sm font-semibold lg:mt-2 lg:text-lg">
              {modeLabel ?? modeNames[mode]}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 border-l border-foreground/15 pl-4 font-mono text-[10px] uppercase tracking-[0.08em] lg:mt-5 lg:gap-5 lg:border-t lg:border-l-0 lg:pt-5 lg:pl-0 lg:text-[11px]">
            <div>
              <p className="text-muted-foreground">
                {mode === "daily" ? "Round" : "Series"}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {mode === "daily"
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

        <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
          <div className="flex items-center gap-2 text-sm">
            <ClockIcon className="size-4" />
            <span>剩余时间</span>
          </div>
          {timerActive ? (
            <Timer
              seconds={secondsLeft}
              className="mt-3 text-4xl text-primary"
            />
          ) : (
            <p className="mt-3 font-mono text-3xl text-muted-foreground">
              --:--
            </p>
          )}
        </div>

        <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
          <p className="text-sm">尝试次数</p>
          <p className="mt-2 font-mono text-3xl font-medium">
            {guesses} / {maxGuesses}
          </p>
        </div>

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
                <li>在六次机会与三分钟内锁定答案。</li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>

      </div>
    </aside>
  );
}
