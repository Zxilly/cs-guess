/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("typography styles", () => {
  it.each(["--font-heading", "--font-sans", "--font-mono"])(
    "gives %s an explicit Simplified Chinese fallback",
    (fontToken) => {
      expect(css).toMatch(
        new RegExp(
          `${fontToken}:[\\s\\S]*?"Noto Sans SC"[\\s\\S]*?"PingFang SC"[\\s\\S]*?"Microsoft YaHei"[\\s\\S]*?;`,
        ),
      );
    },
  );
});
