const routeModuleImports = {
  modeLobby: () => import("@/pages/ModeLobby"),
  dailyGame: () => import("@/pages/GamePage"),
  soloGame: () => import("@/pages/SoloGamePage"),
  soloDifficulty: () => import("@/pages/SoloDifficultyPage"),
  liveGame: () => import("@/pages/LiveGamePage"),
  matchmaking: () => import("@/pages/MatchmakingPage"),
  quickMatch: () => import("@/pages/QuickMatch"),
  roomEntry: () => import("@/pages/RoomEntry"),
  stats: () => import("@/pages/StatsPage"),
  identity: () => import("@/pages/IdentityPage"),
} as const;

export type RouteModuleKey = keyof typeof routeModuleImports;

const routeModulePromises = new Map<RouteModuleKey, Promise<unknown>>();

export function loadRouteModule<Key extends RouteModuleKey>(
  key: Key,
): ReturnType<(typeof routeModuleImports)[Key]> {
  let promise = routeModulePromises.get(key);
  if (!promise) {
    promise = routeModuleImports[key]().catch((error: unknown) => {
      routeModulePromises.delete(key);
      throw error;
    });
    routeModulePromises.set(key, promise);
  }

  return promise as ReturnType<(typeof routeModuleImports)[Key]>;
}

export const routeModules = {
  modeLobby: () => loadRouteModule("modeLobby"),
  dailyGame: () => loadRouteModule("dailyGame"),
  soloGame: () => loadRouteModule("soloGame"),
  soloDifficulty: () => loadRouteModule("soloDifficulty"),
  liveGame: () => loadRouteModule("liveGame"),
  matchmaking: () => loadRouteModule("matchmaking"),
  quickMatch: () => loadRouteModule("quickMatch"),
  roomEntry: () => loadRouteModule("roomEntry"),
  stats: () => loadRouteModule("stats"),
  identity: () => loadRouteModule("identity"),
} as const;

const routeKeyByPathname: Readonly<Record<string, RouteModuleKey>> = {
  "/": "modeLobby",
  "/identity": "identity",
  "/play/daily": "dailyGame",
  "/solo": "soloDifficulty",
  "/play/solo": "soloGame",
  "/quick": "quickMatch",
  "/matching": "matchmaking",
  "/play/quick": "liveGame",
  "/play/room": "liveGame",
  "/room": "roomEntry",
  "/stats": "stats",
};

const backgroundPreloadOrder: readonly RouteModuleKey[] = [
  "identity",
  "modeLobby",
  "dailyGame",
  "soloDifficulty",
  "quickMatch",
  "roomEntry",
  "stats",
  "soloGame",
  "matchmaking",
  "liveGame",
];

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

interface IdleCallbackHost {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
}

function normalizePathname(pathname: string) {
  const pathWithoutQuery = pathname.split(/[?#]/u, 1)[0] || "/";
  return pathWithoutQuery.length > 1
    ? pathWithoutQuery.replace(/\/+$/u, "")
    : pathWithoutQuery;
}

export function routeKeyForPathname(
  pathname: string,
): RouteModuleKey | undefined {
  return routeKeyByPathname[normalizePathname(pathname)];
}

export function preloadRoute(pathname: string) {
  const routeKey = routeKeyForPathname(pathname);
  return routeKey ? loadRouteModule(routeKey) : undefined;
}

export function shouldPreloadInBackground(
  connection?: NetworkInformationLike,
) {
  return (
    connection?.saveData !== true &&
    connection?.effectiveType !== "slow-2g" &&
    connection?.effectiveType !== "2g" &&
    connection?.effectiveType !== "3g"
  );
}

function scheduleIdleBackgroundPreloads() {
  const idleWindow = window as unknown as IdleCallbackHost;
  const queue = [...backgroundPreloadOrder];
  let cancelled = false;
  let idleHandle: number | undefined;
  let timeoutHandle: number | undefined;

  const scheduleNext = () => {
    if (cancelled || queue.length === 0) {
      return;
    }

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(runNext, {
        timeout: 5_000,
      });
    } else {
      timeoutHandle = window.setTimeout(runNext, 1_200);
    }
  };

  const runNext = () => {
    if (cancelled) {
      return;
    }

    const routeKey = queue.shift();
    if (!routeKey) {
      return;
    }

    void loadRouteModule(routeKey)
      .catch(() => undefined)
      .finally(scheduleNext);
  };

  scheduleNext();

  return () => {
    cancelled = true;
    if (idleHandle !== undefined) {
      idleWindow.cancelIdleCallback?.(idleHandle);
    }
    if (timeoutHandle !== undefined) {
      window.clearTimeout(timeoutHandle);
    }
  };
}

function scheduleBackgroundPreloads() {
  const connection = (navigator as NavigatorWithConnection).connection;
  if (!shouldPreloadInBackground(connection)) {
    return () => undefined;
  }

  let cancelled = false;
  let cancelIdlePreloads: () => void = () => undefined;
  const startAfterDomReady = () => {
    if (!cancelled) {
      cancelIdlePreloads = scheduleIdleBackgroundPreloads();
    }
  };

  if (document.readyState !== "loading") {
    startAfterDomReady();
  } else {
    document.addEventListener("DOMContentLoaded", startAfterDomReady, {
      once: true,
    });
  }

  return () => {
    cancelled = true;
    document.removeEventListener("DOMContentLoaded", startAfterDomReady);
    cancelIdlePreloads();
  };
}

function preloadLinkTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
    return;
  }

  const url = new URL(anchor.href, window.location.href);
  if (url.origin === window.location.origin) {
    void preloadRoute(url.pathname)?.catch(() => undefined);
  }
}

export function installRoutePreloading() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const handleIntent = (event: Event) => preloadLinkTarget(event.target);
  document.addEventListener("pointerover", handleIntent, {
    capture: true,
    passive: true,
  });
  document.addEventListener("focusin", handleIntent, true);
  document.addEventListener("touchstart", handleIntent, {
    capture: true,
    passive: true,
  });
  const cancelBackgroundPreloads = scheduleBackgroundPreloads();

  return () => {
    document.removeEventListener("pointerover", handleIntent, true);
    document.removeEventListener("focusin", handleIntent, true);
    document.removeEventListener("touchstart", handleIntent, true);
    cancelBackgroundPreloads();
  };
}
