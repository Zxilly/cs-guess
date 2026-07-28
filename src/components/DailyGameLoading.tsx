import { ArrowLeftIcon, CrosshairIcon } from "@phosphor-icons/react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

interface DailyGameLoadingProps {
  error?: Error;
  onRetry?: () => void;
}

function LoadingBlock({
  className,
  animate,
}: {
  className: string;
  animate: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-foreground/10 ${animate ? "animate-pulse motion-reduce:animate-none" : ""} ${className}`}
    />
  );
}

export function DailyGameLoading({
  error,
  onRetry,
}: DailyGameLoadingProps) {
  const pending = !error;

  return (
    <div
      className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]"
      role={error ? "alert" : "status"}
      aria-label={error ? "每日挑战载入失败" : "正在载入今日题目"}
      data-daily-game-surface={error ? "error" : "loading"}
    >
      <aside className="border-b border-foreground/20 bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col px-5 py-5 sm:px-8 lg:px-9 lg:py-10">
          <div className="flex items-start justify-between gap-5 lg:block">
            <Link to="/" className="flex items-center gap-3">
              <CrosshairIcon
                className="size-9 text-primary"
                weight="regular"
              />
              <span className="text-xl font-bold tracking-[0.08em]">
                CS GUESS
              </span>
            </Link>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-none lg:mt-7"
            >
              <Link to="/">
                <ArrowLeftIcon />
                模式大厅
              </Link>
            </Button>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4 border-t-2 border-primary pt-4 lg:mt-8 lg:block lg:pt-5">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                当前模式
              </p>
              <p className="mt-1 whitespace-nowrap text-sm font-semibold lg:mt-2 lg:text-lg">
                今日挑战
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-l border-foreground/15 pl-4 lg:mt-5 lg:gap-5 lg:border-t lg:border-l-0 lg:pt-5 lg:pl-0">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Round
                </p>
                <LoadingBlock
                  className="mt-2 h-4 w-12"
                  animate={pending}
                />
              </div>
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Date
                </p>
                <LoadingBlock
                  className="mt-2 h-4 w-20"
                  animate={pending}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
            <p className="text-sm">剩余时间</p>
            <LoadingBlock
              className="mt-3 h-10 w-28 bg-primary/20"
              animate={pending}
            />
          </div>
          <div className="mt-6 hidden border-t border-foreground/15 pt-6 lg:block">
            <p className="text-sm">猜测进度</p>
            <LoadingBlock
              className="mt-3 h-8 w-20"
              animate={pending}
            />
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <div className="app-game-container min-w-0">
          <header className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-6">
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
                今日神秘选手
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                根据对比，锁定神秘选手。
              </h1>
            </div>
            <LoadingBlock
              className="h-3 w-32 shrink-0"
              animate={pending}
            />
          </header>

          <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
            <span className="text-xs text-muted-foreground">剩余时间</span>
            <LoadingBlock className="h-5 w-16" animate={pending} />
            <LoadingBlock className="h-3 w-10" animate={pending} />
          </div>

          <div className="flex min-h-16 items-center justify-between border-y border-foreground/20 px-5 py-4">
            <p className="text-sm font-medium">
              {error ? "今日题目暂时不可用" : "正在获取今日统一题目"}
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <LoadingBlock
                  key={index}
                  className="size-2 border border-foreground/20"
                  animate={pending}
                />
              ))}
            </div>
          </div>

          {error ? (
            <section className="mt-6 border border-foreground/25 p-5 sm:p-6">
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
                DAILY CHALLENGE
              </p>
              <h2 className="mt-3 text-xl font-bold">每日挑战载入失败</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                请检查网络连接后重新载入。
              </p>
              {onRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-6 rounded-none"
                  onClick={onRetry}
                >
                  重新载入
                </Button>
              ) : null}
            </section>
          ) : (
            <>
              <div className="mt-6 h-12 border border-foreground/25">
                <LoadingBlock className="h-full w-full" animate />
              </div>
              <div className="mt-6 border border-foreground/25">
                <div className="flex h-12 items-center justify-between border-b border-foreground/20 px-4">
                  <LoadingBlock className="h-4 w-20" animate />
                  <LoadingBlock className="h-3 w-10" animate />
                </div>
                <div className="grid h-12 grid-cols-[2.5rem_8.5rem_repeat(5,minmax(4rem,1fr))] divide-x divide-foreground/15 border-b border-foreground/15">
                  {Array.from({ length: 7 }, (_, index) => (
                    <LoadingBlock
                      key={index}
                      className="m-auto h-3 w-8"
                      animate
                    />
                  ))}
                </div>
                <div className="h-15 bg-muted/20" aria-hidden="true" />
              </div>
            </>
          )}

          <span className="sr-only">
            {error
              ? "今日题目载入失败，可以重新载入。"
              : "正在载入今日题目，轮次、计时和猜测进度将在题目准备后显示。"}
          </span>
        </div>
      </main>
    </div>
  );
}
