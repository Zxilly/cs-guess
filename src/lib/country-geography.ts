import countries from "@/data/countries.generated.json";
import type { CountryHint } from "@/types/game";

interface CountryMetadata {
  code: string;
  nameZh: string;
  continent: string;
  capital: [number, number] | null;
}

const POLITICAL_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  HK: "CN",
  MO: "CN",
  TW: "CN",
  XK: "RS",
};

const POLITICAL_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  CN: "中国",
  PS: "巴勒斯坦国",
  RS: "塞尔维亚",
};

const CONTINENT_NAMES: Readonly<Record<string, string>> = {
  Africa: "非洲",
  Americas: "美洲",
  Antarctic: "南极洲",
  Asia: "亚洲",
  Europe: "欧洲",
  Oceania: "大洋洲",
};

const CHINESE_REGION_NAMES = new Intl.DisplayNames(["zh-CN"], {
  type: "region",
});

const ENGLISH_REGION_NAMES = new Intl.DisplayNames(["en"], {
  type: "region",
});

const COUNTRY_BY_CODE = new Map(
  (countries as CountryMetadata[]).map((country) => [country.code, country]),
);

export function normalizeCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  return POLITICAL_CODE_OVERRIDES[normalized] ?? normalized;
}

export function countryNameZh(countryCode: string): string {
  const normalized = normalizeCountryCode(countryCode);
  return (
    POLITICAL_NAME_OVERRIDES[normalized] ??
    CHINESE_REGION_NAMES.of(normalized) ??
    COUNTRY_BY_CODE.get(normalized)?.nameZh ??
    normalized
  );
}

export function countryNameEn(countryCode: string): string {
  const normalized = normalizeCountryCode(countryCode);
  return ENGLISH_REGION_NAMES.of(normalized) ?? normalized;
}

export function countryContinentZh(countryCode: string): string | null {
  const normalized = normalizeCountryCode(countryCode);
  const continent = COUNTRY_BY_CODE.get(normalized)?.continent;
  return continent ? (CONTINENT_NAMES[continent] ?? continent) : null;
}

export function compareCountries(
  guessCountryCode: string,
  targetCountryCode: string,
): CountryHint {
  const guessCode = normalizeCountryCode(guessCountryCode);
  const targetCode = normalizeCountryCode(targetCountryCode);
  const guess = COUNTRY_BY_CODE.get(guessCode);
  const target = COUNTRY_BY_CODE.get(targetCode);
  const relation =
    guessCode === targetCode
      ? "match"
      : guess?.continent && guess.continent === target?.continent
        ? "near"
        : "miss";

  return {
    relation,
    distanceKm: capitalDistanceKm(guess?.capital, target?.capital),
  };
}

export function formatCountryDistance(distanceKm: number | null): string {
  return distanceKm === null
    ? "距离未知"
    : `${distanceKm.toLocaleString("zh-CN")} km`;
}

function capitalDistanceKm(
  from: [number, number] | null | undefined,
  to: [number, number] | null | undefined,
): number | null {
  if (!from || !to) return null;
  const [fromLatitude, fromLongitude] = from.map(toRadians);
  const [toLatitude, toLongitude] = to.map(toRadians);
  const latitudeDelta = toLatitude - fromLatitude;
  const longitudeDelta = toLongitude - fromLongitude;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(6371.0088 * 2 * Math.asin(Math.sqrt(haversine)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
