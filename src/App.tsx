import { lazy, Suspense, useEffect } from "react";
import { CrosshairIcon } from "@phosphor-icons/react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";

import { loadCredentials } from "@/lib/realtime";
import { hasConfirmedIdentity } from "@/lib/identity-profile";

const ModeLobby = lazy(() =>
  import("@/pages/ModeLobby").then((module) => ({
    default: module.ModeLobby,
  })),
);
const GamePage = lazy(() =>
  import("@/pages/GamePage").then((module) => ({
    default: module.GamePage,
  })),
);
const LiveGamePage = lazy(() =>
  import("@/pages/LiveGamePage").then((module) => ({
    default: module.LiveGamePage,
  })),
);
const MatchmakingPage = lazy(() =>
  import("@/pages/MatchmakingPage").then((module) => ({
    default: module.MatchmakingPage,
  })),
);
const QuickMatch = lazy(() =>
  import("@/pages/QuickMatch").then((module) => ({
    default: module.QuickMatch,
  })),
);
const RoomEntry = lazy(() =>
  import("@/pages/RoomEntry").then((module) => ({
    default: module.RoomEntry,
  })),
);
const StatsPage = lazy(() =>
  import("@/pages/StatsPage").then((module) => ({
    default: module.StatsPage,
  })),
);
const IdentityPage = lazy(() =>
  import("@/pages/IdentityPage").then((module) => ({
    default: module.IdentityPage,
  })),
);

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

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

function IdentityRequired() {
  const location = useLocation();
  if (!hasConfirmedIdentity()) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/identity?return=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }
  return <Outlet />;
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
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="identity" element={<IdentityPage />} />
          <Route element={<IdentityRequired />}>
            <Route index element={<ModeLobby />} />
            <Route path="play/daily" element={<GamePage mode="daily" />} />
            <Route path="quick" element={<QuickMatch />} />
            <Route path="matching" element={<MatchmakingPage />} />
            <Route path="play/quick" element={<QuickGameRoute />} />
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
