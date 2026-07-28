import type { Player } from "@/data/players";
import {
  countryNameEn,
  countryNameZh,
  normalizeCountryCode,
} from "@/lib/country-geography";

const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AE: ["uae", "united arab emirates"],
  CN: ["china", "prc", "people's republic of china"],
  CZ: ["czechia", "czech republic"],
  GB: ["uk", "britain", "great britain", "united kingdom"],
  KR: ["korea", "south korea", "republic of korea"],
  MK: ["macedonia", "north macedonia"],
  PS: ["palestine", "state of palestine"],
  RU: ["russia", "russian federation"],
  US: ["usa", "america", "united states", "united states of america"],
};

interface SearchField {
  value: string;
  weight: number;
  nickname: boolean;
}

const PLAYER_FIELD_CACHE = new WeakMap<Player, SearchField[]>();

const LETTER_FOLDING: Readonly<Record<string, string>> = {
  æ: "ae",
  đ: "d",
  ð: "d",
  ł: "l",
  ø: "o",
  œ: "oe",
  þ: "th",
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[æđðłøœþ]/g, (character) => LETTER_FOLDING[character])
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export function completionSuffix(query: string, nickname: string): string {
  const trimmedQuery = query.trim();
  if (
    !trimmedQuery ||
    !nickname
      .toLocaleLowerCase()
      .startsWith(trimmedQuery.toLocaleLowerCase())
  ) {
    return "";
  }

  return nickname.slice(trimmedQuery.length);
}

export function movePlayerHighlight(
  playerIds: readonly string[],
  currentId: string | undefined,
  direction: -1 | 1,
): string | undefined {
  if (playerIds.length === 0) return undefined;

  const currentIndex = currentId ? playerIds.indexOf(currentId) : -1;
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : playerIds.length - 1
      : (currentIndex + direction + playerIds.length) % playerIds.length;

  return playerIds[nextIndex];
}

function scoreField(field: SearchField, token: string): number | null {
  const fieldBase = field.nickname ? 0 : 400;
  if (field.value === token) return fieldBase + field.weight;
  if (field.value.startsWith(token)) return fieldBase + 100 + field.weight;
  if (field.value.split(" ").some((word) => word.startsWith(token))) {
    return fieldBase + 200 + field.weight;
  }
  if (field.value.includes(token)) return fieldBase + 300 + field.weight;
  return null;
}

function playerFields(player: Player): SearchField[] {
  const cached = PLAYER_FIELD_CACHE.get(player);
  if (cached) return cached;

  const countryCode = normalizeCountryCode(player.countryCode);
  const nationality =
    countryCode === player.countryCode
      ? player.nationality
      : countryNameEn(countryCode);
  const values: Array<[string, number, boolean]> = [
    [player.nickname, 0, true],
    [player.name, 4, false],
    [player.team, 8, false],
    [countryCode, 1, false],
    [countryNameZh(countryCode), 2, false],
    [countryNameEn(countryCode), 2, false],
    [nationality, 3, false],
    ...((COUNTRY_ALIASES[countryCode] ?? []).map(
      (alias) => [alias, 2, false] as [string, number, boolean],
    )),
  ];

  const fields = values.map(([value, weight, nickname]) => ({
    value: normalizeSearchText(value),
    weight,
    nickname,
  }));
  PLAYER_FIELD_CACHE.set(player, fields);
  return fields;
}

function playerSearchScore(player: Player, normalizedQuery: string) {
  const fields = playerFields(player);
  const exactPhraseScore = fields.reduce<number | null>((best, field) => {
    if (field.value !== normalizedQuery) return best;
    const candidate = scoreField(field, normalizedQuery);
    if (candidate === null) return best;
    return best === null ? candidate : Math.min(best, candidate);
  }, null);

  const tokens = normalizedQuery.split(" ");
  let score = 0;
  for (const token of tokens) {
    const tokenScore = fields.reduce<number | null>((best, field) => {
      const candidate = scoreField(field, token);
      if (candidate === null) return best;
      return best === null ? candidate : Math.min(best, candidate);
    }, null);
    if (tokenScore === null) return null;
    score += tokenScore;
  }
  return exactPhraseScore === null ? score : Math.min(exactPhraseScore, score);
}

export function searchPlayers(
  candidates: readonly Player[],
  query: string,
  limit = 30,
): Player[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return candidates
    .flatMap((player) => {
      const score = playerSearchScore(player, normalizedQuery);
      return score === null ? [] : [{ player, score }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.player.nickname.localeCompare(right.player.nickname, "en", {
          sensitivity: "base",
        }) ||
        left.player.id.localeCompare(right.player.id, "en", {
          sensitivity: "base",
        }),
    )
    .slice(0, limit)
    .map(({ player }) => player);
}
