import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SeriesSelector } from "@/components/SeriesSelector";

describe("SeriesSelector mobile layout", () => {
  it("uses one shared height for compact controls and option cards", () => {
    const compact = renderToStaticMarkup(
      <SeriesSelector value={3} onChange={vi.fn()} compact />,
    );
    const full = renderToStaticMarkup(
      <SeriesSelector value={3} onChange={vi.fn()} />,
    );

    expect(compact.match(/min-h-11/g)).toHaveLength(3);
    expect(full.match(/min-h-24/g)).toHaveLength(3);
  });

  it("keeps non-compact BO1, BO3 and BO5 in three equal columns at 390px", () => {
    const markup = renderToStaticMarkup(
      <SeriesSelector
        value={3}
        onChange={vi.fn()}
        waitingCounts={{ 1: 12, 3: 8, 5: 4 }}
      />,
    );

    expect(markup).toContain("grid grid-cols-3");
    expect(markup).not.toContain("sm:grid-cols-3");
    expect(markup.match(/role="radio"/g)).toHaveLength(3);
    expect(markup).toContain("BO1");
    expect(markup).toContain("BO3");
    expect(markup).toContain("BO5");
  });

  it("stacks descriptions and counts on narrow cells without dropping either value", () => {
    const markup = renderToStaticMarkup(
      <SeriesSelector
        value={1}
        onChange={vi.fn()}
        waitingCounts={{ 1: 123, 3: 45, 5: 6 }}
      />,
    );

    expect(markup).toContain(
      "flex min-w-0 flex-col items-start gap-1 text-xs",
    );
    expect(markup).toContain("sm:flex-row");
    expect(markup).toContain("一局定胜负");
    expect(markup).toContain("123 人");
    expect(markup).toContain("先赢两局");
    expect(markup).toContain("45 人");
    expect(markup).toContain("先赢三局");
    expect(markup).toContain("6 人");
  });
});
