import { t } from "@lingui/core/macro";
import { CheckIcon } from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import type { BestOf } from "@/types/game";

const OPTIONS: Array<{
  value: BestOf;
  title: string;
  description: string;
}> = [
  { value: 1, title: "BO1", description: t`一局定胜负` },
  { value: 3, title: "BO3", description: t`先赢两局` },
  { value: 5, title: "BO5", description: t`先赢三局` },
];

interface SeriesSelectorProps {
  value: BestOf;
  onChange: (value: BestOf) => void;
  disabled?: boolean;
  compact?: boolean;
  waitingCounts?: Partial<Record<BestOf, number>>;
}

export function SeriesSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
  waitingCounts,
}: SeriesSelectorProps) {
  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + OPTIONS.length) % OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = OPTIONS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = OPTIONS[nextIndex];
    onChange(next.value);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      className={cn(
        "grid grid-cols-3 border border-foreground/25",
        compact ? null : "gap-px bg-foreground/20",
      )}
      role="radiogroup"
      aria-label={t`比赛赛制`}
    >
      {OPTIONS.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveSelection(event, index)}
            className={cn(
              "relative min-w-0 bg-background text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55",
              compact
                ? "min-h-11 border-r border-foreground/20 px-3 py-2 last:border-r-0"
                : "min-h-24 p-3 sm:p-4",
              selected ? "bg-primary text-primary-foreground" : "hover:bg-primary/[0.04]",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">
                {option.title}
              </span>
              {selected ? <CheckIcon className="size-3.5" weight="bold" /> : null}
            </span>
            {!compact ? (
              <span className="mt-2 flex min-w-0 flex-col items-start gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <span
                  className={cn(
                    "min-w-0 leading-tight",
                    selected
                      ? "text-primary-foreground/75"
                      : "text-muted-foreground",
                  )}
                >
                  {option.description}
                </span>
                {waitingCounts ? (
                  <span
                    className={cn(
                      "shrink-0 font-mono",
                      selected
                        ? "text-primary-foreground"
                        : "text-foreground",
                    )}
                  >
                    {waitingCounts[option.value] ?? 0} {t`人`}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
