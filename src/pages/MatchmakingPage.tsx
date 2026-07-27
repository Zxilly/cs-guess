import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  SpinnerGapIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Navigate, useNavigate } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useMatchmakingQueue } from "@/hooks/use-matchmaking-queue";
import { useRealtimeRoom } from "@/hooks/use-realtime-room";
import {
  ApiError,
  cancelQuickMatch,
  clearCredentials,
  loadCredentials,
  queueCountFor,
  readNumber,
  readRecords,
  readString,
} from "@/lib/realtime";

export function MatchmakingPage() {
  const navigate = useNavigate();
  const [session] = useState(() => loadCredentials("quick"));
  const [elapsed, setElapsed] = useState(0);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const queue = useMatchmakingQueue();
  const realtime = useRealtimeRoom(
    session?.credentials ?? null,
    session?.snapshot,
  );

  const phase = readString(realtime.snapshot, "phase") ?? "waiting";
  const bestOf = readNumber(realtime.snapshot, "best_of") ?? 3;
  const partySize = readNumber(realtime.snapshot, "max_players") === 4 ? 4 : 2;
  const visibility = readString(realtime.snapshot, "visibility") ?? "hidden";
  const selectedWaiting = queueCountFor(
    queue.counts,
    partySize,
    bestOf === 1 || bestOf === 5 ? bestOf : 3,
    visibility === "open" ? "open" : "hidden",
  );
  const joinedPlayerCount =
    readRecords(realtime.snapshot, "players").length +
    realtime.events.filter((event) => event.type === "player_joined").length;
  const matched =
    joinedPlayerCount >= partySize ||
    phase === "playing" ||
    phase === "finished" ||
    realtime.events.some(
      (event) =>
        event.type === "round_started" || event.type === "round_finished",
    );

  useEffect(() => {
    if (matched) navigate("/play/quick", { replace: true });
  }, [matched, navigate]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  if (!session) return <Navigate to="/quick" replace />;
  const credentials = session.credentials;

  async function cancel() {
    setCancelPending(true);
    setCancelError("");
    try {
      await cancelQuickMatch(credentials);
      clearCredentials();
      navigate(partySize === 4 ? "/quick?players=4" : "/quick", {
        replace: true,
      });
    } catch (caught) {
      setCancelError(
        caught instanceof ApiError
          ? caught.message
          : "取消匹配失败，请稍后重试。",
      );
      setCancelPending(false);
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={partySize === 4 ? "4 人乱斗匹配" : "实时 1v1 匹配"}
        action={
          <p className="font-mono text-sm">
            {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
            {String(elapsed % 60).padStart(2, "0")}
          </p>
        }
      />

      <main className="app-main">
        <PageIntro
          eyebrow={partySize === 4 ? "Group Queue · Live" : "Duel Queue · Live"}
          title={partySize === 4 ? "正在召集另外三名玩家" : "正在寻找对手"}
          help={
            <InfoTip label="匹配条件" side="right" className="size-6">
              系统只会匹配人数、赛制和猜测可见性完全相同的玩家。
            </InfoTip>
          }
          aside={
            <Button
              variant="outline"
              className="w-full rounded-none sm:w-auto"
              onClick={() => void cancel()}
              disabled={cancelPending}
            >
              {cancelPending ? (
                <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowLeftIcon />
              )}
              {cancelPending ? "正在取消…" : "取消匹配"}
            </Button>
          }
        />

        <Card
          asChild
          className="mt-10 gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
        >
          <section>
          <div className="grid sm:grid-cols-3">
            {([1, 3, 5] as const).map((option) => {
              const count = queueCountFor(
                queue.counts,
                partySize,
                option,
                visibility === "open" ? "open" : "hidden",
              );
              const selected = option === bestOf;
              return (
                <div
                  key={option}
                  className={`border-b border-foreground/20 p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 ${
                    selected ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-mono text-sm font-semibold">BO{option}</p>
                    {selected ? (
                      <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
                    ) : null}
                  </div>
                  <p className="mt-7 font-mono text-3xl font-semibold">{count}</p>
                  <p
                    className={`mt-1 text-xs ${
                      selected
                        ? "text-primary-foreground/75"
                        : "text-muted-foreground"
                    }`}
                  >
                    当前等待人数
                  </p>
                </div>
              );
            })}
          </div>

          <div
            className="grid grid-cols-2 border-t border-foreground/20 xl:grid-cols-[repeat(4,1fr)_auto]"
            aria-live="polite"
          >
            {[
              ["已等待", `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`],
              ["对战规模", partySize === 4 ? "4 人乱斗" : "1v1"],
              ["所选赛制", `BO${bestOf}`],
              ["对手猜测", visibility === "hidden" ? "隐藏模式" : "明牌模式"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="border-r border-b border-foreground/20 px-4 py-4 even:border-r-0 xl:border-r xl:border-b-0"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-mono text-sm font-semibold">{value}</p>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-3 px-4 py-4 text-sm text-primary xl:col-span-1">
              <UsersThreeIcon className="size-5" />
              <Badge
                variant={queue.live ? "default" : "outline"}
                className="rounded-none"
              >
                {queue.live ? `本队列 ${selectedWaiting} 人` : "连接队列中"}
              </Badge>
            </div>
          </div>
          {cancelError ? (
            <p
              className="border-t border-foreground/20 px-5 py-3 text-sm text-destructive"
              role="alert"
            >
              {cancelError}
            </p>
          ) : null}
          </section>
        </Card>
      </main>
    </div>
  );
}
