import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { players } from "@/data/players";
import {
  saveSoloProgress,
  soloMysteryPool,
} from "@/lib/solo-game";
import { SoloGamePage } from "@/pages/SoloGamePage";

vi.mock("@/hooks/use-anonymous-profile", () => ({
  useAnonymousProfile: () => ({
    profile: { recordedRounds: [] },
    recordRound: vi.fn(),
  }),
}));

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("SoloGamePage persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the restored round, guess count, and remaining deadline", () => {
    const storage = new MemoryStorage();
    const now = Date.now();
    const mysteryId = soloMysteryPool("easy")[0].id;
    const guessedPlayer =
      players.find((player) => player.id !== mysteryId) ?? players[0];
    saveSoloProgress(
      {
        roundId: "solo:easy:restored",
        roundNumber: 4,
        difficulty: "easy",
        mysteryId,
        guessedIds: [guessedPlayer.id],
        status: "playing",
        deadline: now + 60_000,
        resultDismissed: false,
      },
      storage,
    );
    vi.stubGlobal("localStorage", storage);

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/play/solo?difficulty=easy"]}>
        <SoloGamePage />
      </MemoryRouter>,
    );

    expect(markup).toContain("#4");
    expect(markup).not.toContain("SOLO · ROUND #4");
    expect(markup).toContain("1 / 8");
    expect(markup).toContain("01:00");
    expect(markup).toContain(guessedPlayer.nickname);
  });

  it("announces an unsafe legacy reset without using the catalog notice", () => {
    const storage = new MemoryStorage();
    storage.setItem("cs-guess:solo-progress:active", "easy");
    storage.setItem("cs-guess:solo-progress:v1:easy", "{broken");
    vi.stubGlobal("localStorage", storage);

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/play/solo?difficulty=easy"]}>
        <SoloGamePage />
      </MemoryRouter>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain(
      "旧练习进度无法恢复，已安全开始新的练习回合。",
    );
    expect(markup).not.toContain("选手目录已更新");
  });

  it("keeps catalog migration failures on their dedicated notice", () => {
    const storage = new MemoryStorage();
    storage.setItem("cs-guess:solo-progress:active", "easy");
    storage.setItem(
      "cs-guess:solo-progress:v1:easy",
      JSON.stringify({
        version: 1,
        state: {
          roundId: "solo:easy:removed-catalog",
          roundNumber: 5,
          difficulty: "easy",
          mysteryId: "removed-player",
          guessedIds: [],
          status: "playing",
          deadline: Date.now() + 60_000,
          resultDismissed: false,
        },
      }),
    );
    vi.stubGlobal("localStorage", storage);

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/play/solo?difficulty=easy"]}>
        <SoloGamePage />
      </MemoryRouter>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain(
      "选手目录已更新，已安全开始新的练习回合。",
    );
    expect(markup).not.toContain("旧练习进度无法安全恢复");
  });

  it("removes playing context once the result panel replaces the game", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);

    const markup = renderToStaticMarkup(
      <MemoryRouter
        initialEntries={[
          "/play/solo?difficulty=full&audit=solo-result-panel",
        ]}
      >
        <SoloGamePage />
      </MemoryRouter>,
    );

    expect(markup).toContain("单人练习完成");
    expect(markup).toContain("已用尝试");
    expect(markup).not.toContain("根据属性线索确定目标选手");
    expect(markup).not.toContain("随机个人题目");
    expect(markup).not.toContain("已使用 1 次机会");
  });

  it("does not repeat solo progress in a separate question strip", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);

    const markup = renderToStaticMarkup(
      <MemoryRouter
        initialEntries={["/play/solo?difficulty=hard&audit=solo-playing"]}
      >
        <SoloGamePage />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("随机个人题目");
    expect(markup).not.toContain("已使用 0 次机会");
    expect(markup).not.toContain("SOLO · ROUND");
  });
});
