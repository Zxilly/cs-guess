import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { CrosshairIcon } from "@phosphor-icons/react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";

import { DailyGameLoading } from "@/components/DailyGameLoading";
import { GlobalSoundManager } from "@/components/GlobalSoundManager";
import { MatchmakingQueueProvider } from "@/hooks/use-matchmaking-queue";
import { RealtimeRoomProvider } from "@/hooks/use-realtime-room";
import {
  loadCredentials,
  realtimeCredentialsMatch,
} from "@/lib/realtime";
import { hasConfirmedIdentity } from "@/lib/identity-profile";
import {
  installRoutePreloading,
  routeModules,
} from "@/lib/route-preload";

const ModeLobby = lazy(() =>
  routeModules.modeLobby().then((module) => ({
    default: module.ModeLobby,
  })),
);
const GamePage = lazy(() =>
  routeModules.dailyGame().then((module) => ({
    default: module.GamePage,
  })),
);
const SoloGamePage = lazy(() =>
  routeModules.soloGame().then((module) => ({
    default: module.SoloGamePage,
  })),
);
const SoloDifficultyPage = lazy(() =>
  routeModules.soloDifficulty().then((module) => ({
    default: module.SoloDifficultyPage,
  })),
);
const LiveGamePage = lazy(() =>
  routeModules.liveGame().then((module) => ({
    default: module.LiveGamePage,
  })),
);
const MatchmakingPage = lazy(() =>
  routeModules.matchmaking().then((module) => ({
    default: module.MatchmakingPage,
  })),
);
const QuickMatch = lazy(() =>
  routeModules.quickMatch().then((module) => ({
    default: module.QuickMatch,
  })),
);
const RoomEntry = lazy(() =>
  routeModules.roomEntry().then((module) => ({
    default: module.RoomEntry,
  })),
);
const StatsPage = lazy(() =>
  routeModules.stats().then((module) => ({
    default: module.StatsPage,
  })),
);
const IdentityPage = lazy(() =>
  routeModules.identity().then((module) => ({
    default: module.IdentityPage,
  })),
);

function RoutePreloadManager() {
  useEffect(() => installRoutePreloading(), []);
  return null;
}

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useLayoutEffect(() => {
    const resetScroll = () =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, search]);

  return null;
}

function RoomGameRoute() {
  if (!loadCredentials("room")) {
    return <Navigate to="/room" replace />;
  }

  return <LiveGamePage mode="room" />;
}

function QuickGameRoute() {
  if (!loadCredentials("quick")) {
    return <Navigate to="/quick" replace />;
  }

  return <LiveGamePage mode="quick" />;
}

function QuickFlowScope() {
  const location = useLocation();
  const sessionRef = useRef<ReturnType<typeof loadCredentials>>(null);
  const storedSession = loadCredentials("quick");

  if (!storedSession) {
    sessionRef.current = null;
  } else if (
    !sessionRef.current ||
    !realtimeCredentialsMatch(
      sessionRef.current.credentials,
      storedSession.credentials,
    )
  ) {
    sessionRef.current = storedSession;
  }

  const session = sessionRef.current;
  const inGame = location.pathname === "/play/quick";
  const realtimeEnabled =
    location.pathname === "/matching" || inGame;

  return (
    <MatchmakingQueueProvider enabled={!inGame}>
      <RealtimeRoomProvider
        credentials={realtimeEnabled ? (session?.credentials ?? null) : null}
        initialSnapshot={realtimeEnabled ? session?.snapshot : undefined}
        enabled={realtimeEnabled}
      >
        <Outlet />
      </RealtimeRoomProvider>
    </MatchmakingQueueProvider>
  );
}

function IdentityRequired() {
  const location = useLocation();
  if (!hasConfirmedIdentity()) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <>
        <IdentityRouteLoading />
        <Navigate
          to={`/identity?return=${encodeURIComponent(returnTo)}`}
          replace
        />
      </>
    );
  }
  return <Outlet />;
}

export function IdentityRouteLoading() {
  return (
    <div
      className="min-h-svh bg-background text-foreground"
      role="status"
      aria-label="正在载入玩家身份"
    >
      <header className="border-b border-foreground/20">
        <div className="app-container flex min-h-20 items-center gap-3 py-4">
          <CrosshairIcon
            className="size-9 shrink-0 text-primary"
            weight="regular"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold tracking-[0.08em]">
              CS GUESS
            </p>
            <p className="truncate text-xs text-muted-foreground">
              玩家身份
            </p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <div className="h-3 w-24 animate-pulse bg-primary/25 motion-reduce:animate-none" />
            <div className="mt-3 h-12 w-64 max-w-full animate-pulse bg-foreground/10 motion-reduce:animate-none" />
          </div>
          <div className="h-8 w-24 shrink-0 animate-pulse border border-foreground/20 bg-muted/45 motion-reduce:animate-none" />
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <div className="overflow-hidden border border-foreground/25">
            <div className="flex min-h-64 flex-col justify-between p-6 sm:p-8">
              <div className="h-3 w-24 animate-pulse bg-foreground/10 motion-reduce:animate-none" />
              <div>
                <div className="mt-10 h-14 w-72 max-w-full animate-pulse bg-foreground/10 motion-reduce:animate-none" />
                <div className="mt-3 h-4 w-80 max-w-full animate-pulse bg-foreground/10 motion-reduce:animate-none" />
              </div>
              <div className="mt-9 h-6 w-28 animate-pulse border border-foreground/20 bg-muted/45 motion-reduce:animate-none" />
            </div>
            <div className="h-12 animate-pulse border-t border-foreground/20 bg-muted/25 motion-reduce:animate-none" />
          </div>

          <div className="border border-foreground/25">
            <div className="flex min-h-16 items-center border-b border-foreground/20 px-5">
              <div className="h-5 w-32 animate-pulse bg-foreground/10 motion-reduce:animate-none" />
            </div>
            <div className="grid min-h-64 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="h-5 w-40 animate-pulse bg-foreground/10 motion-reduce:animate-none" />
              <div className="h-9 w-28 animate-pulse bg-primary/25 motion-reduce:animate-none" />
            </div>
          </div>
        </div>
        <span className="sr-only">正在载入身份资料…</span>
      </main>
    </div>
  );
}

function RouteLoading() {
  return (
    <div
      className="min-h-svh bg-background text-foreground"
      role="status"
      aria-label="正在载入页面"
    >
      <header className="border-b border-foreground/20">
        <div className="app-container flex items-center gap-3 py-5">
          <CrosshairIcon className="size-9 text-primary" />
          <div>
            <p className="font-bold tracking-[0.08em]">CS GUESS</p>
            <p className="text-xs text-muted-foreground">正在准备对局</p>
          </div>
        </div>
      </header>
      <main className="app-main">
        <div className="h-2 w-24 animate-pulse bg-primary motion-reduce:animate-none" />
        <div className="mt-7 h-12 w-64 max-w-full animate-pulse bg-foreground/10 motion-reduce:animate-none" />
        <div className="mt-10 grid border border-foreground/20 sm:grid-cols-2">
          <div className="h-52 animate-pulse border-b border-foreground/20 bg-muted/45 motion-reduce:animate-none sm:border-r sm:border-b-0" />
          <div className="h-52 animate-pulse bg-muted/25 motion-reduce:animate-none" />
        </div>
        <span className="sr-only">正在载入…</span>
      </main>
    </div>
  );
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <RoutePreloadManager />
      <GlobalSoundManager />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route
            path="identity"
            element={
              <Suspense fallback={<IdentityRouteLoading />}>
                <IdentityPage />
              </Suspense>
            }
          />
          <Route element={<IdentityRequired />}>
            <Route index element={<ModeLobby />} />
            <Route
              path="play/daily"
              element={
                <Suspense fallback={<DailyGameLoading />}>
                  <GamePage mode="daily" />
                </Suspense>
              }
            />
            <Route path="solo" element={<SoloDifficultyPage />} />
            <Route path="play/solo" element={<SoloGamePage />} />
            <Route element={<QuickFlowScope />}>
              <Route path="quick" element={<QuickMatch />} />
              <Route path="matching" element={<MatchmakingPage />} />
              <Route path="play/quick" element={<QuickGameRoute />} />
            </Route>
            <Route path="play/room" element={<RoomGameRoute />} />
            <Route path="room" element={<RoomEntry />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
