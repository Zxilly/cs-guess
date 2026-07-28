import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuessTable } from "@/components/GuessTable";
import { players } from "@/data/players";

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

    expect(markup).toMatch(
      /对手 2 · ZywOo · 对手进度[\s\S]*重连 00:12 · 超时判负/,
    );
    expect(markup).toMatch(
      /对手 3 · sh1ro · 对手进度[\s\S]*重连 00:27 · 超时判负/,
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

    const firstBoard = markup.slice(
      markup.indexOf("对手 1 · m0NESY · 对手进度"),
      markup.indexOf("对手 2 · ZywOo · 对手进度"),
    );
    const forfeitedBoard = markup.slice(
      markup.indexOf("对手 2 · ZywOo · 对手进度"),
      markup.indexOf("对手 3 · sh1ro · 对手进度"),
    );

    expect(forfeitedBoard).toContain("在线 · 本轮已判负");
    expect(forfeitedBoard).toContain("本轮已判负");
    expect(firstBoard).not.toContain("在线 · 本轮已判负");
  });
});
