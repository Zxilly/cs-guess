import { describe, expect, it } from "vitest";

import { soloLossCopy } from "@/lib/solo-result-copy";

describe("solo loss result copy", () => {
  it("explains when the solo timer expires", () => {
    const copy = soloLossCopy("timeout");

    expect(copy.title).toBe("时间已到");
    expect(copy.dialogSummary).toContain("时间");
    expect(copy.panelSummary).toContain("时间");
  });

  it("explains when all eight guesses are exhausted", () => {
    const copy = soloLossCopy("attempts-exhausted");

    expect(copy.title).toBe("机会已用完");
    expect(copy.dialogSummary).toContain("猜测机会");
    expect(copy.panelSummary).toContain("猜测机会");
  });
});
