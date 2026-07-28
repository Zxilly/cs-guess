/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  competitionRankLabels,
  disconnectSecondsByPlayerId,
  disconnectSecondsRemaining,
  playerPresenceLabel,
  quickRematchPath,
} from "@/lib/live-presence";

describe("live quick-match presence", () => {
  it("separates the local reconnecting transport from opponent presence", () => {
    expect(playerPresenceLabel(true, "connecting", false, "waiting")).toBe(
      "正在连接",
    );
    expect(playerPresenceLabel(true, "reconnecting", false, "playing")).toBe(
      "正在重连",
    );
    expect(playerPresenceLabel(true, "offline", true, "playing")).toBe(
      "离线",
    );
    expect(playerPresenceLabel(true, "closed", true, "playing")).toBe(
      "离线",
    );
    expect(playerPresenceLabel(false, "reconnecting", true, "playing")).toBe(
      "在线",
    );
    expect(playerPresenceLabel(false, "connected", false, "waiting")).toBe(
      "等待连接",
    );
    expect(playerPresenceLabel(false, "connected", false, "playing")).toBe(
      "离线",
    );
  });

  it("derives the forfeit countdown from the authoritative deadline", () => {
    const deadline = new Date("2026-07-28T00:00:30Z").getTime();
    expect(
      disconnectSecondsRemaining(
        deadline,
        new Date("2026-07-28T00:00:07Z").getTime(),
      ),
    ).toBe(23);
    expect(
      disconnectSecondsRemaining(
        deadline,
        new Date("2026-07-28T00:00:31Z").getTime(),
      ),
    ).toBe(0);
  });

  it("tracks opponent 2 and 3 deadlines independently and clears only the recovered player", () => {
    const now = new Date("2026-07-28T00:00:00Z").getTime();
    const deadlines = disconnectSecondsByPlayerId(
      [
        { playerId: "opponent-1", disconnectDeadline: null },
        { playerId: "opponent-2", disconnectDeadline: now + 12_000 },
        { playerId: "opponent-3", disconnectDeadline: now + 27_000 },
      ],
      now,
    );

    expect([...deadlines.entries()]).toEqual([
      ["opponent-1", null],
      ["opponent-2", 12],
      ["opponent-3", 27],
    ]);

    const recovered = disconnectSecondsByPlayerId(
      [
        { playerId: "opponent-1", disconnectDeadline: null },
        { playerId: "opponent-2", disconnectDeadline: null },
        { playerId: "opponent-3", disconnectDeadline: now + 27_000 },
      ],
      now,
    );
    expect(recovered.get("opponent-2")).toBeNull();
    expect(recovered.get("opponent-3")).toBe(27);
  });

  it("uses competition ranking without inventing a tie breaker", () => {
    expect(competitionRankLabels([2, 2, 1, 0])).toEqual([
      "并列第 1",
      "并列第 1",
      "第 3",
      "第 4",
    ]);
  });

  it("preserves all quick-match rules in the rematch URL", () => {
    expect(quickRematchPath(4, "open", "hard", 5)).toBe(
      "/quick?difficulty=hard&visibility=open&bestOf=5&players=4",
    );
  });
});
