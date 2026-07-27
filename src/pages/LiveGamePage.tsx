import { useCallback, useEffect, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  PlugsConnectedIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router";

import { BattleContext } from "@/components/BattleContext";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { ModeSidebar } from "@/components/ModeSidebar";
import { PlayerRoleLabel } from "@/components/PlayerRoleLabel";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Timer } from "@/components/Timer";
import { Button } from "@/components/ui/button";
import { players } from "@/data/players";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useRealtimeRoom } from "@/hooks/use-realtime-room";
import {
  clearCredentials,
  loadCredentials,
  readNumber,
  readRecord,
  readRecords,
  readString,
} from "@/lib/realtime";
import { currentRoundHistory } from "@/lib/live-round";
import { countryNameZh } from "@/lib/country-geography";
import {
  MAX_GUESSES,
  type CountryHint,
  type CountryRelation,
  type GameMode,
  type OpponentGuessProgress,
  type OpponentVisibility,
} from "@/types/game";

interface LiveGamePageProps {
  mode: Extract<GameMode, "quick" | "room">;
}

interface PlayerView {
  playerId: string;
  displayName: string;
  connected: boolean;
  guessCount: number;
  score: number;
}

function toPlayerView(source: Record<string, unknown>): PlayerView | null {
  const playerId = readString(source, "player_id");
  if (!playerId) return null;
  return {
    playerId,
    displayName: readString(source, "display_name") ?? "玩家",
    connected: source.connected !== false,
    guessCount: readNumber(source, "guess_count") ?? 0,
    score: readNumber(source, "score") ?? 0,
  };
}

function matchedFields(event: Record<string, unknown>) {
  return Array.isArray(event.matched_fields)
    ? event.matched_fields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];
}

function countryHint(event: Record<string, unknown>): CountryHint {
  const value = readString(event, "country_relation");
  const relation: CountryRelation =
    value === "match" || value === "near" || value === "miss"
      ? value
      : matchedFields(event).includes("nationality")
        ? "match"
        : "miss";
  return {
    relation,
    distanceKm: readNumber(event, "country_distance_km") ?? null,
  };
}

function connectionCopy(connection: string) {
  switch (connection) {
    case "connected":
      return "实时连接正常";
    case "reconnecting":
      return "连接中断，正在重连";
    case "offline":
      return "实时连接不可用";
    case "closed":
      return "连接已关闭";
    default:
      return "正在连接对战服务器";
  }
}

export function LiveGamePage({ mode }: LiveGamePageProps) {
  const navigate = useNavigate();
  const { recordRound } = useAnonymousProfile();
  const [session] = useState(() => loadCredentials(mode));
  const [selectedId, setSelectedId] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [dismissedCelebration, setDismissedCelebration] = useState("");
  const realtime = useRealtimeRoom(
    session?.credentials ?? null,
    session?.snapshot,
  );

  const snapshot = realtime.snapshot;
  const snapshotSeq = readNumber(snapshot, "seq") ?? -1;
  const currentEvents = realtime.events.filter(
    (event) => (event.seq ?? Number.MAX_SAFE_INTEGER) > snapshotSeq,
  );
  const selfPlayerId =
    readString(snapshot, "self_player_id") ??
    session?.credentials.playerId ??
    "";
  const hostPlayerId = readString(snapshot, "host_player_id") ?? "";
  const roomCode =
    readString(snapshot, "room_code") ??
    session?.credentials.roomCode ??
    "—";

  const playersInRoom = (() => {
    const byId = new Map<string, PlayerView>();
    for (const source of readRecords(snapshot, "players")) {
      const player = toPlayerView(source);
      if (player) byId.set(player.playerId, player);
    }
    for (const event of currentEvents) {
      if (event.type === "player_joined") {
        const player = toPlayerView(readRecord(event, "player") ?? {});
        if (player) byId.set(player.playerId, player);
      }
      if (event.type === "player_connection") {
        const playerId = readString(event, "player_id");
        const player = playerId ? byId.get(playerId) : undefined;
        if (player) {
          byId.set(player.playerId, {
            ...player,
            connected: event.connected === true,
          });
        }
      }
      if (event.type === "opponent_progress") {
        const playerId = readString(event, "player_id");
        const player = playerId ? byId.get(playerId) : undefined;
        if (player) {
          byId.set(player.playerId, {
            ...player,
            guessCount:
              readNumber(event, "guess_number") ?? player.guessCount,
          });
        }
      }
      if (event.type === "round_started") {
        for (const player of byId.values()) {
          byId.set(player.playerId, { ...player, guessCount: 0 });
        }
      }
      if (event.type === "round_finished") {
        for (const score of readRecords(event, "scores")) {
          const playerId = readString(score, "player_id");
          const player = playerId ? byId.get(playerId) : undefined;
          if (player) {
            byId.set(player.playerId, {
              ...player,
              score: readNumber(score, "score") ?? player.score,
            });
          }
        }
      }
    }
    return [...byId.values()];
  })();

  let phase = readString(snapshot, "phase") ?? "waiting";
  let visibility = (readString(snapshot, "visibility") ??
    "hidden") as OpponentVisibility;
  let deadline = readNumber(snapshot, "deadline_unix_ms");
  let winnerPlayerId = readString(snapshot, "winner_player_id");
  let seriesWinnerPlayerId = readString(
    snapshot,
    "series_winner_player_id",
  );
  let mysteryId = readString(snapshot, "mystery_id");
  const bestOf = readNumber(snapshot, "best_of") ?? 3;
  let roundNumber = readNumber(snapshot, "round_number") ?? 1;
  let nextRoundAt = readNumber(snapshot, "next_round_unix_ms");
  for (const event of currentEvents) {
    if (event.type === "round_started") {
      phase = "playing";
      deadline = readNumber(event, "deadline_unix_ms");
      roundNumber = readNumber(event, "round_number") ?? roundNumber + 1;
      winnerPlayerId = undefined;
      mysteryId = undefined;
      nextRoundAt = undefined;
    }
    if (event.type === "visibility_changed") {
      visibility =
        (readString(event, "visibility") as OpponentVisibility) ?? visibility;
    }
    if (event.type === "round_finished") {
      phase = "finished";
      deadline = undefined;
      winnerPlayerId = readString(event, "winner_player_id");
      seriesWinnerPlayerId = readString(
        event,
        "series_winner_player_id",
      );
      roundNumber = readNumber(event, "round_number") ?? roundNumber;
      nextRoundAt = readNumber(event, "next_round_unix_ms");
      mysteryId = readString(event, "mystery_id");
    }
  }

  const { ownGuessEvents, opponentEvents } = currentRoundHistory(
    snapshot,
    currentEvents,
  );
  const ownGuesses = ownGuessEvents.flatMap((event) => {
    const guessedId = readString(event, "player_id");
    return players.filter((player) => player.id === guessedId);
  });
  const ownMatchedFields = ownGuessEvents.map(matchedFields);
  const ownCountryHints = ownGuessEvents.map(countryHint);
  const opponentProgress: OpponentGuessProgress[] = opponentEvents.map(
    (event) => ({
      playerId: readString(event, "player_id"),
      guessedPlayerId: readString(event, "guessed_player_id") ?? null,
      matchedFields: matchedFields(event),
      countryRelation: countryHint(event).relation,
      countryDistanceKm: readNumber(event, "country_distance_km") ?? null,
    }),
  );
  const opponentGuesses = opponentProgress.flatMap((progress) =>
    players.filter((player) => player.id === progress.guessedPlayerId),
  );

  const maxPlayers = readNumber(snapshot, "max_players") ?? 2;
  const selfPlayer = playersInRoom.find(
    (player) => player.playerId === selfPlayerId,
  );
  const opponentPlayers = playersInRoom.filter(
    (player) => player.playerId !== selfPlayerId,
  );
  const opponentPlayer = opponentPlayers[0];
  const opponentBoards = opponentPlayers.map((player) => ({
    id: player.playerId,
    name: player.displayName,
    progress: opponentProgress.filter(
      (progress) => progress.playerId === player.playerId,
    ),
  }));
  const selfGuessCount = Math.max(
    selfPlayer?.guessCount ?? 0,
    ownGuesses.length,
  );
  const opponentGuessCount = Math.max(
    opponentPlayer?.guessCount ?? 0,
    opponentBoards[0]?.progress.length ?? 0,
  );
  const maxGuesses =
    readNumber(snapshot, "max_guesses") ?? MAX_GUESSES;
  const mysteryPlayer =
    players.find((player) => player.id === mysteryId) ?? players[0];
  const answerDetails = [
    ["选手", mysteryPlayer.nickname],
    ["战队", mysteryPlayer.team],
    ["国籍", countryNameZh(mysteryPlayer.countryCode)],
    ["年龄", mysteryPlayer.age],
    [
      "位置",
      <PlayerRoleLabel key="role" role={mysteryPlayer.role} />,
    ],
  ] as const;
  const availablePlayers = players.filter(
    (player) => !ownGuesses.some((guess) => guess.id === player.id),
  );
  const selectedPlayer = players.find((player) => player.id === selectedId);
  const secondsLeft = deadline
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : 0;
  const nextRoundSeconds = nextRoundAt
    ? Math.max(0, Math.ceil((nextRoundAt - now) / 1000))
    : undefined;
  const isHost = selfPlayerId === hostPlayerId;
  const connected = realtime.connection === "connected";
  const canGuess = connected && phase === "playing" && selfGuessCount < maxGuesses;
  const revealAnswer = phase === "finished" && Boolean(mysteryId);
  const selfScore = selfPlayer?.score ?? 0;
  const opponentScore = opponentPlayer?.score ?? 0;
  const battleParticipants = playersInRoom.map((player) => ({
    playerId: player.playerId,
    name: player.displayName,
    connected: player.connected,
    guesses: Math.max(
      player.guessCount,
      player.playerId === selfPlayerId
        ? ownGuesses.length
        : opponentProgress.filter(
            (progress) => progress.playerId === player.playerId,
          ).length,
    ),
    score: player.score,
    self: player.playerId === selfPlayerId,
  }));
  const celebrationKey = `${roundNumber}:${winnerPlayerId ?? "draw"}:${seriesWinnerPlayerId ?? "ongoing"}`;
  const showCelebration =
    phase === "finished" && dismissedCelebration !== celebrationKey;
  const resultOutcome =
    winnerPlayerId === selfPlayerId
      ? "win"
      : winnerPlayerId
        ? "loss"
        : "draw";
  const dismissCelebration = useCallback(
    () => setDismissedCelebration(celebrationKey),
    [celebrationKey],
  );

  useEffect(() => {
    if (
      (!deadline || phase !== "playing") &&
      (!nextRoundAt || phase !== "finished")
    ) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline, nextRoundAt, phase]);

  useEffect(() => {
    if (phase !== "finished" || !selfPlayerId || roomCode === "—") return;
    recordRound(
      `${roomCode}:R${roundNumber}`,
      winnerPlayerId === selfPlayerId
        ? "win"
        : winnerPlayerId
          ? "loss"
          : "draw",
      {
        mode,
        roomCode,
        roundNumber,
        bestOf,
        answerId: mysteryId,
        guessIds: ownGuesses.map((guess) => guess.id),
        opponentNames: opponentPlayers.map((player) => player.displayName),
        selfScore,
        opponentScore: Math.max(
          0,
          ...opponentPlayers.map((player) => player.score),
        ),
      },
    );
  }, [
    bestOf,
    mysteryId,
    mode,
    opponentPlayers,
    ownGuesses,
    phase,
    recordRound,
    roomCode,
    roundNumber,
    selfScore,
    selfPlayerId,
    winnerPlayerId,
  ]);

  function exitSeries() {
    clearCredentials();
    navigate("/", { replace: true });
  }

  function submitGuess() {
    if (!selectedId || !canGuess) return;
    if (realtime.send("guess", { player_id: selectedId })) {
      setSelectedId(undefined);
      setSearchOpen(false);
    }
  }

  function changeVisibility(next: OpponentVisibility) {
    realtime.send("set_visibility", { visibility: next });
  }

  const content =
    mode === "quick"
      ? {
          eyebrow: maxPlayers === 4 ? "4 人乱斗" : "实时 1v1",
          title:
            phase === "waiting"
              ? maxPlayers === 4
                ? "等待四位玩家就位。"
                : "等待对手加入。"
              : phase === "finished"
                ? "本局已经揭晓。"
                : maxPlayers === 4
                  ? "四人同题，抢先锁定答案。"
                  : "抢先锁定答案。",
          description:
            maxPlayers === 4
              ? "四位玩家共享题目，所有对手的命中进度都会实时同步。"
              : "服务器裁定倒计时、猜测结果与胜负。",
        }
      : {
          eyebrow: "好友房间",
          title:
            phase === "waiting"
              ? "等待玩家准备。"
              : phase === "finished"
                ? "查看本局结果。"
                : "和朋友同题竞速。",
          description: "房主开始回合，服务器为所有玩家同步同一题目。",
        };

  return (
    <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <ModeSidebar
        mode={mode}
        secondsLeft={secondsLeft}
        guesses={selfGuessCount}
        maxGuesses={maxGuesses}
        status={
          phase === "waiting"
            ? "waiting"
            : phase === "playing"
              ? "playing"
              : resultOutcome === "win"
                ? "won"
                : resultOutcome === "loss"
                  ? "lost"
                  : "draw"
        }
        roundNumber={roundNumber}
        bestOf={bestOf}
        modeLabel={
          mode === "quick" && maxPlayers === 4 ? "4 人乱斗" : undefined
        }
        onExit={clearCredentials}
      />

      <main className="min-w-0">
        <div className="app-game-container app-game-container-live min-w-0">
          <header className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
                  {content.eyebrow}
                </p>
                <InfoTip label={`${content.eyebrow}规则`} side="right">
                  {content.description}
                </InfoTip>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                {content.title}
              </h1>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.08em]">
                ROOM · {roomCode}
              </p>
              <p
                className={`mt-2 inline-flex items-center gap-1.5 text-xs ${
                  connected ? "text-primary" : "text-destructive"
                }`}
              >
                {connected ? <PlugsConnectedIcon /> : <WarningCircleIcon />}
                {connectionCopy(realtime.connection)}
              </p>
            </div>
          </header>

          {realtime.error ? (
            <div
              className="mb-5 flex flex-col justify-between gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center"
              role="alert"
            >
              <span>{realtime.error}</span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none"
                onClick={realtime.retry}
              >
                立即重连
              </Button>
            </div>
          ) : null}

          <div className="mb-5 flex items-center justify-between border-y border-foreground/15 py-3 lg:hidden">
            <span className="text-xs text-muted-foreground">
              {phase === "playing" ? "剩余时间" : "回合状态"}
            </span>
            {phase === "playing" ? (
              <Timer seconds={secondsLeft} className="text-lg text-primary" />
            ) : (
              <span className="font-mono text-xs font-semibold text-primary">
                {phase === "waiting"
                  ? "等待开始"
                  : resultOutcome === "win"
                    ? "本局胜利"
                    : resultOutcome === "loss"
                      ? "本局失利"
                      : "本局平局"}
              </span>
            )}
            <span className="font-mono text-xs">
              {selfGuessCount} / {maxGuesses}
            </span>
          </div>

          <BattleContext
            mode={mode}
            guesses={selfGuessCount}
            opponentGuesses={opponentGuessCount}
            maxGuesses={maxGuesses}
            roomCode={roomCode}
            isRoomHost={isHost}
            onlinePlayers={playersInRoom.filter((player) => player.connected).length}
            maxPlayers={maxPlayers}
            selfName={selfPlayer?.displayName ?? "你"}
            opponentName={opponentPlayer?.displayName ?? "等待对手"}
            connected={connected}
            opponentConnected={opponentPlayer?.connected ?? false}
            selfScore={selfScore}
            opponentScore={opponentScore}
            bestOf={bestOf}
            roundNumber={roundNumber}
            participants={
              maxPlayers === 4 || battleParticipants.length > 2
                ? battleParticipants
                : undefined
            }
          />

          {phase === "waiting" && isHost && mode === "room" ? (
            <div className="mt-5 flex justify-end">
              <Button
                className="rounded-none"
                disabled={
                  !connected ||
                  playersInRoom.filter((player) => player.connected).length < 2
                }
                onClick={() => realtime.send("start_round")}
              >
                开始本轮
              </Button>
            </div>
          ) : null}

          <div className="mt-6 min-w-0">
            <PlayerSearch
              players={availablePlayers}
              selectedPlayer={selectedPlayer}
              open={searchOpen}
              disabled={!canGuess}
              onOpenChange={setSearchOpen}
              onSelect={(playerId) => {
                setSelectedId(playerId);
                setSearchOpen(false);
              }}
              onSubmit={submitGuess}
            />
          </div>

          <div className="mt-6">
            <GuessTable
              guesses={ownGuesses}
              opponentGuesses={opponentGuesses}
              opponentProgress={opponentProgress}
              opponents={
                maxPlayers === 4 || opponentBoards.length > 1
                  ? opponentBoards
                  : undefined
              }
              opponentVisibility={visibility}
              mysteryPlayer={mysteryPlayer}
              mode={mode}
              maxGuesses={maxGuesses}
              selfName={selfPlayer?.displayName ?? "你"}
              opponentName={opponentPlayer?.displayName ?? "等待对手"}
              ownMatchedFields={ownMatchedFields}
              ownCountryHints={ownCountryHints}
              onOpponentVisibilityChange={
                mode === "room" && isHost && phase === "waiting"
                  ? changeVisibility
                  : undefined
              }
            />
          </div>

          <section className="mt-7 border border-foreground/35">
            <div className="grid min-h-28 grid-cols-[140px_1fr] sm:grid-cols-[150px_repeat(5,1fr)]">
              <div className="flex flex-col justify-center border-r border-foreground/20 px-5">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                  神秘选手
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {revealAnswer ? "服务器已揭晓" : "回合结束后揭晓"}
                </p>
              </div>
              {answerDetails.map(([label, value]) => (
                <div
                  key={label}
                  className="hidden flex-col justify-center border-r border-foreground/15 px-4 last:border-r-0 sm:flex"
                >
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 font-mono text-sm font-semibold text-primary">
                    {revealAnswer ? value : "?????"}
                  </p>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 px-5 py-4 sm:hidden">
                {revealAnswer ? (
                  answerDetails.map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs font-semibold text-primary">
                        {value}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="col-span-2 font-mono text-sm font-semibold text-primary">
                    ?????
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="mt-5 flex flex-col gap-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1">
              <span>结果图例</span>
              <InfoTip label="查看结果图例" side="right" className="size-10">
                蓝色代表完全一致，浅蓝色代表国籍同洲；国籍卡显示两国首都间的直线距离。隐藏模式不公开对手猜测的具体选手。
              </InfoTip>
            </div>
            {phase === "finished" ? (
              <div className="text-right">
                <p className="font-mono text-foreground">
                  {seriesWinnerPlayerId === selfPlayerId
                    ? "SERIES WON"
                    : seriesWinnerPlayerId
                      ? "SERIES LOST"
                      : winnerPlayerId === selfPlayerId
                        ? "ROUND WON"
                        : winnerPlayerId
                          ? "ROUND LOST"
                          : "ROUND DRAW"}
                </p>
                {!seriesWinnerPlayerId && nextRoundSeconds !== undefined ? (
                  <p className="mt-1">下一局将在 {nextRoundSeconds} 秒后开始</p>
                ) : null}
              </div>
            ) : phase === "waiting" ? (
              <p className="font-mono">WAITING FOR ROUND</p>
            ) : (
              <p className="font-mono">SERVER AUTHORITATIVE</p>
            )}
          </div>

          {phase === "finished" &&
          !seriesWinnerPlayerId &&
          isHost &&
          mode === "room" ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 rounded-none text-primary"
              onClick={() => realtime.send("start_round")}
            >
              <ArrowCounterClockwiseIcon />
              开始下一轮
            </Button>
          ) : null}

          {phase === "finished" && seriesWinnerPlayerId ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 rounded-none"
              onClick={exitSeries}
            >
              返回模式大厅
            </Button>
          ) : null}
        </div>
      </main>
      {showCelebration ? (
        <CelebrationOverlay
          outcome={resultOutcome}
          seriesComplete={Boolean(seriesWinnerPlayerId)}
          score={`${selfScore} : ${opponentScore}`}
          mysteryPlayer={mysteryPlayer}
          nextRoundSeconds={nextRoundSeconds}
          onClose={dismissCelebration}
          onExit={exitSeries}
        />
      ) : null}
    </div>
  );
}
