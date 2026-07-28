import {
  CheckIcon,
  FireIcon,
  TrophyIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";

import {
  SOLO_DIFFICULTIES,
  soloMysteryPool,
} from "@/lib/solo-game";
import type { GameDifficulty } from "@/types/game";

const difficultyIcons = {
  easy: TrophyIcon,
  full: UsersThreeIcon,
  hard: FireIcon,
} satisfies Record<GameDifficulty, Icon>;

interface DifficultySelectorProps {
  value: GameDifficulty;
  onChange: (value: GameDifficulty) => void;
  disabled?: boolean;
}

export function DifficultySelector({
  value,
  onChange,
  disabled = false,
}: DifficultySelectorProps) {
  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % SOLO_DIFFICULTIES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + SOLO_DIFFICULTIES.length) %
        SOLO_DIFFICULTIES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SOLO_DIFFICULTIES.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    onChange(SOLO_DIFFICULTIES[nextIndex].id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      className="grid grid-cols-3 border border-foreground/25"
      role="radiogroup"
      aria-label="题库难度"
    >
      {SOLO_DIFFICULTIES.map((option, index) => {
        const selected = value === option.id;
        const DifficultyIcon = difficultyIcons[option.id];
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => moveSelection(event, index)}
            className={[
              "relative flex min-h-24 min-w-0 flex-col justify-between border-r border-foreground/20 p-3 text-left transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 sm:p-4",
              selected
                ? "bg-primary text-primary-foreground"
                : "hover:bg-primary/[0.035]",
            ].join(" ")}
          >
            <span className="flex items-center justify-between gap-2">
              <DifficultyIcon className="size-5 shrink-0" weight="light" />
              {selected ? <CheckIcon className="size-4 shrink-0" weight="bold" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{option.label}</span>
              <span
                className={[
                  "mt-0.5 flex min-w-0 items-baseline gap-1 text-xs leading-tight",
                  selected
                    ? "text-primary-foreground/85"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                <span className="truncate">{option.poolLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0 font-mono">
                  {soloMysteryPool(option.id).length} 人
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
