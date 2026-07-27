import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LightningIcon,
  SpinnerGapIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { SeriesSelector } from "@/components/SeriesSelector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useMatchmakingQueue } from "@/hooks/use-matchmaking-queue";
import {
  ApiError,
  createQuickMatch,
  loadCredentials,
  playingCountFor,
  queueCountFor,
  readString,
  saveCredentials,
} from "@/lib/realtime";
import type { BestOf, OpponentVisibility, PartySize } from "@/types/game";

export function QuickMatch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const existingSession = useRef(loadCredentials("quick"));
  const requestController = useRef<AbortController | null>(null);
  const identity = useAnonymousProfile();
  const [partySize, setPartySize] = useState<PartySize>(
    searchParams.get("players") === "4" ? 4 : 2,
  );
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [visibility, setVisibility] =
    useState<OpponentVisibility>("hidden");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const queue = useMatchmakingQueue();

  useEffect(() => {
    const session = existingSession.current;
    if (!session) return;
    const phase = readString(session.snapshot, "phase") ?? "waiting";
    navigate(phase === "waiting" ? "/matching" : "/play/quick", {
      replace: true,
    });
  }, [navigate]);

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  async function startMatching(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const controller = new AbortController();
    requestController.current = controller;
    setPending(true);
    setError("");
    try {
      const response = await createQuickMatch(
        identity.player.id,
        visibility,
        bestOf,
        partySize,
        controller.signal,
      );
      saveCredentials(response, "quick");
      navigate("/matching", { replace: true });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "匹配失败，请稍后重试。",
      );
      setPending(false);
    }
  }

  const waitingCounts: Record<BestOf, number> = {
    1: queueCountFor(queue.counts, partySize, 1, visibility),
    3: queueCountFor(queue.counts, partySize, 3, visibility),
    5: queueCountFor(queue.counts, partySize, 5, visibility),
  };
  const playingCounts: Record<BestOf, number> = {
    1: playingCountFor(queue.counts, partySize, 1),
    3: playingCountFor(queue.counts, partySize, 3),
    5: playingCountFor(queue.counts, partySize, 5),
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={partySize === 4 ? "4 人乱斗" : "实时 1v1"}
        backToLobby
      />

      <main className="app-main">
        <PageIntro
          eyebrow="Quick Match"
          title="设置这场对战"
          help={
            <InfoTip label="匹配规则" side="right" className="size-6">
              只会匹配人数、赛制和猜测可见性完全相同的玩家。
            </InfoTip>
          }
          aside={
            <Badge variant="outline" className="h-7 rounded-none px-2.5">
              <span
                className={`size-1.5 ${queue.live ? "bg-primary" : "bg-muted-foreground/40"}`}
              />
              {queue.live
                ? `${queue.counts.total} 人等待 · ${queue.counts.playing_total} 人游戏中`
                : "连接队列中"}
            </Badge>
          }
        />

        <Card
          asChild
          className="mt-6 grid gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0 lg:grid-cols-2"
        >
          <form onSubmit={startMatching}>
            <section className="border-b border-foreground/20 p-6 lg:border-r lg:border-b-0">
              <PlayerIdentity
                player={identity.player}
                stats={identity.profile.stats}
                drawCredits={identity.profile.drawCredits}
                lossesTowardCredit={identity.profile.lossesTowardCredit}
                winRate={identity.winRate}
                currentPool={identity.currentPool}
                manageHref={`/identity?return=${encodeURIComponent(
                  partySize === 4 ? "/quick?players=4" : "/quick",
                )}`}
                disabled={pending}
              />
              <div className="mt-5 flex items-center gap-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  对战规模
                </p>
                <InfoTip label="对战规模说明" side="right" className="size-10">
                  1v1 是双人竞速；4 人乱斗会展示三位对手的独立进度。
                </InfoTip>
              </div>
              <div
                className="mt-2 grid grid-cols-2 border border-foreground/25"
                role="group"
                aria-label="对战规模"
              >
                {([2, 4] as const).map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant={partySize === size ? "default" : "ghost"}
                    aria-pressed={partySize === size}
                    onClick={() => setPartySize(size)}
                    className="h-12 rounded-none border-r border-foreground/20 text-sm last:border-r-0"
                  >
                    {size === 4 ? <UsersThreeIcon /> : <UsersIcon />}
                    {size === 4 ? "4 人乱斗" : "1v1"}
                  </Button>
                ))}
              </div>
            </section>

            <section className="p-6">
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-1">
                  <h2 className="text-xl font-semibold">选择赛制</h2>
                  <InfoTip label="赛制说明" side="right" className="size-10">
                    BO1 一局定胜负，BO3 先赢两局，BO5 先赢三局。
                  </InfoTip>
                </div>
                <p className="font-mono text-xs text-primary">
                  {waitingCounts[bestOf]} 人等待 · {playingCounts[bestOf]} 人游戏中
                </p>
              </div>
              <div className="mt-5">
                <SeriesSelector
                  value={bestOf}
                  onChange={setBestOf}
                  waitingCounts={waitingCounts}
                />
              </div>

              <div className="mt-5 flex items-center gap-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  对手猜测
                </p>
                <InfoTip label="猜测可见性说明" side="right" className="size-10">
                  隐藏模式只展示命中的属性；明牌模式会显示具体猜测选手。
                </InfoTip>
              </div>
              <div
                className="mt-2 grid grid-cols-2 border border-foreground/25"
                role="group"
                aria-label="对手猜测可见性"
              >
                {(["hidden", "open"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={visibility === option ? "default" : "ghost"}
                    aria-pressed={visibility === option}
                    onClick={() => setVisibility(option)}
                    className="h-12 rounded-none border-r border-foreground/20 text-sm last:border-r-0"
                  >
                    {option === "hidden" ? "隐藏猜测" : "明牌模式"}
                  </Button>
                ))}
              </div>

              {error ? (
                <p className="mt-5 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                className="mt-6 h-12 w-full justify-between rounded-none"
                disabled={pending}
              >
                {pending
                  ? "正在加入队列…"
                  : `开始匹配 · ${partySize === 4 ? "4 人乱斗" : "1v1"} · BO${bestOf}`}
                {pending ? (
                  <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <LightningIcon />
                )}
              </Button>
            </section>
          </form>
        </Card>
      </main>
    </div>
  );
}
