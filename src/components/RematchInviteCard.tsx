import {
  ArrowRightIcon,
  SwordIcon,
  XIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface RematchInviteCardProps {
  requesterName: string;
  secondsLeft: number;
  pending?: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function RematchInviteCard({
  requesterName,
  secondsLeft,
  pending = null,
  onAccept,
  onDecline,
}: RematchInviteCardProps) {
  return (
    <aside
      className="fixed top-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] border border-foreground/25 bg-background shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
      aria-labelledby="rematch-invite-title"
      aria-live="assertive"
    >
      <div className="flex items-center justify-between border-b border-foreground/20 px-4 py-3">
        <div className="flex items-center gap-2 text-primary">
          <SwordIcon className="size-5 shrink-0" aria-hidden="true" />
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em]">
            Rematch request
          </p>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {secondsLeft}s
        </span>
      </div>
      <div className="px-4 py-4">
        <h2 id="rematch-invite-title" className="text-lg font-bold">
          {requesterName} 请求再次对战
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          接受后将保留当前规则，并在原房间开启全新的系列赛。
        </p>
      </div>
      <div className="grid grid-cols-2 border-t border-foreground/20">
        <Button
          type="button"
          variant="ghost"
          className="h-12 rounded-none border-r border-foreground/20"
          disabled={pending !== null}
          onClick={onDecline}
        >
          {pending === "decline" ? (
            <Spinner role="presentation" aria-hidden="true" />
          ) : (
            <XIcon />
          )}
          拒绝
        </Button>
        <Button
          type="button"
          className="h-12 rounded-none"
          disabled={pending !== null}
          onClick={onAccept}
        >
          {pending === "accept" ? (
            <Spinner role="presentation" aria-hidden="true" />
          ) : (
            <ArrowRightIcon />
          )}
          接受重赛
        </Button>
      </div>
    </aside>
  );
}
