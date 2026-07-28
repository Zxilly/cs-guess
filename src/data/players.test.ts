import { describe, expect, it } from "vitest";

import { players } from "@/data/players";

describe("generated player catalog", () => {
  it("keeps the reviewed snapshot structurally valid", () => {
    const invalidTeamNames = new Set(["", "undefined", "null", "none", "n/a"]);
    expect(players).toHaveLength(2_754);
    expect(new Set(players.map((player) => player.id)).size).toBe(
      players.length,
    );
    expect(
      players.filter(
        (player) =>
          !player.nickname.trim() ||
          !player.name.trim() ||
          invalidTeamNames.has(player.team.trim().toLocaleLowerCase()),
      ),
    ).toEqual([]);
  });

  it("never presents a departed roster as a current team", () => {
    expect(
      players.filter((player) =>
        player.team.trim().toLocaleLowerCase().startsWith("ex-"),
      ),
    ).toEqual([]);
  });

  it("never carries a team logo onto an unattached player", () => {
    expect(
      players.filter(
        (player) => player.team === "无队伍" && player.teamLogoUrl,
      ),
    ).toEqual([]);
  });
});
