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

  it("uses distinct directional labels for all historical-team relations", () => {
    const target: Player = {
      ...mysteryPlayer,
      team: "MOUZ",
      historicalTeams: ["NAVI", "Vitality"],
    };
    const guesses: Player[] = [
      {
        ...guess,
        id: "target-history",
        team: "NAVI",
        historicalTeams: [],
      },
      {
        ...guess,
        id: "guess-history",
        team: "Falcons",
        historicalTeams: ["MOUZ"],
      },
      {
        ...guess,
        id: "shared-history",
        team: "Spirit",
        historicalTeams: ["Vitality"],
      },
    ];

    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={guesses}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={target}
        mode="solo"
        maxGuesses={3}
      />,
    );

    expect(markup).toContain("答案曾效力");
    expect(markup).toContain("猜测曾效力");
    expect(markup).toContain("共同历史队");
    expect(markup).toContain("猜测选手的当前战队，是答案曾经效力过的战队");
    expect(markup).toContain("答案的当前战队，是猜测选手曾经效力过的战队");
    expect(markup).toContain("猜测选手和答案曾经效力过的战队有重叠");
  });

  it("keeps the three relation badges distinguishable when opponent guesses are hidden", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        opponentProgress={[
          {
            guessedPlayerId: null,
            matchedFields: [],
            teamRelation: "target_history",
          },
          {
            guessedPlayerId: null,
            matchedFields: [],
            teamRelation: "guess_history",
          },
          {
            guessedPlayerId: null,
            matchedFields: [],
            teamRelation: "shared_history",
          },
        ]}
        mysteryPlayer={mysteryPlayer}
        mode="quick"
        maxGuesses={3}
      />,
    );

    expect(markup).toContain("答案曾效力");
    expect(markup).toContain("猜测曾效力");
    expect(markup).toContain("共同历史队");
  });
});
