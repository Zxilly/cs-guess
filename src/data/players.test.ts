import { describe, expect, it } from "vitest";

import { players } from "@/data/players";

describe("generated player catalog", () => {
  it("keeps the reviewed snapshot structurally valid", () => {
    const invalidTeamNames = new Set(["", "undefined", "null", "none", "n/a"]);
    expect(players).toHaveLength(3_444);
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

  it("keeps historical teams deduplicated and separate from the current team", () => {
    const invalidTeamNames = new Set([
      "",
      "无队伍",
      "undefined",
      "null",
      "none",
      "n/a",
    ]);
    const normalize = (team: string) =>
      team.trim().replace(/\s+/g, " ").toLocaleLowerCase();

    expect(
      players.filter((player) => {
        const historicalTeams = (player.historicalTeams ?? []).map(normalize);
        return (
          historicalTeams.some(
            (team) =>
              invalidTeamNames.has(team) ||
              team === normalize(player.team),
          ) ||
          new Set(historicalTeams).size !== historicalTeams.length
        );
      }),
    ).toEqual([]);
  });

  it("includes verified former Chinese players outside the active player category", () => {
    const machineWjq = players.find(
      (player) => player.nickname === "MachineWJQ",
    );

    expect(machineWjq).toMatchObject({
      name: "Liu Yibo",
      countryCode: "CN",
      role: "Unknown",
      team: "无队伍",
    });
    expect(machineWjq?.aliases).toEqual(
      expect.arrayContaining(["6657", "玩机器", "刘亦博"]),
    );
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
