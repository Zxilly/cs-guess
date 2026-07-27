import { useState } from "react";
import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  CrosshairSimpleIcon,
  PlayIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { players } from "@/data/players";
import {
  type MatchHistoryEntry,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";

const MODE_LABELS: Record<MatchHistoryEntry["mode"], string> = {
  daily: "今日挑战",
  quick: "实时匹配",
  room: "好友房间",
};

const RESULT_LABELS = {
  win: "胜利",
  loss: "失败",
  draw: "平局",
} as const;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function StatsPage() {
  const identity = useAnonymousProfile();
  const [replay, setReplay] = useState<MatchHistoryEntry | null>(null);
  const history = [...identity.profile.matchHistory].reverse();
  const answer = replay
    ? players.find((player) => player.id === replay.answerId) ?? players[0]
    : players[0];
  const replayGuesses = replay
    ? replay.guessIds.flatMap((id) =>
        players.filter((player) => player.id === id),
      )
    : [];

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader subtitle="个人战绩" backToLobby />

      <main className="app-main">
        <PageIntro
          eyebrow="Stats & Replay"
          title="战绩与回放"
          help={
            <InfoTip label="战绩记录说明" side="right" className="size-6">
              最多保留最近 50 局回放。
            </InfoTip>
          }
        />

        <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: "完成对局",
              value: identity.completedSeries,
              icon: ClockCounterClockwiseIcon,
            },
            {
              label: "胜率",
              value: `${identity.winRate}%`,
              icon: ChartBarIcon,
            },
            {
              label: "最佳连胜",
              value: identity.profile.stats.bestStreak,
              icon: TrophyIcon,
            },
            {
              label: "最佳猜数",
              value: identity.bestGuessCount || "—",
              icon: CrosshairSimpleIcon,
            },
          ].map((stat) => (
            <Card
              key={stat.label}
              className="min-h-32 rounded-none border-foreground/25 bg-transparent p-4 shadow-none sm:min-h-0 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <stat.icon className="size-4 text-primary" />
              </div>
              <p className="mt-4 font-mono text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                {stat.value}
              </p>
            </Card>
          ))}
        </div>

        <Card className="mt-5 gap-0 overflow-hidden rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
          <div className="flex items-center justify-between border-b border-foreground/20 px-5 py-4">
            <div>
              <h2 className="font-semibold">最近对局</h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                平均胜局猜数 · {identity.averageWinningGuesses || "—"}
              </p>
            </div>
            <Badge variant="outline" className="rounded-none">
              {history.length} 局
            </Badge>
          </div>

          {history.length ? (
            <div>
              <p className="border-b border-foreground/15 px-5 py-2 text-[11px] text-muted-foreground md:hidden">
                横向滑动查看完整记录 →
              </p>
              <div
                className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                role="region"
                aria-label="最近对局记录，横向滚动查看更多字段"
                tabIndex={0}
              >
              <Table className="min-w-180">
                <TableHeader>
                  <TableRow className="border-foreground/20 hover:bg-transparent">
                    <TableHead>模式</TableHead>
                    <TableHead>结果</TableHead>
                    <TableHead>轮次</TableHead>
                    <TableHead>比分</TableHead>
                    <TableHead>猜测</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead className="w-24 text-right">回放</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className="border-foreground/15 hover:bg-primary/[0.025]"
                    >
                      <TableCell>
                        <p className="text-sm font-medium">
                          {MODE_LABELS[entry.mode]}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {entry.roomCode ?? `BO${entry.bestOf}`}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            entry.result === "win" ? "default" : "outline"
                          }
                          className="rounded-none"
                        >
                          {RESULT_LABELS[entry.result]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        R{entry.roundNumber} · BO{entry.bestOf}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.selfScore} : {entry.opponentScore}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.guessIds.length}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(entry.completedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-none text-primary"
                          onClick={() => setReplay(entry)}
                          disabled={!entry.answerId}
                        >
                          <PlayIcon />
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <ClockCounterClockwiseIcon className="mx-auto size-8 text-primary" />
                <p className="mt-4 font-medium">暂无可回放记录</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  完成新的今日挑战或实时对战后，这里会生成回放。
                </p>
                <Button asChild className="mt-5 rounded-none">
                  <Link to="/play/daily">开始今日挑战</Link>
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>

      <Dialog open={Boolean(replay)} onOpenChange={(open) => !open && setReplay(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] max-w-5xl gap-0 overflow-y-auto rounded-none p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-foreground/20 p-5 pr-14">
            <DialogTitle className="text-xl">对局回放</DialogTitle>
            <DialogDescription>
              {replay
                ? `${MODE_LABELS[replay.mode]} · R${replay.roundNumber} · ${RESULT_LABELS[replay.result]}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {replay && answer ? (
            <div className="p-5">
              <div className="mb-5 flex flex-col justify-between gap-3 border border-foreground/20 px-4 py-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs text-muted-foreground">本局答案</p>
                  <p className="mt-1 text-lg font-semibold">{answer.nickname}</p>
                </div>
                <div className="font-mono text-xs sm:text-right">
                  <p>{answer.team}</p>
                  <p className="mt-1 text-muted-foreground">
                    {countryNameZh(answer.countryCode)} · {answer.role} ·{" "}
                    {answer.age}
                  </p>
                </div>
              </div>
              <GuessTable
                guesses={replayGuesses}
                opponentGuesses={[]}
                opponentVisibility="hidden"
                mysteryPlayer={answer}
                mode="daily"
                maxGuesses={6}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
