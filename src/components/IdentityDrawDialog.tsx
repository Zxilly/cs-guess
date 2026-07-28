import { CheckCircleIcon, DiceFiveIcon } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
} from "react";

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
import { PlayerAvatar } from "@/components/PlayerAvatar";
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
  errorMessage?: string | null;
  remainingCredits: number;
  allowKeepCurrent?: boolean;
  allowReroll?: boolean;
  rerollReady?: boolean;
  acceptLabel?: string;
  onOpenChange: (open: boolean) => void;
  onKeep: () => void;
  onReroll: () => void;
  onAccept: () => void;
  onCloseAutoFocus?: ComponentProps<
    typeof DialogContent
  >["onCloseAutoFocus"];
}

export function IdentityDrawDialog({
  open,
  poolLabel,
  rollKey,
  items,
  winner,
  winnerIndex,
  revealed,
  errorMessage,
  remainingCredits,
  allowKeepCurrent = true,
  allowReroll = true,
  rerollReady = true,
  acceptLabel = "使用新身份",
  onOpenChange,
  onKeep,
  onReroll,
  onAccept,
  onCloseAutoFocus,
}: IdentityDrawDialogProps) {
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  const focusedRollKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      open &&
      revealed &&
      focusedRollKeyRef.current !== rollKey
    ) {
      focusedRollKeyRef.current = rollKey;
      acceptButtonRef.current?.focus();
    }
  }, [open, revealed, rollKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-foreground/45 backdrop-blur-[3px]"
        onOpenAutoFocus={(event) => {
          if (!revealed) return;
          event.preventDefault();
          acceptButtonRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className="identity-draw-dialog max-h-[calc(100svh-1.5rem)] min-w-0 gap-0 overflow-x-hidden overflow-y-auto rounded-none border border-foreground/30 bg-background p-0 shadow-2xl ring-0"
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
                  <PlayerAvatar
                    player={player}
                    className="mx-auto mb-2 size-14"
                  />
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
        >
          {revealed ? (
            <div>
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label={`第 ${rollKey} 次抽取结果：${winner.nickname}`}
              >
                抽取结果：{winner.nickname}
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <PlayerAvatar player={winner} className="size-14" eager />
                    <CheckCircleIcon
                      className="absolute -right-1 -bottom-1 size-5 bg-background text-primary"
                      weight="fill"
                    />
                  </div>
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
                      disabled={remainingCredits < 1 || !rerollReady}
                      onClick={onReroll}
                    >
                      {remainingCredits < 1
                        ? "无法重抽"
                        : rerollReady
                          ? `重抽 · ${remainingCredits}`
                          : "准备重抽…"}
                    </Button>
                  ) : null}
                  <Button
                    ref={acceptButtonRef}
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
              {errorMessage ? (
                <p
                  className="mt-3 text-sm text-destructive"
                  role="alert"
                >
                  {errorMessage}
                </p>
              ) : null}
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
