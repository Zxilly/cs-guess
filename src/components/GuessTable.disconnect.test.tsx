import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuessTable } from "@/components/GuessTable";
import { players } from "@/data/players";

function opponentPanel(markup: string, index: number) {
  const marker = new RegExp(
    `<div id="[^"]*-panel-opponent-${index}" role="tabpanel"`,
  );
  const nextMarker = new RegExp(
    `<div id="[^"]*-panel-opponent-${index + 1}" role="tabpanel"`,
  );
  const start = markup.search(marker);
  const nextMatch = markup.slice(start + 1).search(nextMarker);
  const next = nextMatch < 0 ? -1 : start + 1 + nextMatch;
  return markup.slice(start, next < 0 ? undefined : next);
}

describe("group opponent progress disconnect state", () => {
  it("shows opponent 2 and 3 countdowns on their corresponding boards", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={players[0]}
        mode="quick"
        maxGuesses={2}
        opponents={[
          {
            id: "opponent-1",
            name: "对手 1 · m0NESY",
            progress: [],
            disconnectSeconds: null,
          },
          {
            id: "opponent-2",
            name: "对手 2 · ZywOo",
            progress: [],
            disconnectSeconds: 12,
          },
          {
            id: "opponent-3",
            name: "对手 3 · sh1ro",
            progress: [],
            disconnectSeconds: 27,
          },
        ]}
      />,
    );

    expect(markup).toContain("ZywOo");
    expect(markup).toContain("sh1ro");
    expect(opponentPanel(markup, 2)).toContain(
      "重连 00:12 · 超时判负",
    );
    expect(opponentPanel(markup, 3)).toContain(
      "重连 00:27 · 超时判负",
    );
    expect(markup).not.toMatch(/aria-live="polite"[^>]*>[^<]*00:/);
    expect(markup).not.toContain('role="status"');
    expect(markup.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("keeps a reconnected forfeited opponent online but marks its corresponding board ineligible", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={players[0]}
        mode="room"
        maxGuesses={2}
        opponents={[
          {
            id: "opponent-1",
            name: "对手 1 · m0NESY",
            progress: [],
          },
          {
            id: "opponent-2",
            name: "对手 2 · ZywOo",
            progress: [],
            forfeitedThisRound: true,
          },
          {
            id: "opponent-3",
            name: "对手 3 · sh1ro",
            progress: [],
          },
        ]}
      />,
    );

    const firstBoard = opponentPanel(markup, 1);
    const forfeitedBoard = opponentPanel(markup, 2);

    expect(forfeitedBoard).toContain("在线 · 本轮已判负");
    expect(forfeitedBoard).toContain("本轮已判负");
    expect(firstBoard).not.toContain("在线 · 本轮已判负");
  });
});
