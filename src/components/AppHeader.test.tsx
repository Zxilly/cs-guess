import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

describe("AppHeader mobile contract", () => {
  it("keeps the complete brand visible and exposes a descriptive home link", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader subtitle="职业选手竞猜" />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-layout="app-header"');
    expect(markup).toContain('aria-label="CS GUESS · 职业选手竞猜"');
    expect(markup).toContain(">CS GUESS</p>");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).not.toContain("truncate text-lg font-bold");
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
