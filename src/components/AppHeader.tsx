import { ArrowLeftIcon, CrosshairIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { SoundToggle } from "@/components/SoundToggle";
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
      <div
        className="app-container grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-3 sm:flex sm:justify-between sm:gap-5 sm:py-4"
        data-layout="app-header"
      >
        <Link
          to="/"
          aria-label={`CS GUESS · ${subtitle}`}
          className="flex min-h-10 min-w-0 items-center gap-2 sm:gap-3"
        >
          <CrosshairIcon
            className="size-8 shrink-0 text-primary sm:size-9"
            weight="regular"
          />
          <div className="min-w-0">
            <p className="whitespace-nowrap text-base font-bold tracking-[0.08em] sm:text-lg">
              CS GUESS
            </p>
            <p className="whitespace-nowrap text-xs text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </Link>
        <div
          className="flex min-w-0 items-center justify-end gap-1 sm:gap-2"
          data-layout="app-header-actions"
        >
          <SoundToggle />
          {action ??
            (backToLobby ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-none"
              >
                <Link to="/">
                  <ArrowLeftIcon />
                  模式大厅
                </Link>
              </Button>
            ) : null)}
        </div>
      </div>
    </header>
  );
}
