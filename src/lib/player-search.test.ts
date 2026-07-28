import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";

import type { Player } from "@/data/players";
import { players } from "@/data/players";
import {
  countryNameEn,
  countryNameZh,
  normalizeCountryCode,
} from "@/lib/country-geography";
import {
  completionSuffix,
  movePlayerHighlight,
  normalizeSearchText,
  searchPlayers,
} from "@/lib/player-search";

describe("player search", () => {
  it("prioritizes exact nicknames", () => {
    expect(searchPlayers(players, "ZywOo")[0]?.id).toBe("zywoo");
  });

  it("keeps retired and unattached players searchable by nickname and name", () => {
    const unattached = players.find(
      (player) =>
        player.team === "无队伍" &&
        normalizeSearchText(player.name).split(" ").length >= 2,
    );
    expect(unattached).toBeDefined();
    if (!unattached) return;

    expect(
      searchPlayers(players, unattached.nickname, players.length).some(
        (player) => player.id === unattached.id,
      ),
    ).toBe(true);
    expect(
      searchPlayers(players, unattached.name, players.length).some(
        (player) => player.id === unattached.id,
      ),
    ).toBe(true);
  });

  it("uses a deterministic tie-break for duplicate exact nicknames", () => {
    const forward = searchPlayers(players, "adren")
      .filter((player) => normalizeSearchText(player.nickname) === "adren")
      .map((player) => player.id);
    const reversed = searchPlayers([...players].reverse(), "adren")
      .filter((player) => normalizeSearchText(player.nickname) === "adren")
      .map((player) => player.id);

    expect(forward).toEqual(reversed);
  });

  it.each([
    ["alka", ["Alkaren"]],
    ["big", ["biguzera"]],
    ["fury", ["fury5k"]],
    ["hard", ["hardstyle", "hardzao"]],
    ["ins", ["insane", "insani", "iNsideR"]],
    ["og", ["ogwizard"]],
    ["r2", ["R2B2"]],
    ["rave", ["raven", "Ravenlot"]],
    ["shush", ["shushan", "shushu"]],
    ["step", ["StepA"]],
    ["ty", ["TyRa"]],
  ])(
    "keeps nickname prefixes ahead of an exact team match for %s",
    (query, expectedNicknames) => {
      const results = searchPlayers(players, query, players.length);
      const lastNicknamePrefix = Math.max(
        ...expectedNicknames.map((nickname) =>
          results.findIndex((player) => player.nickname === nickname),
        ),
      );
      const firstExactTeam = results.findIndex(
        (player) =>
          normalizeSearchText(player.nickname).startsWith(query) === false &&
          normalizeSearchText(player.team) === query,
      );

      expect(lastNicknamePrefix).toBeGreaterThanOrEqual(0);
      expect(firstExactTeam).toBeGreaterThanOrEqual(0);
      expect(lastNicknamePrefix).toBeLessThan(firstExactTeam);
    },
  );

  it("matches English country names and common abbreviations", () => {
    expect(searchPlayers(players, "north macedonia")[0]?.countryCode).toBe(
      "MK",
    );
    expect(
      searchPlayers(players, "MK").some(
        (player) => normalizeCountryCode(player.countryCode) === "MK",
      ),
    ).toBe(true);
    expect(
      searchPlayers(players, "UK").some(
        (player) => normalizeCountryCode(player.countryCode) === "GB",
      ),
    ).toBe(true);
    expect(
      searchPlayers(players, "Russia").some(
        (player) => normalizeCountryCode(player.countryCode) === "RU",
      ),
    ).toBe(true);
    expect(
      searchPlayers(players, "USA").some(
        (player) => normalizeCountryCode(player.countryCode) === "US",
      ),
    ).toBe(true);
  });

  it("ranks nickname exact, prefix, and normalized word-prefix matches before other fields", () => {
    const candidate = (
      id: string,
      nickname: string,
      overrides: Partial<Player> = {},
    ): Player => ({
      id,
      nickname,
      name: "Unrelated Name",
      team: "Unrelated Team",
      nationality: "Canada",
      countryCode: "CA",
      age: 25,
      role: "Rifler",
      majorAppearances: 0,
      majorWins: 0,
      ...overrides,
    });
    const candidates = [
      candidate("other-country", "alpha", {
        nationality: "United States",
        countryCode: "US",
      }),
      candidate("nickname-word", "not-US"),
      candidate("other-name", "beta", { name: "US" }),
      candidate("nickname-prefix", "USTILO"),
      candidate("other-team", "gamma", { team: "US" }),
      candidate("nickname-exact", "US"),
    ];

    expect(searchPlayers(candidates, "us").map((player) => player.id)).toEqual([
      "nickname-exact",
      "nickname-prefix",
      "nickname-word",
      "other-country",
      "other-name",
      "other-team",
    ]);
  });

  it("matches tokens across nickname, name, and team", () => {
    expect(searchPlayers(players, "aleksib natus vincere")[0]?.id).toBe(
      "aleksib",
    );
  });

  it("folds accents and punctuation consistently", () => {
    expect(normalizeSearchText("Møller")).toBe("moller");
    expect(searchPlayers(players, "moller").some((player) => player.id === "cadian"))
      .toBe(true);
  });

  it("keeps every catalog nickname prefix ahead of non-nickname exact matches", () => {
    const searchableOtherValues = (player: Player) => {
      const countryCode = normalizeCountryCode(player.countryCode);
      return [
        player.name,
        player.team,
        player.nationality,
        countryCode,
        countryNameZh(countryCode),
        countryNameEn(countryCode),
      ].map(normalizeSearchText);
    };
    const normalizedCatalog = players.map((player) => ({
      player,
      nickname: normalizeSearchText(player.nickname),
      otherValues: searchableOtherValues(player),
    }));
    const possibleQueries = new Set(
      normalizedCatalog.flatMap(({ otherValues }) => otherValues).filter(Boolean),
    );
    const conflictingQueries = [...possibleQueries].flatMap((query) => {
      const nicknamePrefixIds = normalizedCatalog.flatMap(
        ({ player, nickname }) =>
          nickname !== query && nickname.startsWith(query) ? [player.id] : [],
      );
      const otherExactIds = normalizedCatalog.flatMap(
        ({ player, nickname, otherValues }) =>
          nickname.startsWith(query) === false && otherValues.includes(query)
            ? [player.id]
            : [],
      );
      return nicknamePrefixIds.length > 0 && otherExactIds.length > 0
        ? [{ query, nicknamePrefixIds, otherExactIds }]
        : [];
    });

    expect(conflictingQueries.length).toBeGreaterThanOrEqual(11);
    for (const {
      query,
      nicknamePrefixIds,
      otherExactIds,
    } of conflictingQueries) {
      const results = searchPlayers(players, query, players.length);
      const resultIndex = new Map(
        results.map((player, index) => [player.id, index]),
      );
      const nicknamePrefixIndexes = nicknamePrefixIds.map(
        (id) => resultIndex.get(id) ?? Number.POSITIVE_INFINITY,
      );
      const otherExactIndexes = otherExactIds.map(
        (id) => resultIndex.get(id) ?? Number.POSITIVE_INFINITY,
      );

      expect(
        Math.max(...nicknamePrefixIndexes),
        `nickname prefix must win for "${query}"`,
      ).toBeLessThan(Math.min(...otherExactIndexes));
    }
  });

  it("searches the full catalog repeatedly within an interactive budget", () => {
    const queries = [
      "don",
      "moller",
      "natus vincere",
      "north macedonia",
      "中国",
      "usa",
      "hard",
      "rave",
      "ge t right",
      "aleksib natus vincere",
    ];
    searchPlayers(players, queries[0]);

    const startedAt = performance.now();
    for (let repetition = 0; repetition < 10; repetition += 1) {
      for (const query of queries) searchPlayers(players, query);
    }
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1_500);
  });

  it("returns no recommendations for an empty query", () => {
    expect(searchPlayers(players, "   ")).toEqual([]);
  });

  it("returns only the untyped nickname suffix for inline completion", () => {
    expect(completionSuffix("do", "donk")).toBe("nk");
    expect(completionSuffix("DON", "donk")).toBe("k");
    expect(completionSuffix("china", "donk")).toBe("");
  });

  it("moves keyboard highlight through the visible result order", () => {
    const resultIds = ["donk", "device", "dupreeh"];

    expect(movePlayerHighlight(resultIds, undefined, 1)).toBe("donk");
    expect(movePlayerHighlight(resultIds, undefined, -1)).toBe("dupreeh");
    expect(movePlayerHighlight(resultIds, "donk", 1)).toBe("device");
    expect(movePlayerHighlight(resultIds, "donk", -1)).toBe("dupreeh");
  });
});
