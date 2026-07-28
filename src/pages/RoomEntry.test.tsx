import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { RoomEntry } from "@/pages/RoomEntry";

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    player: { id: "player-1", nickname: "steel" },
    profile: {
      stats: {
        wins: 1,
        losses: 0,
        draws: 0,
        currentStreak: 1,
        bestStreak: 1,
      },
      drawCredits: 1,
      lossesTowardCredit: 0,
    },
    winRate: 100,
    currentPool: "common",
  }),
}));

vi.mock("@/components/PlayerIdentity", () => ({
  PlayerIdentity: () => <section aria-label="我的身份">steel 的身份摘要</section>,
}));

function renderRoomEntry() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RoomEntry />
    </MemoryRouter>,
  );
}

describe("RoomEntry", () => {
  it("uses a compact join layer followed by an independent full-width creation layer", () => {
    const markup = renderRoomEntry();

    expect(markup).toContain('data-layout="room-journey"');
    expect(markup).toContain('data-layout="join-room"');
    expect(markup).toContain('data-layout="create-room"');
    expect(markup).toContain(
      "lg:grid-cols-[minmax(14rem,0.36fr)_minmax(0,1fr)]",
    );
    expect(markup).toContain("lg:grid-cols-12");
    expect(markup).not.toContain("md:grid-cols-2");
    expect(markup).not.toContain("min-h-96");
    expect(markup).not.toContain("grid-rows-[auto_1fr_auto]");
  });

  it("applies shared section spacing and 48px control contracts", () => {
    const markup = renderRoomEntry();

    expect(markup).toContain("app-section-stack");
    expect(markup).toContain("app-section-offset");
    expect(markup.match(/app-control/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the compact mobile journey in join-then-create order with one room-code input", () => {
    const markup = renderRoomEntry();
    const joinHeading = markup.indexOf("加入房间</h2>");
    const createHeading = markup.indexOf("创建新房间</h2>");

    expect(joinHeading).toBeGreaterThan(-1);
    expect(createHeading).toBeGreaterThan(joinHeading);
    expect(markup.match(/name="roomCode"/g)).toHaveLength(1);
    expect(markup).toContain("题库难度");
    expect(markup).toContain("房间人数");
    expect(markup).toContain("比赛赛制");
  });

  it("keeps both room-capacity actions and their value on the same 44px control row", () => {
    const markup = renderRoomEntry();

    expect(markup).toContain('aria-label="减少房间人数"');
    expect(markup).toContain('aria-label="增加房间人数"');
    expect(markup.match(/data-size="icon-sm"/g)).toHaveLength(2);
    expect(markup).toContain(
      "min-h-11 grid-cols-[2.75rem_1fr_2.75rem]",
    );
    expect(markup.match(/h-11 w-11 rounded-none/g)).toHaveLength(2);
    expect(markup).toContain(
      'class="flex h-11 items-center justify-center font-mono text-xs"',
    );
  });
});
