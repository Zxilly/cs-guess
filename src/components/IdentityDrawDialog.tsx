import { CheckCircleIcon, DiceFiveIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Player } from "@/data/players";
import { countryNameZh } from "@/lib/country-geography";
import { cn } from "@/lib/utils";

interface IdentityDrawDialogProps {
  open: boolean;
  poolLabel: string;
  rollKey: number;
  items: readonly Player[];
  winner: Player;
  winnerIndex: number;
  revealed: boolean;
  remainingCredits: number;
  allowKeepCurrent?: boolean;
  allowReroll?: boolean;
  acceptLabel?: string;
  onOpenChange: (open: boolean) => void;
  onKeep: () => void;
  onReroll: () => void;
  onAccept: () => void;
}

export function IdentityDrawDialog({
  open,
  poolLabel,
  rollKey,
  items,
  winner,
  winnerIndex,
  revealed,
  remainingCredits,
  allowKeepCurrent = true,
  allowReroll = true,
  acceptLabel = "使用新身份",
  onOpenChange,
  onKeep,
  onReroll,
  onAccept,
}: IdentityDrawDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-foreground/45 backdrop-blur-[3px]"
        className="min-w-0 w-[calc(100%-1.5rem)] max-w-4xl gap-0 overflow-hidden rounded-none border border-foreground/30 bg-background p-0 shadow-2xl ring-0 sm:max-w-4xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-foreground/20 px-5 py-4 text-left">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <DiceFiveIcon className="text-primary" />
              {poolLabel}
            </DialogTitle>
            <DialogDescription className="sr-only">
              选手卡横向滚动，并由中心指针选出新的身份。
            </DialogDescription>
          </div>
          <Badge
            variant={revealed ? "default" : "outline"}
            className="rounded-none font-mono"
          >
            {revealed ? "抽取完成" : "正在抽取"}
          </Badge>
        </DialogHeader>

        <div className="relative min-w-0 overflow-hidden bg-muted/30 py-8 sm:py-10">
          <div className="identity-roulette-marker" aria-hidden="true">
            <span />
          </div>
          <div className="identity-roulette-viewport">
            <div
              key={rollKey}
              className="identity-roulette-track"
              data-rolling={!revealed}
              style={
                {
                  "--roulette-winner-offset": `${winnerIndex * 152 + 72}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              {items.map((player, index) => (
                <div
                  key={`${player.id}-${index}`}
                  className={cn(
                    "identity-roulette-card",
                    revealed && index === winnerIndex && "is-winner",
                  )}
                >
                  <p className="truncate text-lg font-semibold tracking-[-0.03em]">
                    {player.nickname}
                  </p>
                  <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    {countryNameZh(player.countryCode)}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {player.team}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "grid min-h-24 items-center border-t border-foreground/20 px-5 py-4",
            revealed && "identity-roulette-result",
          )}
          role="status"
          aria-live="polite"
        >
          {revealed ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <CheckCircleIcon
                  className="size-7 shrink-0 text-primary"
                  weight="fill"
                />
                <div className="min-w-0">
                  <p className="truncate text-xl font-semibold">
                    {winner.nickname}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {countryNameZh(winner.countryCode)} · {winner.team}
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  "grid gap-2 sm:flex",
                  allowKeepCurrent || allowReroll
                    ? "grid-cols-2"
                    : "grid-cols-1",
                )}
              >
                {allowKeepCurrent ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-none"
                    onClick={onKeep}
                  >
                    保留当前
                  </Button>
                ) : null}
                {allowReroll ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-none"
                    disabled={remainingCredits < 1}
                    onClick={onReroll}
                  >
                    {remainingCredits > 0
                      ? `重抽 · ${remainingCredits}`
                      : "无法重抽"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className={cn(
                    "rounded-none",
                    (allowKeepCurrent || allowReroll) && "col-span-2",
                  )}
                  onClick={onAccept}
                >
                  {acceptLabel}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-center font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
              锁定中…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
