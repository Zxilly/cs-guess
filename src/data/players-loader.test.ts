import { beforeEach, describe, expect, it, vi } from "vitest";

const catalog = [
  {
    id: "player-1",
    nickname: "Player One",
    name: "Player One",
    team: "Example",
    nationality: "China",
    countryCode: "CN",
    age: 24,
    role: "Rifler",
    majorAppearances: 1,
    majorWins: 0,
  },
];

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

describe("player catalog loader", () => {
  it("does not request the catalog until it is read", async () => {
    const playerData = await import("./players");
    expect(fetch).not.toHaveBeenCalled();

    let suspended: unknown;
    try {
      playerData.readPlayers();
    } catch (error) {
      suspended = error;
    }

    expect(suspended).toBeInstanceOf(Promise);
    await suspended;
    expect(fetch).toHaveBeenCalledOnce();
    expect(playerData.readPlayers()).toEqual(catalog);
  });

  it("shares one request between concurrent consumers", async () => {
    const { loadPlayers } = await import("./players");

    const [first, second] = await Promise.all([
      loadPlayers(),
      loadPlayers(),
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(first).toBe(second);
  });

  it("uses a low-priority request when the lobby warms the catalog", async () => {
    const { loadPlayers } = await import("./players");

    await loadPlayers({ priority: "low" });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: "low" }),
    );
  });

  it("keeps a failed response as an error instead of retrying forever", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { loadPlayers, readPlayers } = await import("./players");

    await expect(loadPlayers()).rejects.toThrow(
      "player catalog response is not a non-empty array",
    );
    expect(() => readPlayers()).toThrow(
      "player catalog response is not a non-empty array",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
