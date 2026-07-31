// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { trackEvent } from "@/lib/analytics";

describe("trackEvent", () => {
  afterEach(() => {
    delete window.umami;
  });

  it("forwards a typed event to Umami", () => {
    const track = vi.fn();
    window.umami = { track };

    trackEvent("practice-started", { difficulty: "hard" });

    expect(track).toHaveBeenCalledWith("practice-started", {
      difficulty: "hard",
    });
  });

  it("does nothing before the tracker is available", () => {
    expect(() =>
      trackEvent("mode-selected", { mode: "daily" }),
    ).not.toThrow();
  });

  it("does not let tracker failures interrupt the app", () => {
    window.umami = {
      track() {
        throw new Error("tracker unavailable");
      },
    };

    expect(() =>
      trackEvent("sound-toggled", { enabled: false }),
    ).not.toThrow();
  });
});
