import { describe, expect, it } from "vitest";

import type { Player } from "@/data/players";
import { dailyChallenge, dailySecondsLeft } from "@/lib/daily-challenge";

const catalog = [
  { id: "alpha" },
  { id: "bravo" },
  { id: "charlie" },
] as Player[];

describe("dailyChallenge", () => {
  it("returns the same challenge for the same Shanghai date", () => {
    const morning = dailyChallenge(
      catalog,
      new Date("2026-07-27T00:30:00+08:00"),
    );
    const evening = dailyChallenge(
      catalog,
      new Date("2026-07-27T23:30:00+08:00"),
    );

    expect(morning.date).toBe("2026-07-27");
    expect(evening).toEqual(morning);
  });

  it("uses an absolute deadline instead of resetting on reload", () => {
    expect(
      dailySecondsLeft(
        {
          date: "2026-07-27",
          deadline: 10_000,
          guessedIds: [],
          status: "playing",
        },
        7_500,
      ),
    ).toBe(3);
  });
});
