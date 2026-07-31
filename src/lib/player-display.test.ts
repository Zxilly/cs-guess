import { afterEach, describe, expect, it } from "vitest";

import { activateLocale } from "@/i18n";
import {
  displayTeamName,
  isUnattachedTeam,
} from "@/lib/player-display";

describe("player team display", () => {
  afterEach(() => {
    activateLocale("zh-CN");
  });

  it("recognizes stable unattached-team values in every locale", () => {
    activateLocale("en");

    expect(isUnattachedTeam("无队伍")).toBe(true);
    expect(isUnattachedTeam("No Team")).toBe(true);
    expect(isUnattachedTeam("Vitality")).toBe(false);
    expect(displayTeamName("无队伍")).toBe("No Team");
  });
});
