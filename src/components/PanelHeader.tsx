import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PanelHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  icon,
  description,
  action,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-16 items-center justify-between gap-4 border-b border-foreground/20 px-5 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold">{title}</h2>
        </div>
        {description ? (
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
