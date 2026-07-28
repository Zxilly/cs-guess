import { Fragment, useRef, useState } from "react";
import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  CrosshairSimpleIcon,
  PlayIcon,
  TrophyIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PanelHeader } from "@/components/PanelHeader";
import { PlayerRoleLabel } from "@/components/PlayerRoleLabel";
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
import {
  playerRoleNameZh,
  type Player,
} from "@/data/players";
import {
  type MatchHistoryEntry,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import { countryNameZh } from "@/lib/country-geography";
import {
  focusReplayTitle,
  groupRoundHistory,
  resolveReplayData,
  STATS_REPLAY_CLOSE_LABEL,
} from "@/lib/stats-history-display";

const MODE_LABELS: Record<MatchHistoryEntry["mode"], string> = {
  daily: "今日挑战",
  solo: "单人练习",
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

function GuessCount({ entry }: { entry: MatchHistoryEntry }) {
  return entry.guessIds.length > 0 ? (
    <span>{entry.guessIds.length} 次</span>
  ) : (
    <span className="text-muted-foreground">无猜测记录</span>
  );
}

function ReplayGuessCards({
  guesses,
}: {
  guesses: readonly (Player | undefined)[];
}) {
  return (
    <section aria-label="本回合猜测记录" className="grid gap-2">
      {guesses.map((guess, index) => (
        <article
          // Index is the durable attempt position, including unavailable history.
          key={`${guess?.id ?? "unavailable"}-${index}`}
          className="border border-foreground/20 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground">
                第 {index + 1} 次猜测
              </p>
              <p className="mt-1 font-semibold">
                {guess?.nickname ?? "历史数据不可用"}
              </p>
            </div>
            {guess ? (
              <Badge variant="outline" className="rounded-none">
                {guess.team}
              </Badge>
            ) : (
              <WarningCircleIcon className="size-4 text-destructive" />
            )}
          </div>
          {guess ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {countryNameZh(guess.countryCode)} · {playerRoleNameZh(guess.role)}
              {" · "}
              {guess.age} 岁 · {guess.majorAppearances} 次 Major
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export function ReplayDetails({ entry }: { entry: MatchHistoryEntry }) {
  const { answer, guesses, unavailableGuessCount } = resolveReplayData(entry);
  const resolvedGuesses = guesses.filter(
    (guess): guess is Player => Boolean(guess),
  );
  const hasNoGuesses = entry.guessIds.length === 0;
  const useCompactGuessList = unavailableGuessCount > 0 || !answer;

  return (
    <div className="p-5">
      <dl className="mb-5 grid grid-cols-2 gap-px border border-foreground/20 bg-foreground/15 sm:grid-cols-3">
        {[
          ["模式", MODE_LABELS[entry.mode]],
          ["回合 / 赛制", `R${entry.roundNumber} · BO${entry.bestOf}`],
          ["累计比分", `${entry.selfScore} : ${entry.opponentScore}`],
          ["对手", entry.opponentNames.join("、") || "—"],
          ["房间", entry.roomCode ?? "—"],
          ["完成时间", formatTime(entry.completedAt)],
        ].map(([label, value]) => (
          <div key={label} className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xs font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {answer ? (
        <div className="mb-5 flex flex-col justify-between gap-3 border border-foreground/20 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs text-muted-foreground">本回合答案</p>
            <p className="mt-1 text-lg font-semibold">{answer.nickname}</p>
          </div>
          <div className="font-mono text-xs sm:text-right">
            <p>{answer.team}</p>
            <p className="mt-1 text-muted-foreground">
              {countryNameZh(answer.countryCode)} ·{" "}
              <PlayerRoleLabel role={answer.role} /> · {answer.age}
            </p>
          </div>
        </div>
      ) : (
        <div
          role="status"
          className="mb-5 flex items-center gap-2 border border-destructive/35 p-4 text-sm"
        >
          <WarningCircleIcon className="size-5 text-destructive" />
          本回合答案的历史数据不可用
        </div>
      )}

      {hasNoGuesses ? (
        <div
          role="status"
          className="grid min-h-28 place-items-center border border-foreground/20 px-4 text-center text-sm text-muted-foreground"
        >
          本回合无猜测记录
        </div>
      ) : (
        <>
          {unavailableGuessCount > 0 ? (
            <p
              role="status"
              className="mb-3 text-xs text-muted-foreground"
            >
              {unavailableGuessCount} 条猜测的历史数据不可用
            </p>
          ) : null}
          <div
            data-testid="replay-compact-guess-list"
            className={useCompactGuessList ? "block" : "sm:hidden"}
          >
            <ReplayGuessCards guesses={guesses} />
          </div>
          {!useCompactGuessList && answer ? (
            <div className="hidden sm:block">
              <GuessTable
                guesses={resolvedGuesses}
                opponentGuesses={[]}
                opponentVisibility="hidden"
                mysteryPlayer={answer}
                mode="daily"
                maxGuesses={resolvedGuesses.length}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function StatsPage() {
  const identity = useAnonymousProfile();
  const [replay, setReplay] = useState<MatchHistoryEntry | null>(null);
  const replayTitleRef = useRef<HTMLHeadingElement>(null);
  const history = [...identity.profile.matchHistory].reverse();
  const historyGroups = groupRoundHistory(history);
  const hasCompletedRounds = identity.completedRounds > 0;

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader subtitle="个人战绩" backToLobby />

      <main className="app-main">
        <PageIntro
          eyebrow="Stats & Replay"
          title="战绩与回放"
          help={
            <InfoTip label="战绩记录说明" side="right" className="size-6">
              数据按回合统计，最多保留最近 50 回合。同一房间的每个回合各占一行，比分为该回合结束时的累计比分。
            </InfoTip>
          }
        />

        <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: "完成回合",
              value: hasCompletedRounds ? identity.completedRounds : "—",
              empty: !hasCompletedRounds,
              icon: ClockCounterClockwiseIcon,
            },
            {
              label: "回合胜率",
              value: hasCompletedRounds ? `${identity.winRate}%` : "—",
              empty: !hasCompletedRounds,
              icon: ChartBarIcon,
            },
            {
              label: "最佳回合连胜",
              value: hasCompletedRounds
                ? identity.profile.stats.bestStreak
                : "—",
              empty: !hasCompletedRounds,
              icon: TrophyIcon,
            },
            {
              label: "胜局最佳猜数",
              value: identity.bestGuessCount ?? "暂无",
              empty: identity.bestGuessCount === null,
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
              <p
                className={[
                  "mt-4 font-mono font-semibold tracking-[-0.04em]",
                  stat.empty
                    ? "text-sm text-muted-foreground"
                    : "text-2xl sm:text-3xl",
                ].join(" ")}
              >
                {stat.value}
              </p>
            </Card>
          ))}
        </div>

        <Card className="mt-5 gap-0 overflow-hidden rounded-none border-foreground/25 bg-transparent py-0 shadow-none">
          <PanelHeader
            title="最近回合"
            description={
              identity.winningGuessSampleSize > 0
                ? `有猜测记录的胜利回合 ${identity.winningGuessSampleSize} 个 · 平均 ${identity.averageWinningGuesses} 次`
                : "胜局猜数暂无 · 仅统计有猜测记录的胜利回合"
            }
            action={
              <Badge variant="outline" className="rounded-none">
                {history.length} 回合
              </Badge>
            }
          />

          {history.length ? (
            <div>
              <p className="border-b border-foreground/15 px-5 py-2 text-xs text-muted-foreground">
                每条记录代表一个回合；同一房间会连续分组，比分为回合结束时的累计比分。
              </p>

              <div
                data-testid="stats-mobile-round-list"
                className="divide-y divide-foreground/20 lg:hidden"
              >
                {historyGroups.map((group) => (
                  <section key={group.key} className="p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold">
                        {MODE_LABELS[group.entries[0].mode]}
                        {group.roomCode ? ` · 房间 ${group.roomCode}` : ""}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {group.entries.length} 回合
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {group.entries.map((entry) => (
                        <article
                          key={entry.id}
                          className="border border-foreground/20 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-xs font-semibold">
                                R{entry.roundNumber} · BO{entry.bestOf}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                累计比分{" "}
                                <span className="font-mono text-foreground">
                                  {entry.selfScore} : {entry.opponentScore}
                                </span>
                                {" · "}
                                <GuessCount entry={entry} />
                              </p>
                            </div>
                            <Badge
                              variant={
                                entry.result === "win" ? "default" : "outline"
                              }
                              className="rounded-none"
                            >
                              {RESULT_LABELS[entry.result]}
                            </Badge>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-foreground/15 pt-2">
                            <time className="text-xs text-muted-foreground">
                              {formatTime(entry.completedAt)}
                            </time>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-9 rounded-none text-primary"
                              onClick={() => setReplay(entry)}
                            >
                              <PlayIcon />
                              详情
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <div
                data-testid="stats-desktop-round-table"
                className="hidden lg:block"
              >
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="border-foreground/20 hover:bg-transparent">
                    <TableHead className="w-[18%]">模式 / 房间</TableHead>
                    <TableHead className="w-[11%]">结果</TableHead>
                    <TableHead className="w-[14%]">回合</TableHead>
                    <TableHead className="w-[14%]">累计比分</TableHead>
                    <TableHead className="w-[15%]">猜测记录</TableHead>
                    <TableHead className="w-[18%]">完成时间</TableHead>
                    <TableHead className="w-24 text-right">详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyGroups.map((group) => (
                    <Fragment key={group.key}>
                      {group.roomCode ? (
                        <TableRow className="border-foreground/20 bg-muted/35 hover:bg-muted/35">
                          <TableCell
                            colSpan={7}
                            className="px-3 py-2 text-xs font-medium text-muted-foreground"
                          >
                            {MODE_LABELS[group.entries[0].mode]} · 房间{" "}
                            <span className="font-mono text-foreground">
                              {group.roomCode}
                            </span>
                            {" · "}
                            {group.entries.length} 回合
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {group.entries.map((entry) => (
                        <TableRow
                          key={entry.id}
                          className="border-foreground/15 hover:bg-primary/[0.025]"
                        >
                          <TableCell>
                            <p className="truncate text-sm font-medium">
                              {MODE_LABELS[entry.mode]}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {entry.roomCode ?? "—"}
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
                          <TableCell className="text-xs">
                            <GuessCount entry={entry} />
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
                            >
                              <PlayIcon />
                              详情
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <ClockCounterClockwiseIcon className="mx-auto size-8 text-primary" />
                <p className="mt-4 font-medium">尚无回合记录</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  完成挑战后可在此查看回合详情。
                </p>
                <Button asChild className="mt-5 rounded-none">
                  <Link to="/play/daily">开始今日挑战</Link>
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>

      <Dialog
        open={Boolean(replay)}
        onOpenChange={(open) => !open && setReplay(null)}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] max-w-5xl gap-0 overflow-y-auto rounded-none p-0 sm:max-w-5xl"
          closeLabel={STATS_REPLAY_CLOSE_LABEL}
          onOpenAutoFocus={(event) =>
            focusReplayTitle(event, replayTitleRef.current)
          }
        >
          <DialogHeader className="border-b border-foreground/20 p-5 pr-14">
            <DialogTitle
              ref={replayTitleRef}
              tabIndex={-1}
              className="text-xl outline-none"
            >
              对局详情
            </DialogTitle>
            <DialogDescription>
              {replay
                ? `${MODE_LABELS[replay.mode]} · R${replay.roundNumber} · ${RESULT_LABELS[replay.result]}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {replay ? <ReplayDetails entry={replay} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
