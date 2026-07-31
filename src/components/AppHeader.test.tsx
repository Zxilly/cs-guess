import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

describe("AppHeader mobile contract", () => {
  it("reserves mobile width for the complete brand and hides only its subtitle", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader subtitle="职业选手竞猜" />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-layout="app-header"');
    expect(markup).toContain('aria-label="CS GUESS · 职业选手竞猜"');
    expect(markup).toContain(">CS GUESS</p>");
    expect(markup).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(markup).toContain("min-h-10 shrink-0");
    expect(markup).toContain(
      "hidden whitespace-nowrap text-xs text-muted-foreground sm:block",
    );
    expect(markup).toContain('aria-label="静音全站音效"');
  });

  it("keeps injected header actions inside the dedicated mobile action area", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader
          subtitle="职业选手竞猜"
          action={<Button size="sm">身份</Button>}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-layout="app-header-actions"');
    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('data-size="sm"');
    expect(markup).toContain(">身份</button>");
  });
});
