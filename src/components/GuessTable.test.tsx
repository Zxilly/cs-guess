import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuessTable } from "@/components/GuessTable";
import type { Player } from "@/data/players";

const guess: Player = {
  id: "guess",
  nickname: "guess",
  name: "Guess Player",
  team: "Team A",
  nationality: "Denmark",
  countryCode: "DK",
  age: 25,
  role: "Rifler",
  majorAppearances: 6,
  majorWins: 1,
};

const mysteryPlayer: Player = {
  ...guess,
  id: "target",
  nickname: "target",
  name: "Target Player",
  majorAppearances: 8,
  majorWins: 2,
};

describe("GuessTable", () => {
  it("shows Major appearance and championship counts as separate attributes", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[guess]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={mysteryPlayer}
        mode="solo"
        maxGuesses={8}
      />,
    );

    expect(markup).toContain("Major 参赛");
    expect(markup).toContain("Major 冠军");
    expect(markup).toContain("目标数值更高");
  });

  it("does not repeat live player names or progress already shown in the battle header", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[guess]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={mysteryPlayer}
        mode="quick"
        maxGuesses={8}
      />,
    );

    expect(markup).toContain("我的猜测");
    expect(markup).toContain("对手进度");
    expect(markup).not.toContain("1 / 8");
    expect(markup).not.toContain("0 / 8");
    expect(markup).not.toContain("隐藏模式");
    expect(markup).not.toContain("查看可见性规则");
  });
});
