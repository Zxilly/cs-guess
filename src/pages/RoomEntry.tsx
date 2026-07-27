import { useState, type FormEvent } from "react";
import {
  ArrowRightIcon,
  DoorOpenIcon,
  PlusIcon,
  SpinnerGapIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { SeriesSelector } from "@/components/SeriesSelector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import {
  ApiError,
  createRoom,
  joinRoom,
  saveCredentials,
} from "@/lib/realtime";
import type { BestOf, OpponentVisibility } from "@/types/game";

const ROOM_NUMBER_PATTERN = /^\d{6}$/;

export function RoomEntry() {
  const navigate = useNavigate();
  const identity = useAnonymousProfile();
  const [roomNumber, setRoomNumber] = useState("");
  const [visibility, setVisibility] =
    useState<OpponentVisibility>("hidden");
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [joinError, setJoinError] = useState("");
  const [createError, setCreateError] = useState("");
  const [pending, setPending] = useState<"join" | "create" | null>(null);

  function handleRoomCodeChange(value: string) {
    setRoomNumber(value.replace(/\D/g, "").slice(0, 6));
    if (joinError) setJoinError("");
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ROOM_NUMBER_PATTERN.test(roomNumber)) {
      setJoinError("请输入 6 位房间号");
      return;
    }

    setPending("join");
    setJoinError("");
    try {
      const response = await joinRoom(
        `CS-${roomNumber}`,
        identity.player.id,
      );
      saveCredentials(response, "room");
      navigate("/play/room");
    } catch (caught) {
      setJoinError(
        caught instanceof ApiError
          ? caught.message
          : "加入房间失败，请稍后重试。",
      );
    } finally {
      setPending(null);
    }
  }

  async function handleCreate() {
    setPending("create");
    setCreateError("");
    try {
      const response = await createRoom(
        identity.player.id,
        visibility,
        8,
        bestOf,
      );
      saveCredentials(response, "room");
      navigate("/play/room");
    } catch (caught) {
      setCreateError(
        caught instanceof ApiError
          ? caught.message
          : "创建房间失败，请稍后重试。",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader subtitle="好友房间" backToLobby />

      <main className="app-main">
        <PageIntro eyebrow="Friend Room" title="和朋友一起猜" />

        <div className="mt-8 grid gap-5">
          <PlayerIdentity
            player={identity.player}
            stats={identity.profile.stats}
            drawCredits={identity.profile.drawCredits}
            lossesTowardCredit={identity.profile.lossesTowardCredit}
            winRate={identity.winRate}
            currentPool={identity.currentPool}
            manageHref="/identity?return=%2Froom"
            disabled={pending !== null}
            compact
          />

          <Card className="grid gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0 md:grid-cols-2">
          <section className="border-b border-foreground/20 p-6 sm:p-8 md:border-r md:border-b-0">
            <DoorOpenIcon className="size-8 text-primary" weight="light" />
            <div className="mt-6 flex items-center gap-1">
              <h2 className="text-xl font-semibold">加入房间</h2>
              <InfoTip label="加入房间说明" side="right" className="size-10">
                输入好友分享的 6 位房间号。凭证只保存在当前标签页。
              </InfoTip>
            </div>

            <form className="mt-7" onSubmit={handleJoin} noValidate>
              <label
                htmlFor="room-code"
                className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
              >
                房间号
              </label>
              <div className="mt-2 flex">
                <span className="flex h-12 items-center border border-r-0 border-foreground/30 bg-muted/50 px-3 font-mono text-sm text-muted-foreground">
                  CS-
                </span>
                <Input
                  id="room-code"
                  name="roomCode"
                  value={roomNumber}
                  onChange={(event) => handleRoomCodeChange(event.target.value)}
                  placeholder="207207"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="off"
                  aria-invalid={Boolean(joinError)}
                  aria-describedby={
                    joinError ? "room-code-error" : undefined
                  }
                  className="h-12 rounded-none border-foreground/30 font-mono text-base tracking-[0.12em] focus-visible:z-10"
                />
                <Button
                  type="submit"
                  className="h-12 rounded-none px-4"
                  aria-label="加入房间"
                  disabled={pending !== null}
                >
                  {pending === "join" ? (
                    <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <ArrowRightIcon />
                  )}
                  {pending === "join" ? "加入中…" : "加入"}
                </Button>
              </div>
              {joinError ? (
                <p
                  id="room-code-error"
                  className="mt-2 text-xs text-destructive"
                  role="alert"
                >
                  {joinError}
                </p>
              ) : null}
            </form>
          </section>

          <section className="flex flex-col justify-between p-6 sm:p-8">
            <div>
              <UsersThreeIcon className="size-8 text-primary" weight="light" />
              <div className="mt-6 flex items-center gap-1">
                <h2 className="text-xl font-semibold">创建新房间</h2>
                <InfoTip label="创建房间说明" side="right" className="size-10">
                  创建后会生成房间号，可邀请 2–8 位朋友加入。
                </InfoTip>
              </div>
              <div
                className="mt-5 inline-flex border border-foreground/25"
                role="group"
                aria-label="对手猜测显示方式"
              >
                {(["hidden", "open"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={visibility === option ? "default" : "ghost"}
                    aria-pressed={visibility === option}
                    className="rounded-none border-r border-foreground/20 last:border-r-0"
                    onClick={() => setVisibility(option)}
                  >
                    {option === "hidden" ? "隐藏猜测" : "明牌模式"}
                  </Button>
                ))}
              </div>
              <div className="mt-6">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  房间赛制
                </p>
                <SeriesSelector
                  value={bestOf}
                  onChange={setBestOf}
                  compact
                  disabled={pending !== null}
                />
              </div>
            </div>
            <Button
              type="button"
              className="mt-8 h-12 justify-between rounded-none border-foreground/30"
              onClick={handleCreate}
              disabled={pending !== null}
            >
              <span className="inline-flex items-center gap-2">
                <PlusIcon />
                {pending === "create" ? "创建中…" : `创建 BO${bestOf} 房间`}
              </span>
              {pending === "create" ? (
                <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowRightIcon />
              )}
            </Button>
            {createError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {createError}
              </p>
            ) : null}
          </section>
          </Card>
        </div>
      </main>
    </div>
  );
}
