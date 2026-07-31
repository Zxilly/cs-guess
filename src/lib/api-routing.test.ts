import { describe, expect, it } from "vitest";

import {
  apiBaseForLanguages,
  prefersDirectApi,
  shouldUseSameOriginApi,
  socketUrlForRouting,
} from "@/lib/api-routing";

const DIRECT_API = "https://api.cs-guess.zxilly.com";

describe("API traffic routing", () => {
  it("keeps the configured API origin for Chinese-primary browsers", () => {
    expect(prefersDirectApi(["zh-CN", "en-US"])).toBe(true);
    expect(apiBaseForLanguages(["zh-CN", "en-US"], `${DIRECT_API}/`)).toBe(
      DIRECT_API,
    );
  });

  it("uses the same-origin CDN route for non-Chinese primary languages", () => {
    expect(shouldUseSameOriginApi(["en-US", "zh-CN"])).toBe(true);
    expect(apiBaseForLanguages(["en-US", "zh-CN"], DIRECT_API)).toBe("");
    expect(apiBaseForLanguages(["fr-FR", "zh-CN"], DIRECT_API)).toBe("");
  });

  it("rewrites absolute Socket.IO endpoints to the site CDN origin", () => {
    expect(
      socketUrlForRouting(`${DIRECT_API}/socket.io?transport=websocket`, {
        apiBase: "",
        pageOrigin: "https://cs-guess.zxilly.com",
        useSameOriginApi: true,
      }).href,
    ).toBe(
      "https://cs-guess.zxilly.com/socket.io?transport=websocket",
    );
  });

  it("preserves direct routing when no browser preference is available", () => {
    expect(shouldUseSameOriginApi([])).toBe(false);
    expect(apiBaseForLanguages([], DIRECT_API)).toBe(DIRECT_API);
  });
});
