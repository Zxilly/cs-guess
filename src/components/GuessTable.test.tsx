import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuessTable } from "@/components/GuessTable";
import { players } from "@/data/players";

describe("GuessTable comparison labels", () => {
  it("keeps country distance guidance at readable body-copy sizing and full color strength", () => {
    const markup = renderToStaticMarkup(
      <GuessTable
        guesses={[players[1]]}
        opponentGuesses={[]}
        opponentVisibility="hidden"
        mysteryPlayer={players[0]}
        mode="daily"
        maxGuesses={1}
      />,
    );

    expect(markup).toContain("mt-1 font-mono text-xs");
    expect(markup).not.toContain("text-[9px]");
    expect(markup).not.toContain("text-current/70");
    expect(markup).toContain("两国首都直线距离");
  });
});
