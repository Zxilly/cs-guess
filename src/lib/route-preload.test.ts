// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  installRoutePreloading,
  preloadRoute,
  routeKeyForPathname,
  shouldPreloadInBackground,
} from "@/lib/route-preload";

describe("route preloading", () => {
  it("maps every navigable pathname to its lazy route module", () => {
    expect(routeKeyForPathname("/")).toBe("modeLobby");
    expect(routeKeyForPathname("/identity?return=%2Fquick")).toBe("identity");
    expect(routeKeyForPathname("/play/daily/")).toBe("dailyGame");
    expect(routeKeyForPathname("/play/solo")).toBe("soloGame");
    expect(routeKeyForPathname("/play/quick")).toBe("liveGame");
    expect(routeKeyForPathname("/play/room")).toBe("liveGame");
    expect(routeKeyForPathname("/missing")).toBeUndefined();
  });

  it("reuses the same module promise for repeated preloads", () => {
    const firstPreload = preloadRoute("/solo");
    const secondPreload = preloadRoute("/solo?difficulty=hard");

    expect(firstPreload).toBeDefined();
    expect(secondPreload).toBe(firstPreload);
  });

  it("respects explicit reduced-data connections", () => {
    expect(shouldPreloadInBackground()).toBe(true);
    expect(shouldPreloadInBackground({ effectiveType: "4g" })).toBe(true);
    expect(shouldPreloadInBackground({ effectiveType: "3g" })).toBe(false);
    expect(shouldPreloadInBackground({ effectiveType: "2g" })).toBe(false);
    expect(shouldPreloadInBackground({ saveData: true })).toBe(false);
  });

  it("starts after DOM readiness without waiting for external resources", () => {
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

    const uninstall = installRoutePreloading();
    expect(requestIdleCallback).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(requestIdleCallback).toHaveBeenCalledOnce();

    uninstall();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
