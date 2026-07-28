/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rgb = readonly [number, number, number];
type Oklch = readonly [number, number, number];

const css = readFileSync(
  new URL("../index.css", import.meta.url),
  "utf8",
);

function cssOklch(variable: string): Oklch {
  const match = css.match(
    new RegExp(
      `--${variable}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`,
    ),
  );
  if (!match) throw new Error(`Missing --${variable}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function oklchToSrgb([lightness, chroma, hue]: Oklch): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => {
    const encoded =
      channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, encoded));
  }) as unknown as Rgb;
}

function relativeLuminance(rgb: Rgb) {
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map(
    (channel, index) =>
      channel * alpha + background[index] * (1 - alpha),
  ) as unknown as Rgb;
}

describe("comparison color contrast", () => {
  it("keeps every comparison label above 4.5:1 on base and darker hover surfaces", () => {
    const background = oklchToSrgb(cssOklch("background"));
    const hoverBackground = composite(
      oklchToSrgb(cssOklch("primary")),
      background,
      0.025,
    );
    const foregrounds = [
      "primary",
      "comparison-higher",
      "comparison-lower",
      "comparison-near",
      "muted-foreground",
    ].map((variable) => [variable, oklchToSrgb(cssOklch(variable))] as const);

    for (const [variable, foreground] of foregrounds) {
      expect(
        contrastRatio(foreground, background),
        `${variable} on background`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(foreground, hoverBackground),
        `${variable} on 2.5% primary hover background`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
