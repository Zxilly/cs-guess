import { describe, expect, it } from "vitest";

import { soloLossCopy } from "@/lib/solo-result-copy";

describe("solo loss result copy", () => {
  it("explains when the solo timer expires", () => {
    const copy = soloLossCopy("timeout");

    expect(copy.title).toBe("时间已到");
    expect(copy.dialogSummary).toContain("时间");
    expect(copy.panelSummary).toContain("时间");
  });

  it("uses the configured guess limit when attempts are exhausted", () => {
    const copy = soloLossCopy("attempts-exhausted");
    const hardCopy = soloLossCopy("attempts-exhausted", 10);

    expect(copy.title).toBe("机会已用完");
    expect(copy.dialogSummary).toContain("8 次猜测机会");
    expect(copy.panelSummary).toContain("8 次猜测机会");
    expect(hardCopy.dialogSummary).toContain("10 次猜测机会");
    expect(hardCopy.panelSummary).toContain("10 次猜测机会");
  });
});
