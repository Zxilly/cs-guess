import type { ReactNode } from "react";
import { InfoIcon } from "@phosphor-icons/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

export function InfoTip({
  label,
  children,
  side = "top",
  align = "center",
  className,
}: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "grid size-8 min-h-10 min-w-10 place-items-center text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            className,
          )}
          aria-label={label}
        >
          <InfoIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={12}
        className="w-64 rounded-none bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-none ring-0"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
