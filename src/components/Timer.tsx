import { t } from "@lingui/core/macro";
import { cn } from "@/lib/utils";

interface TimerProps {
  seconds: number;
  className?: string;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

export function Timer({ seconds, className }: TimerProps) {
  const isUrgent = seconds <= 30;

  return (
    <div
      className={cn(
        "font-mono font-medium leading-none tabular-nums",
        isUrgent ? "text-destructive" : "text-foreground",
        className,
      )}
      aria-label={t`剩余时间 ${formatTime(seconds)}`}
    >
      {formatTime(seconds)}
    </div>
  );
}
