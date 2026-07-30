import { describe, expect, it } from "vitest";

import type { Player } from "@/data/players";
import { compareTeams } from "@/lib/team-relation";

function player(
  team: string,
  historicalTeams: readonly string[] = [],
): Player {
  return {
    id: team,
    nickname: team,
    name: `${team} Player`,
    team,
    historicalTeams,
    nationality: "Denmark",
    countryCode: "DK",
    age: 25,
    role: "Rifler",
    majorAppearances: 1,
    majorWins: 0,
  };
}

describe("team relation", () => {
  it("matches the same current team", () => {
    expect(compareTeams(player("Vitality"), player("Vitality"))).toBe(
      "match",
    );
  });

  it("distinguishes a guess current team in the target history", () => {
    expect(
      compareTeams(player("Falcons"), player("Vitality", ["Falcons"])),
    ).toBe("target_history");
  });

  it("distinguishes a target current team in the guess history", () => {
    expect(
      compareTeams(player("Falcons", ["Vitality"]), player("Vitality")),
    ).toBe("guess_history");
  });

  it("distinguishes an overlap between both histories", () => {
    expect(
      compareTeams(
        player("Falcons", ["Vitality"]),
        player("MOUZ", ["Vitality"]),
      ),
    ).toBe("shared_history");
  });

  it("does not treat two unattached histories as near", () => {
    expect(
      compareTeams(
        player("Falcons", ["无队伍"]),
        player("MOUZ", ["无队伍"]),
      ),
    ).toBe("miss");
  });
});
