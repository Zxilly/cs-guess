/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("audit interaction styles", () => {
  it("keeps progress spinners moving while decorative motion is frozen", () => {
    expect(css).toMatch(
      /html\[data-audit\]\s+\[data-slot="spinner"\]\s*\{[^}]*animation-play-state:\s*running\s*!important;/s,
    );
  });

  it("keeps text-entry carets visible while audit animations are frozen", () => {
    expect(css).toMatch(
      /html\[data-audit\]\s+:is\(input,\s*textarea,\s*\[contenteditable="true"\]\)\s*\{[^}]*caret-color:\s*auto\s*!important;/s,
    );
  });
});
