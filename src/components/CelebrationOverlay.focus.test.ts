import { describe, expect, it, vi } from "vitest";

import {
  focusCelebrationTitleOnOpen,
  focusDailyResultAfterDialog,
} from "@/lib/daily-result-focus";

describe("CelebrationOverlay focus lifecycle", () => {
  it("intends to place initial focus on the dialog title", () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();

    focusCelebrationTitleOnOpen({ preventDefault }, { focus });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("moves focus to the mounted result title after closing", () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();

    focusDailyResultAfterDialog({ preventDefault }, { focus });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
