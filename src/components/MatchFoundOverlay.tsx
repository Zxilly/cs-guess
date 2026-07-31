import { t } from "@lingui/core/macro";
import { useRef } from "react";
import {
  ArrowRightIcon,
  LightningIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GameDifficulty, PartySize } from "@/types/game";

const difficultyLabels: Record<GameDifficulty, string> = {
  easy: t`简单`,
  full: t`完整`,
  hard: t`困难`,
};

interface MatchFoundOverlayProps {
  playerNames: readonly string[];
  partySize: PartySize;
  bestOf: number;
  difficulty: GameDifficulty;
  onEnter: () => void;
}

export function MatchFoundOverlay({
  playerNames,
  partySize,
  bestOf,
  difficulty,
  onEnter,
}: MatchFoundOverlayProps) {
  const enterButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        aria-label={t`匹配成功`}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          enterButtonRef.current?.focus();
        }}
        overlayClassName="bg-background/96 backdrop-blur-sm"
        className="max-h-[calc(100svh-2rem)] w-full max-w-4xl gap-0 overflow-auto rounded-none border border-primary bg-background p-0 shadow-[0_28px_90px_rgba(0,92,255,0.18)] duration-500 motion-reduce:animate-none motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between border-b border-foreground/20 px-5 py-4 sm:px-7">
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-primary">
            Match Found
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {difficultyLabels[difficulty]} · BO{bestOf}
          </span>
        </div>

        <div className="px-5 py-9 text-center sm:px-10 sm:py-12">
          <span className="mx-auto grid size-14 place-items-center border border-primary bg-primary text-primary-foreground">
            <LightningIcon className="size-7" weight="fill" />
          </span>
          <DialogTitle className="mt-6 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
            {t`对手已就位`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t`匹配已经完成，立即进入对局。`}
          </DialogDescription>

          <div
            className={[
              "mx-auto mt-8 grid max-w-2xl border border-foreground/20",
              partySize === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2",
            ].join(" ")}
          >
            {Array.from({ length: partySize }, (_, index) => {
              const slotLabel = index === 0 ? t`你` : t`对手 ${index}`;
              const playerName =
                playerNames[index] ??
                (index === 0 ? t`你的身份` : t`等待中的对手 ${index}`);
              return (
                <div
                  key={`player-slot-${index}`}
                  className={[
                    "min-w-0 border-r border-foreground/20 px-3 py-5 text-center last:border-r-0",
                    partySize === 4
                      ? "[&:nth-child(-n+2)]:border-b sm:border-b-0 sm:even:border-r sm:last:border-r-0"
                      : "even:border-r-0",
                  ].join(" ")}
                >
                  <UsersThreeIcon className="mx-auto size-5 text-primary" />
                  <p className="mt-3 truncate font-semibold">{playerName}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    {slotLabel}
                  </p>
                </div>
              );
            })}
          </div>

          <Button
            ref={enterButtonRef}
            type="button"
            size="lg"
            className="mt-8 min-w-48 justify-between rounded-none"
            onClick={onEnter}
          >
            {t`立即进入`}
            <ArrowRightIcon />
          </Button>
        </div>

        <div className="h-1 overflow-hidden bg-primary/15" aria-hidden="true">
          <div className="h-full w-full origin-left animate-[match-found-progress_1.7s_linear_forwards] bg-primary motion-reduce:w-0 motion-reduce:animate-none" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
