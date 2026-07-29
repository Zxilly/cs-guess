import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BattleContext } from "@/components/BattleContext";

describe("quick group battle slots", () => {
  it("renders stable labeled slots with independent opponent countdowns", () => {
    const markup = renderToStaticMarkup(
      <BattleContext
        mode="quick"
        guesses={0}
        opponentGuesses={0}
        maxGuesses={8}
        maxPlayers={4}
        participants={[
          {
            playerId: "self",
            name: "donk",
            connected: true,
            guesses: 0,
            score: 0,
            self: true,
            slotLabel: "你",
            presenceLabel: "在线",
            rankLabel: "并列第 1",
          },
          {
            playerId: "opponent-1",
            name: "m0NESY",
            connected: true,
            guesses: 0,
            score: 0,
            self: false,
            slotLabel: "对手 1",
            presenceLabel: "在线",
            rankLabel: "并列第 1",
          },
          {
            playerId: "opponent-2",
            name: "ZywOo",
            connected: true,
            guesses: 0,
            score: 0,
            self: false,
            slotLabel: "对手 2",
            presenceLabel: "在线",
            rankLabel: "并列第 1",
            disconnectSeconds: 12,
          },
          {
            playerId: "opponent-3",
            name: "sh1ro",
            connected: false,
            guesses: 0,
            score: 0,
            self: false,
            slotLabel: "对手 3",
            presenceLabel: "离线",
            rankLabel: "第 4",
            disconnectSeconds: 27,
          },
        ]}
      />,
    );

    expect(markup).toContain("你");
    expect(markup).toContain("对手 1");
    expect(markup).toContain("对手 2");
    expect(markup).toContain("对手 3");
    expect(markup).toContain("重连 00:12");
    expect(markup).toContain("重连 00:27");
    expect(markup).toContain("对手 2连接中断");
    expect(markup).toContain("对手 3连接中断");
    expect(markup.match(/并列第 1/g)).toHaveLength(3);
    expect(markup).toContain('aria-labelledby="group-battle-heading"');
    expect(markup).toContain('role="list"');
    expect(markup.match(/role="listitem"/g)).toHaveLength(4);
    expect(markup).toContain('aria-labelledby="battle-participant-0"');
    expect(markup).toContain('aria-labelledby="battle-participant-3"');
    expect(markup).not.toContain("HOST · GROUP BATTLE");
    expect(markup).toContain("FIRST TO SOLVE WINS");
    expect(markup).not.toContain("CS-207207");
  });

  it("keeps the 1v1 opponent countdown", () => {
    const markup = renderToStaticMarkup(
      <BattleContext
        mode="quick"
        guesses={0}
        opponentGuesses={0}
        maxGuesses={8}
        maxPlayers={2}
        opponentName="m0NESY"
        opponentConnected={false}
        opponentPresenceLabel="离线"
        opponentDisconnectSeconds={9}
      />,
    );

    expect(markup).toContain("m0NESY");
    expect(markup).toContain("重连 00:09");
    expect(markup).toContain("对手 1连接中断");
    expect(markup).not.toContain("CS-207207");
  });

  it("only exposes the shareable room code when one is supplied", () => {
    const markup = renderToStaticMarkup(
      <BattleContext
        mode="room"
        guesses={0}
        opponentGuesses={0}
        maxGuesses={8}
        roomCode="CS-123456"
      />,
    );

    expect(markup).toContain("CS-123456");
  });
});
