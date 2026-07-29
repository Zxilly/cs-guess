/// <reference types="node" />

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

const css = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

describe("Button mobile touch contract", () => {
  it("uses the shared 44px default, 36px compact, and 48px prominent size scale", () => {
    expect(renderToStaticMarkup(<Button>默认</Button>)).toContain("h-11");
    expect(
      renderToStaticMarkup(<Button size="sm">紧凑</Button>),
    ).toContain("h-9");
    expect(
      renderToStaticMarkup(<Button size="lg">强调</Button>),
    ).toContain("h-12");
    expect(
      renderToStaticMarkup(<Button size="icon" aria-label="图标" />),
    ).toContain("size-11");
  });

  it("keeps only the celebration animation that is referenced by the UI", () => {
    expect(css).toContain("@keyframes celebration-enter");
    expect(css).not.toContain("celebration-trophy");
    expect(css).not.toContain("celebration-spark");
  });

  it("removes the shared active transform and transition for reduced motion", () => {
    const markup = renderToStaticMarkup(<Button>测试</Button>);

    expect(markup).toContain(
      "motion-safe:active:not-aria-[haspopup]:translate-y-px",
    );
    expect(markup).toContain("motion-reduce:transform-none");
    expect(markup).toContain("motion-reduce:transition-none");
  });

  it("identifies each maintained interactive size in rendered markup", () => {
    const sizes = [
      "default",
      "xs",
      "sm",
      "lg",
      "icon",
      "icon-xs",
      "icon-sm",
      "icon-lg",
    ] as const;

    for (const size of sizes) {
      const markup = renderToStaticMarkup(
        <Button size={size} aria-label={`测试 ${size}`}>
          {size}
        </Button>,
      );
      expect(markup).toContain(`data-size="${size}"`);
    }
  });

  it("raises compact button sizes to a 44px minimum on narrow or coarse-pointer devices", () => {
    const mediaContract = css.match(
      /@media \(max-width: 39\.999rem\), \(pointer: coarse\) \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(mediaContract).toBeDefined();
    for (const size of [
      "default",
      "xs",
      "sm",
      "lg",
      "icon",
      "icon-xs",
      "icon-sm",
      "icon-lg",
    ]) {
      expect(mediaContract).toContain(
        `[data-slot="button"][data-size="${size}"]`,
      );
    }
    expect(mediaContract).toContain("min-width: 2.75rem");
    expect(mediaContract).toContain("min-height: 2.75rem");
  });
});
