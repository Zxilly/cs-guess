import { describe, expect, it, vi } from "vitest";

import { focusDailyResultAfterDialog } from "@/lib/daily-result-focus";

describe("daily result focus", () => {
  it("moves focus to the result heading after the dialog closes", () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();

    focusDailyResultAfterDialog({ preventDefault }, { focus });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
