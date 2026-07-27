import { ArrowLeftIcon, CrosshairIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  subtitle: string;
  action?: ReactNode;
  backToLobby?: boolean;
}

export function AppHeader({
  subtitle,
  action,
  backToLobby = false,
}: AppHeaderProps) {
  return (
    <header className="border-b border-foreground/20">
      <div className="app-container flex min-h-20 items-center justify-between gap-5 py-4">
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <CrosshairIcon
            className="size-9 shrink-0 text-primary"
            weight="regular"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold tracking-[0.08em]">
              CS GUESS
            </p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </Link>
        {action ??
          (backToLobby ? (
            <Button asChild variant="outline" size="sm" className="rounded-none">
              <Link to="/">
                <ArrowLeftIcon />
                模式大厅
              </Link>
            </Button>
          ) : null)}
      </div>
    </header>
  );
}
