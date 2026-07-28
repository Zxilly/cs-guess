import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DailyResultPanel } from "@/components/DailyResultPanel";
import type { Player } from "@/data/players";

const legacyPlayer: Player = {
  id: "legacy-answer",
  nickname: "legacy",
  name: "Legacy Answer",
  team: "undefined",
  teamLogoUrl: "https://cdn.example/undefined.png",
  nationality: "Poland",
  countryCode: "PL",
  age: 27,
  role: "Entry",
  majorAppearances: 0,
  majorWins: 0,
};

describe("DailyResultPanel", () => {
  it("never displays an undefined team from a legacy snapshot", () => {
    const markup = renderToStaticMarkup(
      <DailyResultPanel
        outcome="lost"
        attempts={0}
        maxGuesses={8}
        mysteryPlayer={legacyPlayer}
      />,
    );

    expect(markup).toContain("无队伍");
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("https://cdn.example/undefined.png");
  });

  it.each([
    ["timeout", "三分钟倒计时已结束"],
    ["attempts-exhausted", "八次猜测机会已用完"],
  ] as const)("explains a daily %s loss", (lossReason, expected) => {
    const markup = renderToStaticMarkup(
      <DailyResultPanel
        outcome="lost"
        attempts={lossReason === "timeout" ? 3 : 8}
        maxGuesses={8}
        mysteryPlayer={legacyPlayer}
        lossReason={lossReason}
      />,
    );

    expect(markup).toContain(expected);
  });

  it("uses solo-specific result labeling outside the daily challenge", () => {
    const markup = renderToStaticMarkup(
      <DailyResultPanel
        context="solo"
        outcome="won"
        attempts={2}
        maxGuesses={8}
        mysteryPlayer={legacyPlayer}
      />,
    );

    expect(markup).toContain("Solo result");
    expect(markup).not.toContain("Daily result");
  });
});
