import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRightIcon,
  DoorOpenIcon,
  PlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import useSWRMutation from "swr/mutation";

import { AppHeader } from "@/components/AppHeader";
import { DifficultySelector } from "@/components/DifficultySelector";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PlayerIdentity } from "@/components/PlayerIdentity";
import { OperationStatusDialog } from "@/components/OperationStatusDialog";
import { SeriesSelector } from "@/components/SeriesSelector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import {
  createRoom,
  discardRoomCredentials,
  joinRoom,
  leaveRoom,
  roomSessionErrorMessage,
  saveCredentials,
} from "@/lib/realtime";
import {
  loadRoomPreferences,
  saveRoomPreferences,
} from "@/lib/match-preferences";
import {
  RoomSubmission,
  RoomSubmissionTimeoutError,
  type RoomSubmissionSnapshot,
} from "@/lib/room-submission";
import {
  loadSoloDifficulty,
  saveSoloDifficulty,
  SOLO_DIFFICULTIES,
} from "@/lib/solo-game";
import type {
  BestOf,
  GameDifficulty,
  OpponentVisibility,
  PartySize,
} from "@/types/game";

const ROOM_NUMBER_PATTERN = /^\d{6}$/;

export function RoomEntry() {
  const navigate = useNavigate();
  const audit = import.meta.env.DEV && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("audit")
    : null;
  const navigateRef = useRef(navigate);
  const roomInputRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const submission = useRef<RoomSubmission | null>(null);
  const savedPreferences = useRef<ReturnType<
    typeof loadRoomPreferences
  >>(undefined);
  const preferencesLoaded = useRef(false);
  if (!preferencesLoaded.current) {
    savedPreferences.current = loadRoomPreferences();
    preferencesLoaded.current = true;
  }
  const identity = useAnonymousProfile();
  const profileRef = useRef(identity.profile);
  const [roomNumber, setRoomNumber] = useState("");
  const [visibility, setVisibility] =
    useState<OpponentVisibility>(
      savedPreferences.current?.visibility ?? "hidden",
    );
  const [bestOf, setBestOf] = useState<BestOf>(
    savedPreferences.current?.bestOf ?? 3,
  );
  const [difficulty, setDifficulty] =
    useState<GameDifficulty>(
      savedPreferences.current?.difficulty ?? loadSoloDifficulty(),
    );
  const [maxPlayers, setMaxPlayers] = useState<PartySize>(
    savedPreferences.current?.maxPlayers ?? 4,
  );
  const [joinError, setJoinError] = useState("");
  const [createError, setCreateError] = useState(
    audit === "room-error"
      ? "创建房间失败，请检查网络后重试。"
      : "",
  );
  const [submittedSettings, setSubmittedSettings] =
    useState<Readonly<RoomSubmissionSnapshot> | null>(() =>
      audit === "room-submitting"
        ? {
            kind: "create",
            identityId: identity.player.id,
            identityNickname: identity.player.nickname,
            visibility,
            maxPlayers,
            bestOf,
            difficulty,
          }
        : null,
    );
  const { trigger: triggerRoomSubmission, isMutating } = useSWRMutation(
    ["room-session-command", identity.profile.anonymousId],
    async (
      _key,
      { arg }: { arg: RoomSubmissionSnapshot },
    ) => {
      await submission.current?.submit(arg);
    },
  );
  const pending: "join" | "create" | null =
    audit === "room-submitting"
      ? "create"
      : isMutating
        ? submittedSettings?.kind ?? null
        : null;
  navigateRef.current = navigate;
  profileRef.current = identity.profile;

  useLayoutEffect(() => {
    const current = new RoomSubmission({
      request: (snapshot, signal) =>
        snapshot.kind === "join"
          ? joinRoom(
              `CS-${snapshot.roomNumber}`,
              snapshot.identityId,
              signal,
              profileRef.current,
            )
          : createRoom(
              snapshot.identityId,
              snapshot.visibility,
              snapshot.maxPlayers,
              snapshot.bestOf,
              snapshot.difficulty,
              signal,
              profileRef.current,
            ),
      persist: (response) => {
        saveCredentials(response, "room");
      },
      commit: () => {
        navigateRef.current("/play/room", { replace: true });
      },
      compensate: leaveRoom,
      discard: discardRoomCredentials,
      onPending: (_value, snapshot) => {
        if (snapshot) setSubmittedSettings(snapshot);
      },
      onError: (caught, snapshot) => {
        const message =
          caught instanceof RoomSubmissionTimeoutError
            ? caught.message
            : roomSessionErrorMessage(caught, snapshot.kind);
        if (snapshot.kind === "join") {
          setJoinError(message);
        } else {
          setCreateError(message);
        }
      },
    });
    submission.current = current;
    return () => {
      current.dispose();
      if (submission.current === current) {
        submission.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (audit === "room-error") return;
    setJoinError("");
    setCreateError("");
  }, [
    audit,
    identity.player.id,
    visibility,
    bestOf,
    difficulty,
    maxPlayers,
  ]);

  useEffect(() => {
    saveRoomPreferences({
      visibility,
      maxPlayers,
      bestOf,
      difficulty,
    });
  }, [bestOf, difficulty, maxPlayers, visibility]);

  function handleRoomCodeChange(value: string) {
    setRoomNumber(value.replace(/\D/g, "").slice(0, 6));
    if (joinError) setJoinError("");
  }

  function dismissJoinError() {
    setJoinError("");
    queueMicrotask(() =>
      roomInputRef.current?.focus({ preventScroll: true }),
    );
  }

  function dismissCreateError() {
    setCreateError("");
    queueMicrotask(() =>
      createButtonRef.current?.focus({ preventScroll: true }),
    );
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ROOM_NUMBER_PATTERN.test(roomNumber)) {
      setJoinError("请输入 6 位房间号");
      roomInputRef.current?.focus({ preventScroll: true });
      return;
    }

    setJoinError("");
    setCreateError("");
    await triggerRoomSubmission({
      kind: "join",
      identityId: identity.player.id,
      identityNickname: identity.player.nickname,
      roomNumber,
    });
  }

  async function handleCreate() {
    setJoinError("");
    setCreateError("");
    saveRoomPreferences({
      visibility,
      maxPlayers,
      bestOf,
      difficulty,
    });
    await triggerRoomSubmission({
      kind: "create",
      identityId: identity.player.id,
      identityNickname: identity.player.nickname,
      visibility,
      maxPlayers,
      bestOf,
      difficulty,
    });
  }

  function chooseDifficulty(nextDifficulty: GameDifficulty) {
    setDifficulty(nextDifficulty);
    saveSoloDifficulty(nextDifficulty);
  }

  const difficultyLabel =
    SOLO_DIFFICULTIES.find((option) => option.id === difficulty)?.label ??
    "简单";
  const pendingSummary =
    pending && submittedSettings
      ? submittedSettings.kind === "join"
        ? `正在以 ${submittedSettings.identityNickname} 加入 CS-${submittedSettings.roomNumber}`
        : `正在以 ${submittedSettings.identityNickname} 创建 ${submittedSettings.maxPlayers} 人 · ${
            SOLO_DIFFICULTIES.find(
              (option) => option.id === submittedSettings.difficulty,
            )?.label ?? "简单"
          } · BO${submittedSettings.bestOf} · ${
            submittedSettings.visibility === "hidden"
              ? "隐藏猜测"
              : "明牌模式"
          }`
      : "";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader subtitle="好友房间" backToLobby />

      <main className="app-main">
        <PageIntro eyebrow="Friend Room" title="加入或创建好友房间" />

        <div
          className="app-section-stack app-section-offset"
          data-layout="room-journey"
        >
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

          <Card
            className="gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
            data-layout="join-room"
          >
            <form
              className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(14rem,0.36fr)_minmax(0,1fr)] lg:items-end lg:gap-8"
              onSubmit={handleJoin}
              noValidate
              aria-busy={pending !== null}
            >
              <div className="flex min-w-0 items-center gap-3 lg:min-h-12">
                <DoorOpenIcon
                  className="size-7 shrink-0 text-primary"
                  weight="light"
                />
                <h2 className="text-xl font-semibold">加入房间</h2>
                <InfoTip label="加入房间说明" side="right" className="size-10">
                  输入好友分享的 6 位房间号。凭证只保存在当前标签页。
                </InfoTip>
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="room-code"
                  className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground"
                >
                  房间号
                </label>
                <div className="mt-2 flex">
                  <span className="flex h-12 items-center border border-r-0 border-foreground/30 bg-muted/50 px-3 font-mono text-sm text-muted-foreground">
                    CS-
                  </span>
                  <Input
                    ref={roomInputRef}
                    id="room-code"
                    name="roomCode"
                    value={roomNumber}
                    onChange={(event) => handleRoomCodeChange(event.target.value)}
                    placeholder="输入 6 位房间号"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="off"
                    disabled={pending !== null}
                    aria-invalid={Boolean(joinError)}
                    className="app-control h-12 rounded-none border-foreground/30 font-mono text-base tracking-[0.12em] focus-visible:z-10"
                  />
                  <Button
                    type="submit"
                    className="app-control h-12 shrink-0 gap-2 rounded-none border-foreground/30 px-4"
                    disabled={pending !== null}
                  >
                    {pending === "join" ? (
                      <Spinner role="presentation" aria-hidden="true" />
                    ) : (
                      <DoorOpenIcon />
                    )}
                    <span>{pending === "join" ? "加入中…" : "加入"}</span>
                    {pending === "join" ? null : (
                      <ArrowRightIcon className="hidden sm:block" />
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          <Card
            className="gap-0 rounded-none border border-foreground/25 bg-transparent py-0 shadow-none ring-0"
            data-layout="create-room"
          >
            <section
              className="grid gap-5 p-5 sm:gap-6 sm:p-6"
              aria-busy={pending !== null}
            >
              <div className="flex min-w-0 items-center gap-3">
                <UsersThreeIcon
                  className="size-7 shrink-0 text-primary"
                  weight="light"
                />
                <h2 className="text-xl font-semibold">创建新房间</h2>
                <InfoTip label="创建房间说明" side="right" className="size-10">
                  创建后会生成房间号，人数、题库和赛制在本房间内固定。
                </InfoTip>
              </div>

              <div className="grid gap-5 sm:gap-6 lg:grid-cols-12 lg:items-start">
                <div className="lg:col-span-3">
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    对手猜测
                  </p>
                  <div
                    className="mt-2 flex border border-foreground/25"
                    role="group"
                    aria-label="对手猜测显示方式"
                  >
                    {(["hidden", "open"] as const).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={visibility === option ? "default" : "ghost"}
                        aria-pressed={visibility === option}
                        disabled={pending !== null}
                        className="h-11 min-w-0 flex-1 rounded-none border-r border-foreground/20 px-2 last:border-r-0"
                        onClick={() => setVisibility(option)}
                      >
                        {option === "hidden" ? "隐藏猜测" : "明牌模式"}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    房间人数
                  </p>
                  <div
                    className="mt-2 grid min-h-11 grid-cols-2 border border-foreground/25"
                    role="group"
                    aria-label="房间人数"
                  >
                    {([2, 4] as const).map((size) => (
                      <Button
                        key={size}
                        type="button"
                        variant={maxPlayers === size ? "default" : "ghost"}
                        aria-pressed={maxPlayers === size}
                        disabled={pending !== null}
                        className="h-11 min-w-0 rounded-none border-r border-foreground/20 font-mono text-xs last:border-r-0"
                        onClick={() => setMaxPlayers(size)}
                      >
                        {size} 人
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="lg:col-span-6">
                  <p className="mb-3 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    题库难度
                  </p>
                  <DifficultySelector
                    value={difficulty}
                    onChange={chooseDifficulty}
                    disabled={pending !== null}
                  />
                </div>

                <div className="lg:col-span-6">
                  <p className="mb-3 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    房间赛制
                  </p>
                  <SeriesSelector
                    value={bestOf}
                    onChange={setBestOf}
                    compact
                    disabled={pending !== null}
                  />
                </div>

                <div className="lg:col-span-6">
                  <p className="mb-3 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    创建并进入等待
                  </p>
                  <Button
                    ref={createButtonRef}
                    data-testid="create-room-button"
                    type="button"
                    className="app-control h-12 w-full justify-between rounded-none border-foreground/30"
                    onClick={handleCreate}
                    disabled={pending !== null}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <PlusIcon className="shrink-0" />
                      <span className="truncate">
                        {pending === "create"
                          ? "创建中…"
                          : `创建房间 · ${maxPlayers} 人 · ${difficultyLabel} · BO${bestOf}`}
                      </span>
                    </span>
                    {pending === "create" ? (
                      <Spinner
                        className="shrink-0"
                        role="presentation"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRightIcon className="shrink-0" />
                    )}
                  </Button>
                </div>
              </div>
            </section>
          </Card>
        </div>
      </main>
      <OperationStatusDialog
        open={pending !== null}
        kind="progress"
        eyebrow="FRIEND ROOM"
        title={pending === "join" ? "正在加入房间" : "正在创建房间"}
        description={
          pendingSummary ??
          "正在向服务器确认房间设置，完成后会自动进入等待页面。"
        }
      />
      <OperationStatusDialog
        open={Boolean(joinError)}
        kind="error"
        eyebrow="FRIEND ROOM"
        title="未能加入房间"
        description={joinError}
        returnFocusRef={roomInputRef}
        onOpenChange={(open) => {
          if (!open) dismissJoinError();
        }}
      >
        <Button
          type="button"
          className="w-full rounded-none sm:w-auto"
          onClick={dismissJoinError}
        >
          检查房间号
        </Button>
      </OperationStatusDialog>
      <OperationStatusDialog
        open={Boolean(createError)}
        kind="error"
        eyebrow="FRIEND ROOM"
        title="未能创建房间"
        description={createError}
        returnFocusRef={createButtonRef}
        onOpenChange={(open) => {
          if (!open) dismissCreateError();
        }}
      >
        <Button
          type="button"
          className="w-full rounded-none sm:w-auto"
          onClick={dismissCreateError}
        >
          返回设置
        </Button>
      </OperationStatusDialog>
    </div>
  );
}
