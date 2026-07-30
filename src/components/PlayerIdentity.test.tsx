import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-anonymous-profile", () => ({
  IDENTITY_POOLS: [
    {
      id: "common",
      label: "Major 参赛池",
      unlockWins: 0,
    },
  ],
}));

import { PlayerIdentity } from "@/components/PlayerIdentity";
import type { Player } from "@/data/players";

const player: Player = {
  id: "steel",
  nickname: "steel",
  name: "Lucas Lopes",
  team: "Legacy",
  nationality: "Brazil",
  countryCode: "BR",
  age: 32,
  role: "IGL",
  majorAppearances: 5,
  majorWins: 0,
};

describe("PlayerIdentity", () => {
  it("keeps the draw-credit earning rule visible in the compact lobby summary", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PlayerIdentity
          player={player}
          stats={{
            wins: 1,
            losses: 0,
            draws: 0,
            currentStreak: 1,
            bestStreak: 1,
          }}
          drawCredits={2}
          lossesTowardCredit={0}
          winRate={100}
          currentPool="common"
          manageHref="/identity"
          compact
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("2 次抽取");
    expect(markup).toContain("胜 1 局或累计负 2 局 +1");
  });
});
