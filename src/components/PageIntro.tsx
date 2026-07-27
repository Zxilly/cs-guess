import type { ReactNode } from "react";

interface PageIntroProps {
  eyebrow: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  help?: ReactNode;
}

export function PageIntro({
  eyebrow,
  title,
  description,
  aside,
  help,
}: PageIntroProps) {
  return (
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="app-eyebrow">{eyebrow}</p>
          {help}
        </div>
        <h1 className="app-page-title">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
