import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { Navigate, useNavigate } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { MatchFoundOverlay } from "@/components/MatchFoundOverlay";
import { PageIntro } from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useMatchmakingQueue } from "@/hooks/use-matchmaking-queue";
import { useRealtimeRoom } from "@/hooks/use-realtime-room";
import {
  ApiError,
  cancelQuickMatch,
  clearCredentialsIfMatches,
  loadClosingIntent,
  loadCredentials,
  playingCountFor,
  queueCountFor,
  readNumber,
  readRecords,
  readString,
  realtimeCredentialsMatch,
  type ConnectionState,
} from "@/lib/realtime";
import {
  QuickMatchCancellation,
  QuickMatchCancellationTimeoutError,
} from "@/lib/quick-match-cancellation";
import {
  parseSoloDifficulty,
  SOLO_DIFFICULTIES,
} from "@/lib/solo-game";
import type { BestOf } from "@/types/game";

const WAITING_TIMEOUT_SECONDS = 10 * 60;

function roomConnectionLabel(connection: ConnectionState) {
  switch (connection) {
    case "connected":
      return "房间已连接";
    case "reconnecting":
      return "房间正在重连";
    case "offline":
      return "房间连接离线";
    case "closed":
      return "房间连接已关闭";
    default:
      return "房间连接中";
  }
}

export function MatchmakingPage() {
  const navigate = useNavigate();
  const [session] = useState(() => loadCredentials("quick"));
  const [closingIntent, setClosingIntent] = useState(() =>
    session ? loadClosingIntent(session.credentials) : null,
  );
  const identity = useAnonymousProfile();
  const [elapsed, setElapsed] = useState(() =>
    session
      ? Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000))
      : 0,
  );
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [showMatchFound, setShowMatchFound] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const recoveryTitleRef = useRef<HTMLHeadingElement | null>(null);
  const recoveryVisibleRef = useRef(false);
  const cancelGuardRef = useRef(false);
  const queue = useMatchmakingQueue();
  const realtime = useRealtimeRoom(
    closingIntent ? null : (session?.credentials ?? null),
    closingIntent ? {} : session?.snapshot,
  );
  const realtimeRef = useRef(realtime);
  const cancellationRef = useRef<QuickMatchCancellation | null>(null);
  const closingReturnToRef = useRef(closingIntent?.returnTo ?? "/quick");
  realtimeRef.current = realtime;

  if (!cancellationRef.current) {
    cancellationRef.current = new QuickMatchCancellation({
      request: cancelQuickMatch,
      commit: (ticket) => {
        realtimeRef.current.close();
        const ownsCurrentSession = realtimeCredentialsMatch(
          loadCredentials("quick")?.credentials,
          ticket,
        );
        clearCredentialsIfMatches(ticket);
        if (!ownsCurrentSession) return;
        navigate(closingReturnToRef.current, { replace: true });
      },
      onPending: (pending) => {
        cancelGuardRef.current = pending;
        setCancelPending(pending);
        if (pending) {
          setShowMatchFound(false);
          setCancelError("");
        }
      },
      onClosing: (ticket) => {
        const intent = loadClosingIntent(ticket);
        if (intent) closingReturnToRef.current = intent.returnTo;
        setClosingIntent(intent);
        realtimeRef.current.close();
      },
      onError: (caught) => {
        cancelGuardRef.current = false;
        setCancelError(
          caught instanceof ApiError ||
            caught instanceof QuickMatchCancellationTimeoutError
            ? caught.message
            : "取消匹配失败，请稍后重试。",
        );
      },
      returnTo: () => {
        const snapshot = realtimeRef.current.snapshot;
        const difficulty =
          parseSoloDifficulty(readString(snapshot, "difficulty")) ?? "easy";
        const partySize =
          readNumber(snapshot, "max_players") === 4 ? 4 : 2;
        const search = new URLSearchParams({ difficulty });
        if (partySize === 4) search.set("players", "4");
        return `/quick?${search.toString()}`;
      },
    });
  }

  const phase = readString(realtime.snapshot, "phase") ?? "waiting";
  const bestOf = (readNumber(realtime.snapshot, "best_of") ?? 3) as BestOf;
  const partySize = readNumber(realtime.snapshot, "max_players") === 4 ? 4 : 2;
  const visibility =
    readString(realtime.snapshot, "visibility") === "open" ? "open" : "hidden";
  const difficulty =
    parseSoloDifficulty(readString(realtime.snapshot, "difficulty")) ?? "easy";
  const difficultyLabel =
    SOLO_DIFFICULTIES.find((option) => option.id === difficulty)?.label ??
    "简单";
  const snapshotPlayers = readRecords(realtime.snapshot, "players");
  const joinedEvents = realtime.events.filter(
    (event) => event.type === "player_joined",
  );
  const connectedPlayers = new Map<string, string>();
  for (const player of [
    ...snapshotPlayers,
    ...joinedEvents.map((event) =>
      event.player && typeof event.player === "object"
        ? (event.player as Record<string, unknown>)
        : {},
    ),
  ]) {
    const name = readString(player, "display_name") ?? "选手已连接";
    const key = readString(player, "player_id") ?? `name:${name}`;
    connectedPlayers.set(key, name);
  }
  const joinedPlayerCount = connectedPlayers.size;
  const matched =
    joinedPlayerCount >= partySize ||
    phase === "playing" ||
    phase === "finished" ||
    realtime.events.some(
      (event) =>
        event.type === "round_started" || event.type === "round_finished",
    );
  const waitingByBestOf = ([1, 3, 5] as const).map((option) =>
    queueCountFor(
      queue.counts,
      partySize,
      option,
      visibility,
      difficulty,
    ),
  );
  const playingByBestOf = ([1, 3, 5] as const).map((option) =>
    playingCountFor(
      queue.counts,
      partySize,
      option,
      difficulty,
      visibility,
    ),
  );
  const waitingTotal = waitingByBestOf.reduce((sum, count) => sum + count, 0);
  const playingTotal = playingByBestOf.reduce((sum, count) => sum + count, 0);
  const roomStatus = roomConnectionLabel(realtime.connection);
  const waitingTimedOut = elapsed >= WAITING_TIMEOUT_SECONDS && !matched;
  const reconnecting =
    realtime.connection === "connecting" ||
    realtime.connection === "reconnecting";
  const roomUnavailable =
    realtime.connection === "offline" ||
    realtime.connection === "closed";
  const fatalOffline =
    !closingIntent &&
    (realtime.offlineReason === "session_invalid" ||
      realtime.offlineReason === "profile_invalid" ||
      realtime.offlineReason === "configuration" ||
      (roomUnavailable &&
        /会话已失效|身份已失效|地址无效/.test(realtime.error)));
  const showConnectionRecovery =
    Boolean(closingIntent) ||
    (!closingIntent && Boolean(realtime.error)) ||
    Boolean(cancelError) ||
    (!closingIntent && (waitingTimedOut || roomUnavailable));
  const announceConnectionAlert =
    showConnectionRecovery && !reconnecting;
  const recoveryMessage =
    cancelError ||
    (closingIntent
      ? cancelPending
        ? "正在通知服务器退出当前匹配，请勿重复操作。"
        : "退出尚未完成，原匹配已暂停恢复。请重试退出。"
      : realtime.error) ||
    (waitingTimedOut
      ? "等待已超过 10 分钟，可以重试房间连接或安全返回。"
      : `${roomStatus}，可以立即重试或安全返回。`);

  useEffect(() => {
    if (
      closingIntent ||
      !matched ||
      cancelGuardRef.current ||
      cancelPending
    ) {
      return;
    }
    setShowMatchFound(true);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () =>
        navigate("/play/quick", {
          replace: true,
          state: { focusGameHeading: true },
        }),
      reducedMotion ? 0 : 1_700,
    );
    return () => window.clearTimeout(timer);
  }, [cancelPending, closingIntent, matched, navigate]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(
      () =>
        setElapsed(
          Math.max(
            0,
            Math.floor((Date.now() - session.startedAt) / 1000),
          ),
        ),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(
    () => () => {
      cancellationRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (!session || !closingIntent) return;
    closingReturnToRef.current = closingIntent.returnTo;
    cancellationRef.current?.cancel(session.credentials);
  }, [closingIntent, session]);

  useEffect(() => {
    const shouldFocus = showConnectionRecovery && !reconnecting;
    if (shouldFocus && !recoveryVisibleRef.current) {
      recoveryTitleRef.current?.focus({ preventScroll: true });
    }
    recoveryVisibleRef.current = shouldFocus;
  }, [reconnecting, showConnectionRecovery]);

  if (!session) return <Navigate to="/quick" replace />;
  const credentials = session.credentials;
  const opponentNames = [...connectedPlayers.entries()]
    .filter(([playerId]) => playerId !== credentials.playerId)
    .map(([, name]) => name);
  const playerNames = [identity.player.nickname, ...opponentNames].slice(
    0,
    partySize,
  );

  function cancel() {
    cancellationRef.current?.cancel(credentials);
  }

  function discardInvalidSession() {
    realtime.close();
    clearCredentialsIfMatches(credentials);
    const destination =
      realtime.offlineReason === "profile_invalid"
        ? "/identity?return=%2Fquick"
        : "/quick";
    navigate(destination, { replace: true });
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader subtitle={partySize === 4 ? "4 人乱斗匹配" : "实时 1v1 匹配"} />

      <main className="app-main">
        <PageIntro
          eyebrow={partySize === 4 ? "Group Queue · Live" : "Duel Queue · Live"}
          title={
            closingIntent
              ? "正在完成退出"
              : partySize === 4
                ? "等待其余三名玩家"
                : "正在寻找对手"
          }
          help={
            <InfoTip label="匹配条件" side="right" className="size-6">
              系统只会匹配人数、赛制、题库难度和猜测可见性完全相同的玩家。
            </InfoTip>
          }
          aside={
            <Button
              ref={cancelButtonRef}
              variant="outline"
              className="w-full rounded-none sm:w-auto"
              onClick={cancel}
              disabled={cancelPending}
            >
              {cancelPending ? (
                <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowLeftIcon />
              )}
              {cancelPending
                ? "正在退出…"
                : closingIntent
                  ? "重试退出"
                  : "取消匹配"}
            </Button>
          }
        />

        <Card
          asChild
          className="mt-10 gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
        >
          <section aria-busy={cancelPending}>
            <div className="grid border-b border-foreground/20 sm:grid-cols-3">
              <div className="p-5">
                <p className="text-xs text-muted-foreground">当前身份</p>
                <p className="mt-2 font-semibold">{identity.player.nickname}</p>
              </div>
              <div className="border-t border-foreground/20 p-5 sm:border-t-0 sm:border-l">
                <p className="text-xs text-muted-foreground">公共队列数据</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {queue.live ? "已连接" : "连接中"}
                </p>
              </div>
              <div className="border-t border-foreground/20 p-5 sm:border-t-0 sm:border-l">
                <p className="text-xs text-muted-foreground">房间连接</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {roomStatus}
                </p>
              </div>
            </div>

            {showConnectionRecovery && (
              <div
                className="border-b border-foreground/20 px-5 py-4"
                role={announceConnectionAlert ? "alert" : undefined}
              >
                <h2
                  ref={recoveryTitleRef}
                  tabIndex={-1}
                  className="text-sm font-semibold text-destructive outline-none"
                >
                  {closingIntent
                    ? "正在完成退出"
                    : fatalOffline
                      ? "当前匹配会话已失效"
                      : "连接需要处理"}
                </h2>
                <p className="mt-1 text-sm text-destructive">
                  {recoveryMessage}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {closingIntent ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancel}
                      disabled={cancelPending}
                    >
                      {cancelPending ? "正在退出…" : "重试退出"}
                    </Button>
                  ) : fatalOffline ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={discardInvalidSession}
                    >
                      {realtime.offlineReason === "profile_invalid"
                        ? "重新设置身份"
                        : "重新匹配"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={realtime.retry}
                      disabled={cancelPending}
                    >
                      <ArrowClockwiseIcon />
                      重试房间连接
                    </Button>
                  )}
                  {!closingIntent ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancel}
                      disabled={cancelPending}
                    >
                      安全返回
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-3">
              {([1, 3, 5] as const).map((option, index) => {
                const selected = option === bestOf;
                return (
                  <div
                    key={option}
                    className={`border-b border-foreground/20 p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 ${
                      selected ? "bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-mono text-sm font-semibold">
                        BO{option}
                      </p>
                      {selected ? (
                        <span className="inline-flex items-center gap-2 text-xs">
                          <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
                          正在匹配
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-7 grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-mono text-3xl font-semibold">
                          {waitingByBestOf[index]}
                        </p>
                        <p className="mt-1 text-xs">等待匹配</p>
                      </div>
                      <div>
                        <p className="font-mono text-3xl font-semibold">
                          {playingByBestOf[index]}
                        </p>
                        <p className="mt-1 text-xs">游戏中</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 border-t border-foreground/20 md:grid-cols-4">
              {[
                [
                  "已等待",
                  `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
                    elapsed % 60,
                  ).padStart(2, "0")}`,
                ],
                ["当前条件等待总数", String(waitingTotal)],
                ["当前条件游戏中总数", String(playingTotal)],
                [
                  "当前规则",
                  `${partySize === 4 ? "4 人乱斗" : "1v1"} · ${difficultyLabel} · BO${bestOf} · ${
                    visibility === "hidden" ? "隐藏" : "明牌"
                  }`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border-r border-b border-foreground/20 px-4 py-4 even:border-r-0 md:border-b-0 md:even:border-r md:last:border-r-0"
                >
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 font-mono text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <p
              className="sr-only"
              role={announceConnectionAlert ? undefined : "status"}
              aria-live={announceConnectionAlert ? "off" : "polite"}
              aria-atomic="true"
              data-testid="matching-connection-status"
            >
              公共队列数据{queue.live ? "已连接" : "连接中"}；{roomStatus}。
              {cancelPending ? "正在取消匹配。" : ""}
            </p>
            <p
              className="sr-only"
              aria-live="off"
              data-testid="matching-queue-summary"
            >
              当前 {joinedPlayerCount} 人；等待 {waitingTotal} 人，游戏中{" "}
              {playingTotal} 人。
            </p>

          </section>
        </Card>
      </main>
      {showMatchFound ? (
        <MatchFoundOverlay
          playerNames={playerNames}
          partySize={partySize}
          bestOf={bestOf}
          difficulty={difficulty}
          onEnter={() =>
            navigate("/play/quick", {
              replace: true,
              state: { focusGameHeading: true },
            })
          }
        />
      ) : null}
    </div>
  );
}
