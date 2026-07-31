import { t } from "@lingui/core/macro";
import {
  ArrowRightIcon,
  CalendarDotsIcon,
  GlobeHemisphereWestIcon,
  MedalIcon,
  ScalesIcon,
  ShieldIcon,
  TrophyIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { playerRoleNameZh, type Player } from "@/data/players";
import { countryNameZh } from "@/lib/country-geography";
import { playerRoleIcon } from "@/lib/player-role-icons";
import { displayTeamName } from "@/lib/player-display";
import { focusCelebrationTitleOnOpen } from "@/lib/daily-result-focus";
import {
  soloLossCopy,
  type SoloLossReason,
} from "@/lib/solo-result-copy";
import { playBattleResultSound } from "@/lib/app-sound";
import {
  MAX_GUESSES,
  type BattleFinishReason,
  type BattleSeriesFinishReason,
  type BattleSeriesStatus,
} from "@/types/game";

type ResultOutcome = "win" | "loss" | "draw";
type ResultCopy = {
  eyebrow: string;
  title: string;
  summary: string;
};
type DepartureKind = "explicit_leave" | "disconnect_timeout" | "legacy";

interface CelebrationOverlayProps {
  outcome: ResultOutcome;
  seriesComplete: boolean;
  score: string;
  maxGuesses?: number;
  mysteryPlayer: Player;
  context?: "battle" | "daily" | "solo";
  nextRoundSeconds?: number;
  nextRoundPaused?: boolean;
  tiebreak?: boolean;
  waitingForHostRestart?: boolean;
  onClose: () => void;
  onExit?: () => void;
  exitLabel?: string;
  onRematch?: () => void;
  rematchLabel?: string;
  rematchDisabled?: boolean;
  rematchDisabledReason?: string;
  onCloseAutoFocus?: (event: { preventDefault(): void }) => void;
  lossReason?: SoloLossReason;
  finishReason?: BattleFinishReason;
  seriesStatus?: BattleSeriesStatus;
  seriesFinishReason?: BattleSeriesFinishReason;
  soundEnabled?: boolean;
  standings?: readonly {
    label: string;
    name: string;
    score: number;
    rankLabel: string;
    self: boolean;
  }[];
}

function departureKind(
  finishReason?: BattleFinishReason,
): DepartureKind {
  if (finishReason === "member_left") return "explicit_leave";
  if (finishReason === "disconnect_forfeit") return "disconnect_timeout";
  return "legacy";
}

function terminalSeriesCopy(
  outcome: ResultOutcome,
  seriesStatus: BattleSeriesStatus,
  seriesFinishReason?: BattleSeriesFinishReason,
  finishReason?: BattleFinishReason,
): ResultCopy | undefined {
  if (
    seriesStatus === "completed" &&
    seriesFinishReason === "member_left_forfeit"
  ) {
    const kind = departureKind(finishReason);
    const summaries: Record<
      DepartureKind,
      Record<Exclude<ResultOutcome, "draw">, string>
    > = {
      explicit_leave: {
        win: t`对手已离开，服务器判定你赢得本系列。`,
        loss: t`你已离开，服务器判定本系列结束。`,
      },
      disconnect_timeout: {
        win: t`对手断线超时，服务器判定你赢得本系列。`,
        loss: t`你断线超时，服务器判定本系列结束。`,
      },
      legacy: {
        win: t`服务器判定你赢得本系列。`,
        loss: t`服务器判定本系列结束。`,
      },
    };
    const resolvedOutcome = outcome === "draw" ? "loss" : outcome;
    return {
      eyebrow: "Series complete",
      title: outcome === "win" ? t`系列赛胜利` : t`系列赛失利`,
      summary: summaries[kind][resolvedOutcome],
    };
  }

  if (seriesStatus === "abandoned") {
    const kind =
      seriesFinishReason === "member_left_abandoned"
        ? departureKind(finishReason)
        : "legacy";
    const summaries: Record<DepartureKind, string> = {
      explicit_leave: t`有成员离开，本系列已结束。最终排名已保留。`,
      disconnect_timeout:
        t`有成员断线超时，本系列已结束。最终排名已保留。`,
      legacy: t`本系列已结束。最终排名已保留。`,
    };
    return {
      eyebrow: "Series complete",
      title: t`系列赛已结束`,
      summary: summaries[kind],
    };
  }

  return undefined;
}

function resultCopy(
  outcome: ResultOutcome,
  seriesComplete: boolean,
  context: "battle" | "daily" | "solo",
  lossReason?: SoloLossReason,
  finishReason?: BattleFinishReason,
  seriesStatus?: BattleSeriesStatus,
  seriesFinishReason?: BattleSeriesFinishReason,
  maxGuesses = MAX_GUESSES,
) {
  if (context === "daily") {
    return outcome === "win"
      ? {
          eyebrow: "Daily complete",
          title: t`今日挑战完成`,
          summary: t`你成功锁定了今日的神秘选手。`,
        }
      : {
          eyebrow: "Daily complete",
          title: t`今日挑战结束`,
          summary:
            lossReason === "timeout"
              ? t`三分钟倒计时已结束，答案已经揭晓。`
              : lossReason === "attempts-exhausted"
                ? t`八次猜测机会已用完，答案已经揭晓。`
                : t`今日挑战未完成，答案已经揭晓。`,
        };
  }
  if (context === "solo") {
    if (outcome === "win") {
      return {
          eyebrow: "Solo complete",
          title: t`单人练习完成`,
          summary: t`你成功锁定了本局的神秘选手。`,
      };
    }
    const lossCopy = soloLossCopy(lossReason, maxGuesses);
    return {
      eyebrow: "Solo complete",
      title: lossCopy.title,
      summary: lossCopy.dialogSummary,
    };
  }
  const terminalCopy = terminalSeriesCopy(
    outcome,
    seriesStatus ?? "active",
    seriesFinishReason,
    finishReason,
  );
  if (terminalCopy) return terminalCopy;
  const battleSummary = (() => {
    if (finishReason === "disconnect_forfeit") {
      if (outcome === "win") {
        return seriesComplete
          ? t`对手重连宽限期结束，你赢得了本场系列赛。`
          : t`对手重连宽限期结束，本局由你获胜。`;
      }
      if (outcome === "loss") {
        return seriesComplete
          ? t`你的重连宽限期结束，对手赢得了本场系列赛。`
          : t`你的重连宽限期结束，本局判负。`;
      }
    }
    if (finishReason === "timeout") {
      return outcome === "draw"
        ? t`倒计时结束，本局未分出胜负。`
        : t`倒计时结束，服务器已完成本局裁定。`;
    }
    if (finishReason === "max_guesses") {
      return outcome === "draw"
        ? t`所有玩家均已用完猜测次数，本局未分出胜负。`
        : t`猜测次数已经用尽，服务器已完成本局裁定。`;
    }
    if (finishReason === "solved") {
      if (outcome === "win") {
        return seriesComplete
          ? t`你率先拿到本场所需胜局。`
          : t`已先于对手确定目标选手。`;
      }
      if (outcome === "loss") {
        return seriesComplete
          ? t`对手率先拿到本场所需胜局。`
          : t`对手已先确定目标选手。`;
      }
      return t`双方本局都没能锁定答案。`;
    }
    if (outcome === "win") {
      return seriesComplete ? t`你赢得了本场系列赛。` : t`你赢得了本局。`;
    }
    if (outcome === "loss") {
      return seriesComplete
        ? t`对手赢得了本场系列赛。`
        : t`对手赢得了本局。`;
    }
    return t`本局未分出胜负。`;
  })();
  if (seriesComplete) {
    if (outcome === "win") {
      return {
        eyebrow: "Series complete",
        title: t`系列赛胜利`,
        summary: battleSummary,
      };
    }
    if (outcome === "loss") {
      return {
        eyebrow: "Series complete",
        title: t`系列赛失利`,
        summary: battleSummary,
      };
    }
  }
  if (outcome === "win") {
    return {
      eyebrow: "Round complete",
      title: t`本局胜利`,
      summary: battleSummary,
    };
  }
  if (outcome === "loss") {
    return {
      eyebrow: "Round complete",
      title: t`本局失利`,
      summary: battleSummary,
    };
  }
  return {
    eyebrow: "Round complete",
    title: t`本局平局`,
    summary: battleSummary,
  };
}

export function CelebrationOverlay({
  outcome,
  seriesComplete,
  score,
  maxGuesses = MAX_GUESSES,
  mysteryPlayer,
  context = "battle",
  nextRoundSeconds,
  nextRoundPaused = false,
  tiebreak = false,
  waitingForHostRestart = false,
  onClose,
  onExit,
  exitLabel = t`返回模式大厅`,
  onRematch,
  rematchLabel = t`邀请重赛`,
  rematchDisabled = false,
  rematchDisabledReason,
  onCloseAutoFocus,
  lossReason,
  finishReason,
  seriesStatus = "active",
  seriesFinishReason,
  soundEnabled = true,
  standings,
}: CelebrationOverlayProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const playedSoundKeyRef = useRef("");
  const copy = resultCopy(
    outcome,
    seriesComplete,
    context,
    lossReason,
    finishReason,
    seriesStatus,
    seriesFinishReason,
    maxGuesses,
  );
  useEffect(() => {
    const soundKey = `${outcome}:${score}`;
    const auditMode =
      typeof document !== "undefined" &&
      document.documentElement.hasAttribute("data-audit");
    if (
      context !== "battle" ||
      outcome === "draw" ||
      !soundEnabled ||
      auditMode ||
      playedSoundKeyRef.current === soundKey
    ) {
      return;
    }

    playedSoundKeyRef.current = soundKey;
    return playBattleResultSound(outcome);
  }, [context, outcome, score, soundEnabled]);
  const ResultIcon =
    outcome === "win"
      ? TrophyIcon
      : outcome === "loss"
        ? XCircleIcon
        : ScalesIcon;
  const outcomeClassName = `result-dialog--${outcome}`;
  const details = [
    {
      label: t`战队`,
      value: displayTeamName(mysteryPlayer.team),
      icon: ShieldIcon,
    },
    {
      label: t`国家或地区`,
      value: countryNameZh(mysteryPlayer.countryCode),
      icon: GlobeHemisphereWestIcon,
    },
    {
      label: t`位置`,
      value: playerRoleNameZh(mysteryPlayer.role),
      icon: playerRoleIcon(mysteryPlayer.role),
    },
    { label: t`年龄`, value: mysteryPlayer.age, icon: CalendarDotsIcon },
    {
      label: t`Major 次数`,
      value: mysteryPlayer.majorAppearances,
      icon: MedalIcon,
    },
    {
      label: t`Major 冠军`,
      value: mysteryPlayer.majorWins,
      icon: MedalIcon,
    },
  ];
  const hasNextRoundStatus =
    context === "battle" &&
    !seriesComplete &&
    (nextRoundPaused || nextRoundSeconds !== undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-foreground/45 backdrop-blur-[3px]"
        onOpenAutoFocus={(event) =>
          focusCelebrationTitleOnOpen(event, titleRef.current)
        }
        onCloseAutoFocus={onCloseAutoFocus}
        className={`celebration-enter result-dialog ${outcomeClassName} !left-4 !right-4 max-h-[calc(100svh-2rem)] min-w-0 max-w-[calc(100%-2rem)] !w-auto !translate-x-0 gap-0 overflow-x-hidden overflow-y-auto rounded-none border border-foreground/30 bg-background p-0 shadow-2xl ring-0 sm:!left-1/2 sm:!right-auto sm:!w-[calc(100%-2rem)] sm:max-w-3xl sm:!-translate-x-1/2`}
      >
        <div className="result-dialog__accent h-1" aria-hidden="true" />
        <DialogHeader className="result-dialog__header min-w-0 max-w-full items-center gap-0 border-b border-foreground/15 px-5 pb-5 pt-6 text-center sm:px-10 sm:pb-6 sm:pt-7">
          <div className="result-dialog__icon grid size-10 place-items-center border">
            <ResultIcon className="size-5" weight="duotone" />
          </div>
          <p className="result-dialog__eyebrow mt-4 font-mono text-xs uppercase tracking-[0.12em]">
            {copy.eyebrow}
          </p>
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="mt-2 text-3xl font-bold tracking-[-0.04em] outline-none sm:text-4xl"
          >
            {copy.title}
          </DialogTitle>
          <DialogDescription
            className="mt-3 max-w-full text-sm leading-6"
            aria-live={hasNextRoundStatus ? undefined : "polite"}
            aria-atomic={hasNextRoundStatus ? undefined : "true"}
          >
            {copy.summary}
            {hasNextRoundStatus ? (
              <span
                className="mt-1 block sm:mt-0 sm:ml-1 sm:inline"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {tiebreak ? (
                  t`本轮平局，继续加赛。`
                ) : nextRoundPaused ? (
                  t`等待成员重连后开始下一局。`
                ) : (
                  <>
                    {t`下一局`}{" "}
                    <span className="font-mono font-semibold text-primary">
                      {String(nextRoundSeconds).padStart(2, "0")} {t`秒`}
                    </span>{" "}
                    {t`后自动开始。`}
                  </>
                )}
              </span>
            ) : null}
            {context === "battle" &&
            seriesComplete &&
            waitingForHostRestart ? (
              <span className="mt-1 block">
                {t`留在房间，等待房主开始下一场。`}
              </span>
            ) : null}
          </DialogDescription>
          {context === "battle" && standings && standings.length > 2 ? (
            <div
              className="mt-4 w-full min-w-0 max-w-full overflow-x-auto"
              role="region"
              aria-label={t`${seriesComplete ? t`系列赛最终排行榜` : t`当前排行榜`}，可横向滚动`}
              tabIndex={0}
            >
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                {seriesComplete ? t`最终排行榜` : t`当前排行榜`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                {t`左右滑动查看全部席位`}
              </p>
              <ol className="mt-2 grid min-w-[32rem] grid-cols-4 border border-foreground/20 text-left">
                {standings.map((entry) => (
                  <li
                    key={entry.label}
                    className={`min-w-0 border-r border-foreground/20 p-3 last:border-r-0 ${
                      entry.self ? "bg-primary/[0.06]" : ""
                    }`}
                  >
                    <p className="font-mono text-xs text-muted-foreground">
                      {entry.label} · {entry.rankLabel}
                    </p>
                    <p className="mt-1 truncate font-semibold">{entry.name}</p>
                    <p className="mt-1 font-mono text-lg">{entry.score} {t`分`}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3 font-mono">
              <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                {context === "battle" ? t`当前比分` : t`已用尝试`}
              </span>
              <strong className="result-dialog__score text-xl tracking-[-0.04em]">
                {score}
              </strong>
            </div>
          )}
        </DialogHeader>

        <div className="px-5 py-5 sm:px-10 sm:py-6">
          <div className="result-dialog__answer mb-4 flex min-w-0 items-center gap-4">
            <PlayerAvatar
              player={mysteryPlayer}
              className="size-20"
              eager
            />
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                {context === "daily" ? t`今日答案` : t`本局答案`}
              </p>
              <h3 className="mt-1.5 truncate text-2xl font-bold tracking-[-0.03em]">
                {mysteryPlayer.nickname}
              </h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {mysteryPlayer.name}
              </p>
            </div>
          </div>

          <dl className="border-y border-foreground/20">
            {details.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-4 border-b border-foreground/15 px-1 py-2.5 last:border-b-0"
              >
                <dt className="flex w-28 shrink-0 items-center gap-2 text-sm text-muted-foreground sm:w-auto">
                  <Icon className="size-4 shrink-0" />
                  {label}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-right text-sm font-semibold">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <DialogFooter className="result-dialog__footer sticky bottom-0 z-10 m-0 min-w-0 flex-col justify-center rounded-none border-t border-foreground/15 px-5 py-4 sm:flex-row sm:justify-center sm:px-10">
          {context === "battle" && seriesComplete && (onRematch || onExit) ? (
            <>
              <Button
                variant="outline"
                className="w-full rounded-none sm:w-auto"
                onClick={onClose}
              >
                {t`查看对局`}
              </Button>
              {onRematch ? (
                <div className="w-full sm:w-auto">
                  <Button
                    className="result-dialog__action w-full rounded-none sm:w-auto"
                    onClick={onRematch}
                    disabled={rematchDisabled}
                    aria-describedby={
                      rematchDisabled && rematchDisabledReason
                        ? "battle-rematch-disabled-reason"
                        : undefined
                    }
                  >
                    {rematchLabel}
                    <ArrowRightIcon />
                  </Button>
                  {rematchDisabled && rematchDisabledReason ? (
                    <p
                      id="battle-rematch-disabled-reason"
                      className="mt-1 max-w-52 text-center text-xs text-muted-foreground"
                    >
                      {rematchDisabledReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button
                variant="outline"
                className="w-full rounded-none sm:w-auto"
                onClick={onExit ?? onClose}
              >
                {exitLabel}
              </Button>
            </>
          ) : (
            <Button
              className="result-dialog__action w-full rounded-none sm:w-auto"
              onClick={onClose}
            >
              {context !== "battle"
                ? t`关闭并查看明细`
                : tiebreak
                  ? t`继续加赛`
                  : t`继续下一局`}
              <ArrowRightIcon />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
