import { describe, expect, it } from "vitest";

import {
  compareCountries,
  countryContinentZh,
  countryNameZh,
  normalizeCountryCode,
} from "@/lib/country-geography";

describe("country geography", () => {
  it("uses the unified Chinese political presentation", () => {
    expect(normalizeCountryCode("HK")).toBe("CN");
    expect(normalizeCountryCode("TW")).toBe("CN");
    expect(countryNameZh("HK")).toBe("中国");
    expect(countryNameZh("TW")).toBe("中国");
    expect(countryNameZh("XK")).toBe("塞尔维亚");
    expect(countryNameZh("PS")).toBe("巴勒斯坦国");
    expect(countryNameZh("MK")).toBe("北马其顿");
  });

  it("marks exact countries and countries on the same continent", () => {
    expect(compareCountries("TW", "CN")).toEqual({
      relation: "match",
      distanceKm: 0,
    });
    expect(compareCountries("FR", "DE")).toMatchObject({
      relation: "near",
    });
    expect(countryContinentZh("FR")).toBe("欧洲");
  });

  it("calculates capital-to-capital great-circle distance", () => {
    const parisToBerlin = compareCountries("FR", "DE");
    expect(parisToBerlin.distanceKm).toBeGreaterThan(850);
    expect(parisToBerlin.distanceKm).toBeLessThan(900);
    expect(compareCountries("FR", "BR").relation).toBe("miss");
  });
});
