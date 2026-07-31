/** @vitest-environment jsdom */

import { t } from "@lingui/core/macro";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { countryNameZh } from "@/lib/country-geography";
import { competitionRankLabels } from "@/lib/live-presence";
import {
  activateLocale,
  detectInitialLocale,
  localeStorageKey,
  matchSupportedLocale,
} from "@/i18n";

describe("locale negotiation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    activateLocale("zh-CN");
  });

  it("matches Chinese and English language tags in preference order", () => {
    expect(matchSupportedLocale(["zh-TW", "en-US"])).toBe("zh-CN");
    expect(matchSupportedLocale(["fr-FR", "en-GB", "zh-CN"])).toBe("en");
  });

  it("falls back to English when Accept-Language has no supported locale", () => {
    expect(matchSupportedLocale(["fr-FR", "de-DE"])).toBe("en");
  });

  it("prefers a persisted user choice over the browser language", () => {
    window.localStorage.setItem(localeStorageKey, "zh-CN");
    expect(detectInitialLocale()).toBe("zh-CN");
  });

  it("derives the initial locale from navigator.languages", () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-HK", "en-US"],
    });
    expect(detectInitialLocale()).toBe("zh-CN");
  });

  it("activates the complete English catalog and document metadata", () => {
    activateLocale("en");

    expect(t`今日挑战`).toBe("Daily Challenge");
    expect(countryNameZh("DE")).toBe("Germany");
    expect(competitionRankLabels([12, 12, 5])).toEqual([
      "Tied #1",
      "Tied #1",
      "#3",
    ]);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("CS Guess — Daily Player Guessing");
  });
});
