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
import { useRef } from "react";

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

type ResultOutcome = "win" | "loss" | "draw";

interface CelebrationOverlayProps {
  outcome: ResultOutcome;
  seriesComplete: boolean;
  score: string;
  mysteryPlayer: Player;
  context?: "battle" | "daily";
  nextRoundSeconds?: number;
  onClose: () => void;
  onExit?: () => void;
}

function resultCopy(
  outcome: ResultOutcome,
  seriesComplete: boolean,
  context: "battle" | "daily",
) {
  if (context === "daily") {
    return outcome === "win"
      ? {
          eyebrow: "Daily complete",
          title: "今日挑战完成",
          summary: "你成功锁定了今日的神秘选手。",
        }
      : {
          eyebrow: "Daily complete",
          title: "今日挑战结束",
          summary: "今天未能锁定答案，明日可以再次挑战。",
        };
  }
  if (seriesComplete) {
    if (outcome === "win") {
      return {
        eyebrow: "Series complete",
        title: "系列赛胜利",
        summary: "你率先拿到本场所需胜局。",
      };
    }
    if (outcome === "loss") {
      return {
        eyebrow: "Series complete",
        title: "系列赛失利",
        summary: "对手率先拿到本场所需胜局。",
      };
    }
  }
  if (outcome === "win") {
    return {
      eyebrow: "Round complete",
      title: "本局胜利",
      summary: "你先一步锁定了神秘选手。",
    };
  }
  if (outcome === "loss") {
    return {
      eyebrow: "Round complete",
      title: "本局失利",
      summary: "对手先一步锁定了神秘选手。",
    };
  }
  return {
    eyebrow: "Round complete",
    title: "本局平局",
    summary: "双方本局都没能锁定答案。",
  };
}

export function CelebrationOverlay({
  outcome,
  seriesComplete,
  score,
  mysteryPlayer,
  context = "battle",
  nextRoundSeconds,
  onClose,
  onExit,
}: CelebrationOverlayProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const copy = resultCopy(outcome, seriesComplete, context);
  const ResultIcon =
    outcome === "win"
      ? TrophyIcon
      : outcome === "loss"
        ? XCircleIcon
        : ScalesIcon;
  const details = [
    { label: "战队", value: mysteryPlayer.team, icon: ShieldIcon },
    {
      label: "国家或地区",
      value: countryNameZh(mysteryPlayer.countryCode),
      icon: GlobeHemisphereWestIcon,
    },
    {
      label: "位置",
      value: playerRoleNameZh(mysteryPlayer.role),
      icon: playerRoleIcon(mysteryPlayer.role),
    },
    { label: "年龄", value: mysteryPlayer.age, icon: CalendarDotsIcon },
    {
      label: "Major 次数",
      value: mysteryPlayer.majorAppearances,
      icon: MedalIcon,
    },
  ];

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
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        className="celebration-enter !left-4 !right-4 max-h-[calc(100svh-2rem)] !w-auto max-w-none !translate-x-0 gap-0 overflow-y-auto rounded-none border border-foreground/30 bg-background p-0 shadow-2xl ring-0 sm:!left-1/2 sm:!right-auto sm:!w-[calc(100%-2rem)] sm:max-w-3xl sm:!-translate-x-1/2"
      >
        <div className="h-1 bg-primary" aria-hidden="true" />
        <DialogHeader className="items-center gap-0 border-b border-foreground/15 px-5 pb-5 pt-6 text-center sm:px-10 sm:pb-6 sm:pt-7">
          <div className="grid size-10 place-items-center border border-primary/35 bg-primary/[0.06] text-primary">
            <ResultIcon className="size-5" weight="duotone" />
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            {copy.eyebrow}
          </p>
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="mt-2 text-3xl font-bold tracking-[-0.04em] outline-none sm:text-4xl"
          >
            {copy.title}
          </DialogTitle>
          <DialogDescription className="mt-3 max-w-full text-sm leading-6">
            {copy.summary}
            {context === "battle" &&
            !seriesComplete &&
            nextRoundSeconds !== undefined ? (
              <span className="mt-1 block sm:mt-0 sm:ml-1 sm:inline">
                下一局{" "}
                <span
                  className="font-mono font-semibold text-primary"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {String(nextRoundSeconds).padStart(2, "0")} 秒
                </span>{" "}
                后开始。
              </span>
            ) : null}
          </DialogDescription>
          <div className="mt-4 flex items-center gap-3 font-mono">
            <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              {context === "daily" ? "已用尝试" : "当前比分"}
            </span>
            <strong className="text-xl tracking-[-0.04em] text-foreground">
              {score}
            </strong>
          </div>
        </DialogHeader>

        <div className="px-5 py-5 sm:px-10 sm:py-6">
          <div className="mb-4 flex min-w-0 items-center gap-4">
            <PlayerAvatar
              player={mysteryPlayer}
              className="size-20"
              eager
            />
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {context === "daily" ? "今日答案" : "本局答案"}
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

        <DialogFooter className="m-0 flex-row justify-center rounded-none border-t border-foreground/15 bg-transparent px-5 py-4 sm:justify-center sm:px-10">
          <Button
            className="w-full rounded-none sm:w-auto"
            onClick={
              context === "daily"
                ? onClose
                : seriesComplete
                  ? (onExit ?? onClose)
                  : onClose
            }
          >
            {context === "daily"
              ? "查看结果"
              : seriesComplete
                ? "返回模式大厅"
                : "查看对局"}
            <ArrowRightIcon />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
