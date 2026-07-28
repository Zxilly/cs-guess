import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  CheckIcon,
  CopyIcon,
  PlugsConnectedIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { BattleContext } from "@/components/BattleContext";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { GuessTable } from "@/components/GuessTable";
import { InfoTip } from "@/components/InfoTip";
import { ModeSidebar } from "@/components/ModeSidebar";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerRoleLabel } from "@/components/PlayerRoleLabel";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Timer } from "@/components/Timer";
import { Button } from "@/components/ui/button";
import { players } from "@/data/players";
import { useAnonymousProfile } from "@/hooks/use-anonymous-profile";
import { useRealtimeRoom } from "@/hooks/use-realtime-room";
import {
  clearCredentialsIfMatches,
  clearClosingIntentIfMatches,
  isAuthoritativeRoomSnapshot,
  isTerminalSessionError,
  leaveQuickMatch,
  leaveRoom,
  loadClosingIntent,
  loadCredentials,
  readNumber,
  readRecord,
  readRecords,
  readString,
  realtimeCredentialsMatch,
  saveClosingIntent,
} from "@/lib/realtime";
import {
  copyRoomCode,
  friendRoomSettings,
  friendRoomStartDisabledReason,
} from "@/lib/friend-room";
import { currentRoundHistory } from "@/lib/live-round";
import {
  competitionRankLabels,
  disconnectSecondsByPlayerId,
  playerPresenceLabel,
  quickRematchPath,
} from "@/lib/live-presence";
import { countryNameZh } from "@/lib/country-geography";
import {
  markBattleResultViewed,
  wasBattleResultViewed,
} from "@/lib/battle-result-dismissal";
import {
  clearLiveGuessDraft,
  clearLiveGuessDraftsForRoom,
  loadLiveGuessDraft,
  saveLiveGuessDraft,
} from "@/lib/live-guess-draft";
import {
  parseSoloDifficulty,
  SOLO_DIFFICULTIES,
} from "@/lib/solo-game";
import {
  MAX_GUESSES,
  type BattleFinishReason,
  type BattleSeriesFinishReason,
  type BattleSeriesStatus,
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
  seatIndex: number;
  displayName: string;
  connected: boolean;
  forfeitedThisRound: boolean;
  guessCount: number;
  score: number;
  disconnectDeadline: number | null;
}

interface RoundResult {
  roundNumber: number;
  mysteryId: string;
  finishReason?: BattleFinishReason;
  winnerPlayerId?: string;
  standings: Array<{
    playerId: string;
    displayName: string;
    seatIndex: number;
    score: number;
    rank: number;
  }>;
}

function toPlayerView(source: Record<string, unknown>): PlayerView | null {
  const playerId = readString(source, "player_id");
  if (!playerId) return null;
  return {
    playerId,
    seatIndex: readNumber(source, "seat_index") ?? Number.MAX_SAFE_INTEGER,
    displayName: readString(source, "display_name") ?? "玩家",
    connected: source.connected !== false,
    forfeitedThisRound: source.forfeited_this_round === true,
    guessCount: readNumber(source, "guess_count") ?? 0,
    score: readNumber(source, "score") ?? 0,
    disconnectDeadline:
      readNumber(source, "disconnect_deadline_unix_ms") ?? null,
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
      return "正在连接";
  }
}

function readFinishReason(
  source: Record<string, unknown>,
): BattleFinishReason | undefined {
  const value = readString(source, "finish_reason");
  return value === "solved" ||
    value === "disconnect_forfeit" ||
    value === "member_left" ||
    value === "timeout" ||
    value === "max_guesses"
    ? value
    : undefined;
}

function readSeriesStatus(
  source: Record<string, unknown>,
): BattleSeriesStatus {
  const value = readString(source, "series_status");
  return value === "completed" || value === "abandoned"
    ? value
    : "active";
}

function readSeriesFinishReason(
  source: Record<string, unknown>,
): BattleSeriesFinishReason | undefined {
  const value = readString(source, "series_finish_reason");
  return value === "score_limit" ||
    value === "member_left_forfeit" ||
    value === "member_left_abandoned"
    ? value
    : undefined;
}

function readRoundResults(source: Record<string, unknown>): RoundResult[] {
  return readRecords(source, "round_results").flatMap((result) => {
    const roundNumber = readNumber(result, "round_number");
    const mysteryId = readString(result, "mystery_id");
    if (roundNumber === undefined || !mysteryId) return [];
    return [{
      roundNumber,
      mysteryId,
      finishReason: readFinishReason(result),
      winnerPlayerId: readString(result, "winner_player_id"),
      standings: readRecords(result, "standings")
        .flatMap((standing) => {
          const playerId = readString(standing, "player_id");
          if (!playerId) return [];
          return [{
            playerId,
            displayName:
              readString(standing, "display_name") ?? "玩家",
            seatIndex:
              readNumber(standing, "seat_index") ?? Number.MAX_SAFE_INTEGER,
            score: readNumber(standing, "score") ?? 0,
            rank: readNumber(standing, "rank") ?? 0,
          }];
        })
        .sort((left, right) => left.seatIndex - right.seatIndex),
    }];
  });
}

function finishReasonLabel(reason?: BattleFinishReason) {
  switch (reason) {
    case "solved":
      return "猜中答案";
    case "disconnect_forfeit":
      return "断线判负";
    case "member_left":
      return "成员离开";
    case "timeout":
      return "时间结束";
    case "max_guesses":
      return "次数用尽";
    default:
      return "回合结束";
  }
}

export function LiveGamePage({ mode }: LiveGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { recordRound } = useAnonymousProfile();
  const [session] = useState(() => loadCredentials(mode));
  const [closingIntent, setClosingIntent] = useState(() =>
    session ? loadClosingIntent(session.credentials) : null,
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [searchQuery, setSearchQuery] = useState("");
  const [hydratedDraftScope, setHydratedDraftScope] = useState("");
  const [guessPending, setGuessPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [dismissedCelebration, setDismissedCelebration] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [leaveError, setLeaveError] = useState("");
  const [startPending, setStartPending] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const resultTitleRef = useRef<HTMLHeadingElement | null>(null);
  const closingTitleRef = useRef<HTMLHeadingElement | null>(null);
  const recoveryTitleRef = useRef<HTMLHeadingElement | null>(null);
  const resultDialogExitRef = useRef(false);
  const entryFocusCompleteRef = useRef(false);
  const recoveryVisibleRef = useRef(false);
  const leavePendingRef = useRef(false);
  const mountedRef = useRef(true);
  const leaveGenerationRef = useRef(0);
  const startLeaveRef = useRef<(returnTo: string) => void>(() => undefined);
  const startPendingRef = useRef(false);
  const restartPendingRef = useRef(false);
  const pendingGuessRef = useRef<{
    requestId: string | null;
    playerId: string;
    roomCode: string;
    roundNumber: number;
    settled: boolean;
    resolve: (accepted: boolean) => void;
  } | null>(null);
  const realtime = useRealtimeRoom(
    closingIntent ? null : (session?.credentials ?? null),
    closingIntent ? {} : session?.snapshot,
  );

  const snapshot = realtime.snapshot;
  const hasAuthoritativeSnapshot =
    realtime.hasAuthoritativeSnapshot ??
    isAuthoritativeRoomSnapshot(snapshot);
  const shouldFocusGameHeading =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusGameHeading" in location.state &&
    location.state.focusGameHeading === true;
  const snapshotSeq = readNumber(snapshot, "seq") ?? -1;
  const currentEvents = realtime.events.filter(
    (event) => (event.seq ?? Number.MAX_SAFE_INTEGER) > snapshotSeq,
  );
  const selfPlayerId =
    readString(snapshot, "self_player_id") ??
    session?.credentials.playerId ??
    "";
  let hostPlayerId = readString(snapshot, "host_player_id") ?? "";
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
            disconnectDeadline:
              readNumber(event, "disconnect_deadline_unix_ms") ?? null,
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
      if (event.type === "player_round_forfeited") {
        const playerId = readString(event, "player_id");
        const player = playerId ? byId.get(playerId) : undefined;
        if (player) {
          byId.set(player.playerId, {
            ...player,
            forfeitedThisRound: true,
            disconnectDeadline: null,
          });
        }
      }
      if (event.type === "round_started") {
        for (const player of byId.values()) {
          byId.set(player.playerId, {
            ...player,
            guessCount: 0,
            forfeitedThisRound: false,
          });
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
  let seriesStatus = readSeriesStatus(snapshot);
  let seriesFinishReason = readSeriesFinishReason(snapshot);
  let seriesFinalStandings = readRecords(snapshot, "series_final_standings");
  let roundResults = readRoundResults(snapshot);
  let finishReason = readFinishReason(snapshot);
  let mysteryId = readString(snapshot, "mystery_id");
  const bestOf = readNumber(snapshot, "best_of") ?? 3;
  const difficulty =
    parseSoloDifficulty(readString(snapshot, "difficulty")) ?? "hard";
  const difficultyLabel =
    SOLO_DIFFICULTIES.find((option) => option.id === difficulty)?.label ??
    "困难";
  let roundNumber = readNumber(snapshot, "round_number") ?? 1;
  let nextRoundAt = readNumber(snapshot, "next_round_unix_ms");
  for (const event of currentEvents) {
    if (event.type === "round_started") {
      phase = "playing";
      deadline = readNumber(event, "deadline_unix_ms");
      roundNumber = readNumber(event, "round_number") ?? roundNumber + 1;
      winnerPlayerId = undefined;
      finishReason = undefined;
      seriesStatus = "active";
      seriesFinishReason = undefined;
      seriesFinalStandings = [];
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
      seriesStatus = readSeriesStatus(event);
      seriesFinishReason = readSeriesFinishReason(event);
      seriesFinalStandings = readRecords(event, "series_final_standings");
      roundResults = readRoundResults(event);
      finishReason = readFinishReason(event);
      roundNumber = readNumber(event, "round_number") ?? roundNumber;
      nextRoundAt = readNumber(event, "next_round_unix_ms");
      mysteryId = readString(event, "mystery_id");
      hostPlayerId =
        readString(event, "host_player_id") ?? hostPlayerId;
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
  const opponentPlayers = playersInRoom
    .filter((player) => player.playerId !== selfPlayerId)
    .sort(
      (left, right) =>
        left.seatIndex - right.seatIndex ||
        left.playerId.localeCompare(right.playerId),
    );
  const opponentPlayer = opponentPlayers[0];
  const opponentDisconnectSecondsById =
    phase === "playing"
      ? disconnectSecondsByPlayerId(opponentPlayers, now)
      : new Map<string, number | null>();
  const opponentBoards = opponentPlayers.map((player, index) => ({
    id: player.playerId,
    name: `对手 ${index + 1} · ${player.displayName}`,
    progress: opponentProgress.filter(
      (progress) => progress.playerId === player.playerId,
    ),
    forfeitedThisRound: player.forfeitedThisRound,
    disconnectSeconds:
      opponentDisconnectSecondsById.get(player.playerId) ?? null,
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
  const connectionUnavailable =
    realtime.connection === "offline" ||
    realtime.connection === "closed";
  const fatalOffline =
    realtime.offlineReason === "session_invalid" ||
    realtime.offlineReason === "profile_invalid" ||
    realtime.offlineReason === "configuration" ||
    (connectionUnavailable &&
      /会话已失效|身份已失效|地址无效/.test(realtime.error));
  const connectedPlayers = playersInRoom.filter(
    (player) => player.connected,
  ).length;
  const nextRoundPaused =
    phase === "finished" &&
    seriesStatus === "active" &&
    Boolean(nextRoundAt) &&
    connectedPlayers < maxPlayers;
  const latestRoundStartIndex = currentEvents.findLastIndex(
    (event) => event.type === "round_started",
  );
  const currentRoundEvents =
    latestRoundStartIndex >= 0
      ? currentEvents.slice(latestRoundStartIndex)
      : currentEvents;
  const selfForfeitedThisRound =
    selfPlayer?.forfeitedThisRound === true ||
    currentRoundEvents.some(
      (event) =>
        event.type === "error" &&
        readString(event, "code") === "round_forfeited" &&
        (readNumber(event, "round_number") ?? roundNumber) === roundNumber,
    );
  const canGuess =
    connected &&
    phase === "playing" &&
    !selfForfeitedThisRound &&
    !guessPending &&
    selfGuessCount < maxGuesses;
  const revealAnswer = phase === "finished" && Boolean(mysteryId);
  const selfScore = selfPlayer?.score ?? 0;
  const opponentScore = opponentPlayer?.score ?? 0;
  const orderedPlayers = [
    ...(selfPlayer ? [selfPlayer] : []),
    ...opponentPlayers,
  ];
  const rankLabels = competitionRankLabels(
    orderedPlayers.map((player) => player.score),
  );
  const battleParticipants = Array.from(
    { length: maxPlayers },
    (_, index) => {
      const player = orderedPlayers[index];
      const self = index === 0;
      return {
        playerId: player?.playerId ?? `waiting-slot-${index}`,
        name:
          player?.displayName ??
          (self ? "你的身份" : "等待玩家"),
        connected:
          player?.connected === true &&
          (!self || realtime.connection === "connected"),
        guesses: player
          ? Math.max(
              player.guessCount,
              self
                ? ownGuesses.length
                : opponentProgress.filter(
                    (progress) => progress.playerId === player.playerId,
                  ).length,
            )
          : 0,
        score: player?.score ?? 0,
        self,
        slotLabel: self ? "你" : `对手 ${index}`,
        presenceLabel: player
          ? self && realtime.connection !== "connected"
            ? playerPresenceLabel(
                true,
                realtime.connection,
                player.connected,
                phase,
              )
            : player.forfeitedThisRound && player.connected
              ? "在线 · 本轮已判负"
              : playerPresenceLabel(
                  self,
                  realtime.connection,
                  player.connected,
                  phase,
                )
          : "等待连接",
        rankLabel: player ? rankLabels[index] : "未加入",
        disconnectSeconds:
          player && !self
            ? (opponentDisconnectSecondsById.get(player.playerId) ?? null)
            : null,
      };
    },
  );
  const opponentDisconnectSeconds = opponentPlayer
    ? (opponentDisconnectSecondsById.get(opponentPlayer.playerId) ?? null)
    : null;
  const finalStandingEntries = seriesFinalStandings
    .map((entry) => ({
      playerId: readString(entry, "player_id") ?? "",
      name: readString(entry, "display_name") ?? "玩家",
      seatIndex: readNumber(entry, "seat_index") ?? Number.MAX_SAFE_INTEGER,
      score: readNumber(entry, "score") ?? 0,
      leftSeries: entry.left_series === true,
    }))
    .filter((entry) => entry.playerId)
    .sort(
      (left, right) =>
        left.seatIndex - right.seatIndex ||
        left.playerId.localeCompare(right.playerId),
    );
  const finalRankLabels = competitionRankLabels(
    finalStandingEntries.map((entry) => entry.score),
  );
  const resultStandings =
    finalStandingEntries.length > 0
      ? finalStandingEntries.map((entry, index) => ({
          label:
            entry.playerId === selfPlayerId
              ? "你"
              : `对手 ${entry.seatIndex + 1}`,
          name: entry.leftSeries ? `${entry.name}（已离开）` : entry.name,
          score: entry.score,
          rankLabel: finalRankLabels[index],
          self: entry.playerId === selfPlayerId,
        }))
      : maxPlayers > 2
        ? battleParticipants.map((participant) => ({
            label: participant.slotLabel,
            name: participant.name,
            score: participant.score,
            rankLabel: participant.rankLabel,
            self: participant.self,
          }))
        : undefined;
  const celebrationKey = `${roomCode}:${roundNumber}:${winnerPlayerId ?? "draw"}:${seriesWinnerPlayerId ?? "ongoing"}:${finishReason ?? "legacy"}:${mysteryId ?? "unknown"}`;
  const resultIdentity = {
    roomCode,
    roundNumber,
    winnerPlayerId,
    seriesWinnerPlayerId,
    finishReason,
    mysteryId,
  };
  const showCelebration =
    phase === "finished" &&
    dismissedCelebration !== celebrationKey &&
    !wasBattleResultViewed(resultIdentity);
  const seriesComplete =
    seriesStatus !== "active" || Boolean(seriesWinnerPlayerId);
  const tiebreak =
    bestOf === 1 && phase === "finished" && !winnerPlayerId && !seriesComplete;
  const resultOutcome =
    seriesStatus === "abandoned"
      ? "draw"
      : seriesComplete && seriesWinnerPlayerId
        ? seriesWinnerPlayerId === selfPlayerId
          ? "win"
          : "loss"
        : winnerPlayerId === selfPlayerId
          ? "win"
          : winnerPlayerId
            ? "loss"
            : "draw";
  const dismissCelebration = useCallback(
    () => {
      resultDialogExitRef.current = false;
      markBattleResultViewed({
        roomCode,
        roundNumber,
        winnerPlayerId,
        seriesWinnerPlayerId,
        finishReason,
        mysteryId,
      });
      setDismissedCelebration(celebrationKey);
    },
    [
      celebrationKey,
      finishReason,
      mysteryId,
      roomCode,
      roundNumber,
      seriesWinnerPlayerId,
      winnerPlayerId,
    ],
  );
  const roomSettings = friendRoomSettings({
    maxPlayers,
    visibility,
    difficulty,
    bestOf,
  });
  const startDisabledReason = friendRoomStartDisabledReason({
    connected,
    isHost,
    connectedPlayers,
    requiredPlayers: maxPlayers,
    startPending,
  });
  const roomMembers = [...playersInRoom].sort(
    (left, right) =>
      left.seatIndex - right.seatIndex ||
      left.playerId.localeCompare(right.playerId),
  );
  const guessDraftScope =
    phase === "playing" && roomCode !== "—" && roundNumber >= 1
      ? `${roomCode}:${roundNumber}`
      : "";

  useEffect(() => {
    if (!guessDraftScope) {
      if (phase === "finished" && roomCode !== "—" && roundNumber >= 1) {
        clearLiveGuessDraft(roomCode, roundNumber);
      }
      if (hydratedDraftScope) {
        setHydratedDraftScope("");
        setSelectedId(undefined);
        setSearchQuery("");
        setSearchOpen(false);
      }
      return;
    }
    if (hydratedDraftScope === guessDraftScope) return;

    const draft = loadLiveGuessDraft(roomCode, roundNumber);
    const restoredPlayer = draft.selectedId
      ? availablePlayers.find((player) => player.id === draft.selectedId)
      : undefined;
    setSelectedId(restoredPlayer?.id);
    setSearchQuery(draft.query);
    setSearchOpen(false);
    setHydratedDraftScope(guessDraftScope);
  }, [
    availablePlayers,
    guessDraftScope,
    hydratedDraftScope,
    phase,
    roomCode,
    roundNumber,
  ]);

  useEffect(() => {
    if (
      !guessDraftScope ||
      hydratedDraftScope !== guessDraftScope
    ) {
      return;
    }
    saveLiveGuessDraft(roomCode, roundNumber, {
      query: searchQuery,
      selectedId,
    });
  }, [
    guessDraftScope,
    hydratedDraftScope,
    roomCode,
    roundNumber,
    searchQuery,
    selectedId,
  ]);

  useEffect(() => {
    const pending = pendingGuessRef.current;
    if (!pending) return;
    if (
      pending.roomCode !== roomCode ||
      pending.roundNumber !== roundNumber ||
      phase !== "playing"
    ) {
      pending.settled = true;
      pendingGuessRef.current = null;
      pending.resolve(false);
      if (mountedRef.current) setGuessPending(false);
      return;
    }
    const accepted =
      ownGuesses.some((guess) => guess.id === pending.playerId) ||
      realtime.events.some(
        (event) =>
          pending.requestId !== null &&
          event.type === "guess_accepted" &&
          event.request_id === pending.requestId,
      );
    const rejected = realtime.events.some(
      (event) =>
        pending.requestId !== null &&
        event.type === "error" &&
        event.request_id === pending.requestId,
    );
    if (!accepted && !rejected) return;

    pending.settled = true;
    pendingGuessRef.current = null;
    pending.resolve(accepted);
    if (!mountedRef.current) return;
    setGuessPending(false);
    if (accepted) {
      clearLiveGuessDraft(pending.roomCode, pending.roundNumber);
      setSelectedId(undefined);
      setSearchQuery("");
      setSearchOpen(false);
    }
  }, [
    ownGuesses,
    phase,
    realtime.events,
    roomCode,
    roundNumber,
  ]);

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
    if (phase !== "waiting" || realtime.error || !connected) {
      startPendingRef.current = false;
      setStartPending(false);
    }
  }, [connected, phase, realtime.error]);

  useEffect(() => {
    if (phase !== "finished" || seriesStatus === "active" || realtime.error) {
      restartPendingRef.current = false;
      setRestartPending(false);
    }
  }, [phase, realtime.error, seriesStatus]);

  useEffect(() => {
    if (connectionUnavailable && !recoveryVisibleRef.current) {
      recoveryTitleRef.current?.focus({ preventScroll: true });
    }
    recoveryVisibleRef.current = connectionUnavailable;
  }, [connectionUnavailable]);

  useEffect(() => {
    if (
      !hasAuthoritativeSnapshot ||
      !shouldFocusGameHeading ||
      entryFocusCompleteRef.current
    ) {
      return;
    }
    entryFocusCompleteRef.current = true;
    resultTitleRef.current?.focus({ preventScroll: true });
  }, [hasAuthoritativeSnapshot, shouldFocusGameHeading]);

  useEffect(() => {
    if (!closingIntent) return;
    closingTitleRef.current?.focus({ preventScroll: true });
  }, [closingIntent]);

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      leaveGenerationRef.current += 1;
      const pendingGuess = pendingGuessRef.current;
      if (pendingGuess && !pendingGuess.settled) {
        pendingGuess.settled = true;
        pendingGuessRef.current = null;
        pendingGuess.resolve(false);
      }
    };
  }, []);

  async function leaveCurrentRoom(returnTo: string) {
    const credentials = session?.credentials;
    if (!credentials) return { left: true, shouldNavigate: false };
    const generation = ++leaveGenerationRef.current;
    const intent = saveClosingIntent(credentials, returnTo);
    setClosingIntent(intent);
    setLeaveError("");
    realtime.close();

    let failureMessage = "";
    if (mode === "quick") {
      try {
        await leaveQuickMatch(credentials);
      } catch (error) {
        if (!isTerminalSessionError(error)) {
          failureMessage =
            "退出匹配失败，凭证已保留，请检查网络后重试。";
        }
      }
    } else {
      try {
        await leaveRoom(credentials);
      } catch (error) {
        if (!isTerminalSessionError(error)) {
          failureMessage =
            "退出房间失败，凭证已保留，请检查网络后重试。";
        }
      }
    }

    const ownsCurrentSession = realtimeCredentialsMatch(
      loadCredentials(mode)?.credentials,
      credentials,
    );
    const ownsUi =
      mountedRef.current &&
      leaveGenerationRef.current === generation &&
      ownsCurrentSession;
    if (failureMessage) {
      if (ownsUi) {
        setLeaveError(failureMessage);
        leavePendingRef.current = false;
      }
      return { left: false, shouldNavigate: false };
    }

    clearCredentialsIfMatches(credentials);
    clearClosingIntentIfMatches(credentials);
    clearLiveGuessDraftsForRoom(credentials.roomCode);
    return { left: true, shouldNavigate: ownsUi };
  }

  function startLeave(
    returnTo: string,
    event?: ReactMouseEvent<HTMLElement>,
  ) {
    event?.preventDefault();
    if (leavePendingRef.current) return;
    resultDialogExitRef.current = true;
    leavePendingRef.current = true;
    void leaveCurrentRoom(returnTo).then((result) => {
      if (result.left && result.shouldNavigate) {
        navigate(returnTo, { replace: true });
      }
    });
  }

  function exitSeries(event?: ReactMouseEvent<HTMLElement>) {
    startLeave(closingIntent?.returnTo ?? "/", event);
  }
  startLeaveRef.current = startLeave;

  async function rematch() {
    if (leavePendingRef.current) return;
    if (!connected) {
      setLeaveError(
        fatalOffline
          ? "当前会话已失效，请重新匹配。"
          : "恢复连接后可再次对战。",
      );
      return;
    }
    leavePendingRef.current = true;
    const destination = quickRematchPath(
      maxPlayers,
      visibility,
      difficulty,
      bestOf,
    );
    const result = await leaveCurrentRoom(destination);
    if (result.left && result.shouldNavigate) {
      navigate(destination, { replace: true });
    }
  }

  useEffect(() => {
    if (!session || !closingIntent || leavePendingRef.current) return;
    startLeaveRef.current(closingIntent.returnTo);
  }, [closingIntent, session]);

  function discardInvalidSession() {
    const credentials = session?.credentials;
    realtime.close();
    if (credentials) clearCredentialsIfMatches(credentials);
    const returnPath = mode === "room" ? "/room" : "/quick";
    const destination =
      realtime.offlineReason === "profile_invalid"
        ? `/identity?return=${encodeURIComponent(returnPath)}`
        : returnPath;
    navigate(destination, { replace: true });
  }

  function submitGuess(playerId = selectedId): Promise<boolean> | boolean {
    if (!playerId || !canGuess || pendingGuessRef.current) return false;

    return new Promise<boolean>((resolve) => {
      const pending = {
        requestId: null as string | null,
        playerId,
        roomCode,
        roundNumber,
        settled: false,
        resolve,
      };
      pendingGuessRef.current = pending;
      setGuessPending(true);

      const settle = (accepted: boolean) => {
        if (
          pending.settled ||
          pendingGuessRef.current !== pending
        ) {
          return;
        }
        pending.settled = true;
        pendingGuessRef.current = null;
        pending.resolve(accepted);
        if (!mountedRef.current) return;
        setGuessPending(false);
        if (!accepted) return;
        clearLiveGuessDraft(pending.roomCode, pending.roundNumber);
        setSelectedId(undefined);
        setSearchQuery("");
        setSearchOpen(false);
      };

      const requestId = realtime.send(
        "guess",
        { player_id: playerId },
        settle,
      );
      if (typeof requestId !== "string") {
        settle(false);
        return;
      }
      pending.requestId = requestId;
    });
  }

  function changeVisibility(next: OpponentVisibility) {
    realtime.send("set_visibility", { visibility: next });
  }

  function requestStartRound() {
    if (startDisabledReason || startPendingRef.current) return;
    let acknowledged: boolean | undefined;
    const sent = realtime.send(
      "start_round",
      {},
      (accepted) => {
        acknowledged = accepted;
        if (!accepted) {
          startPendingRef.current = false;
          setStartPending(false);
        }
      },
    );
    if (sent && acknowledged !== false) {
      startPendingRef.current = true;
      setStartPending(true);
    }
  }

  function requestRestartSeries() {
    if (
      mode !== "room" ||
      !isHost ||
      !connected ||
      !seriesComplete ||
      restartPendingRef.current
    ) {
      return;
    }
    let acknowledged: boolean | undefined;
    const sent = realtime.send(
      "restart_series",
      {},
      (accepted) => {
        acknowledged = accepted;
        if (!accepted) {
          restartPendingRef.current = false;
          setRestartPending(false);
        }
      },
    );
    if (sent && acknowledged !== false) {
      restartPendingRef.current = true;
      setRestartPending(true);
    }
  }

  async function copyCurrentRoomCode() {
    try {
      await copyRoomCode(roomCode);
      setCopyFeedback("房间号已复制");
    } catch {
      setCopyFeedback("复制失败，请手动复制房间号");
    }
  }

  if (!session) {
    return <Navigate to={mode === "room" ? "/room" : "/quick"} replace />;
  }

  if (closingIntent) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-5 py-12 text-foreground">
        <section
          className="w-full max-w-xl border border-foreground/25 bg-card px-6 py-9 sm:px-9"
          aria-busy={leavePendingRef.current}
          aria-labelledby="closing-room-title"
        >
          <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
            {mode === "room" ? "FRIEND ROOM" : "LIVE MATCH"} ·{" "}
            {closingIntent.roomCode}
          </p>
          <h1
            ref={closingTitleRef}
            id="closing-room-title"
            tabIndex={-1}
            className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl"
          >
            正在完成退出
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {leaveError
              ? "退出尚未完成，原会话不会自动恢复。请检查网络后重试。"
              : "正在通知服务器释放当前席位，请勿重复操作。"}
          </p>
          {leaveError ? (
            <p
              className="mt-5 border-l-2 border-destructive pl-3 text-sm text-destructive"
              role="alert"
            >
              {leaveError}
            </p>
          ) : (
            <p className="sr-only" role="status" aria-live="polite">
              正在完成退出
            </p>
          )}
          <Button
            type="button"
            className="mt-7 rounded-none"
            onClick={() => startLeave(closingIntent.returnTo)}
            disabled={leavePendingRef.current}
          >
            {leavePendingRef.current ? "正在退出…" : "重试退出"}
          </Button>
        </section>
      </main>
    );
  }

  if (!hasAuthoritativeSnapshot) {
    const unavailable = connectionUnavailable;
    const reconnecting = realtime.connection === "reconnecting";
    const statusCopy = unavailable
      ? connectionCopy(realtime.connection)
      : reconnecting
        ? "正在重连"
        : realtime.connection === "connected"
          ? "已连接，正在同步房间"
          : "正在连接";
    return (
      <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-foreground/20 bg-sidebar lg:min-h-svh lg:border-r lg:border-b-0">
          <div className="flex h-full flex-col px-5 py-5 sm:px-8 lg:px-9 lg:py-10">
            <div className="flex items-center gap-3">
              <PlugsConnectedIcon
                className="size-9 text-primary"
                weight="regular"
              />
              <span className="text-xl font-bold tracking-[0.08em]">
                CS GUESS
              </span>
            </div>
            <div className="mt-6 border-t-2 border-primary pt-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                当前模式
              </p>
              <p className="mt-2 text-lg font-semibold">
                {mode === "room" ? "好友房间" : "实时对战"}
              </p>
            </div>
            <dl className="mt-6 space-y-4 border-t border-foreground/15 pt-5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">房间号</dt>
                <dd className="mt-1 font-mono font-medium">{roomCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">玩家身份</dt>
                <dd className="mt-1 font-medium">凭证已保存</dd>
              </div>
            </dl>
            <Button
              type="button"
              variant="outline"
              className="mt-6 hidden rounded-none lg:mt-auto lg:inline-flex"
              onClick={exitSeries}
            >
              退出房间
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 items-center justify-center px-5 py-12 sm:px-8 lg:min-h-svh lg:px-12">
          <section
            className="w-full max-w-xl border border-foreground/25 bg-card px-6 py-9 sm:px-9"
            aria-labelledby="room-connection-title"
          >
            <div
              className={`flex size-12 items-center justify-center border ${
                unavailable
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : reconnecting
                    ? "border-warning/40 bg-warning/5 text-warning"
                    : "border-primary/40 bg-primary/5 text-primary"
              }`}
            >
              {unavailable ? (
                <WarningCircleIcon className="size-6" />
              ) : (
                <PlugsConnectedIcon className="size-6 motion-safe:animate-pulse" />
              )}
            </div>
            <p className="mt-6 font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
              ROOM · {roomCode}
            </p>
            <h1
              ref={recoveryTitleRef}
              tabIndex={unavailable ? -1 : undefined}
              id="room-connection-title"
              className="mt-3 text-3xl font-bold tracking-[-0.03em] outline-none sm:text-4xl"
            >
              {statusCopy}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {unavailable
                ? "尚未取得可用的房间状态。你可以重试连接，或安全退出本房间。"
                : reconnecting
                  ? "连接恢复后会重新同步房间，不会使用过期数据填充比分或席位。"
                  : "正在获取服务器确认的房间设置、成员与对局状态。"}
            </p>
            {!unavailable ? (
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {statusCopy}
              </p>
            ) : null}
            {realtime.error || leaveError || unavailable ? (
              <p
                className="mt-5 border-l-2 border-destructive pl-3 text-sm text-destructive"
                role={reconnecting ? undefined : "alert"}
              >
                {leaveError || realtime.error || statusCopy}
              </p>
            ) : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {fatalOffline ? (
                <Button
                  type="button"
                  className="rounded-none"
                  onClick={discardInvalidSession}
                >
                  {realtime.offlineReason === "profile_invalid"
                    ? "重新设置身份"
                    : mode === "room"
                      ? "重新加入房间"
                      : "重新匹配"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="rounded-none"
                  onClick={realtime.retry}
                >
                  重试连接
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="rounded-none lg:hidden"
                onClick={exitSeries}
              >
                退出房间
              </Button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const waitingCopy =
    mode === "room"
      ? realtime.connection === "connecting"
        ? "正在连接，连接后由房主开始本轮"
        : realtime.connection === "reconnecting"
          ? "连接恢复后，房主可以开始本轮"
          : !connected
            ? "当前离线，重连后由房主开始本轮"
        : isHost
          ? connectedPlayers < maxPlayers
            ? `还需 ${maxPlayers - connectedPlayers} 位成员加入，由你开始本轮`
            : `${connectedPlayers} / ${maxPlayers} 位成员已就位，由你开始本轮`
          : `等待房主 ${
              roomMembers.find((player) => player.playerId === hostPlayerId)
                ?.displayName ?? ""
            } 开始本轮`
      : opponentPlayer && !opponentPlayer.connected
        ? `等待 ${opponentPlayer.displayName} 建立实时连接`
        : "等待玩家实时连接后开始";

  const content =
    mode === "quick"
      ? {
          eyebrow: maxPlayers === 4 ? "4 人乱斗" : "实时 1v1",
          title:
            phase === "waiting"
              ? opponentPlayer && !opponentPlayer.connected
                ? `已匹配，等待 ${opponentPlayer.displayName} 连接。`
                : maxPlayers === 4
                  ? "等待四位玩家就位。"
                  : opponentPlayer
                    ? "双方就位，正在开始。"
                    : "正在等待对手加入。"
              : phase === "finished"
                ? "本局已经揭晓。"
                : maxPlayers === 4
                  ? "四人同题竞速。"
                  : "实时同题竞速。",
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
                ? seriesStatus === "abandoned"
                  ? "本系列已结束。"
                  : "查看本局结果。"
                : "好友房同题竞速。",
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
          mode === "quick"
            ? `${maxPlayers === 4 ? "4 人乱斗" : "实时 1v1"} · ${difficultyLabel}`
            : `好友房间 · ${difficultyLabel}`
        }
        onExit={exitSeries}
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
              <h1
                ref={resultTitleRef}
                tabIndex={-1}
                className="mt-3 text-3xl font-bold tracking-[-0.03em] outline-none sm:text-4xl"
              >
                {content.title}
              </h1>
            </div>
            <div className="shrink-0 sm:text-right">
              <div className="flex items-center gap-2 sm:justify-end">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.08em]">
                  ROOM · {roomCode}
                </p>
                {mode === "room" && roomCode !== "—" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-none"
                    aria-label={`复制房间号 ${roomCode}`}
                    onClick={() => void copyCurrentRoomCode()}
                  >
                    {copyFeedback === "房间号已复制" ? (
                      <CheckIcon />
                    ) : (
                      <CopyIcon />
                    )}
                  </Button>
                ) : null}
              </div>
              {copyFeedback ? (
                <span
                  className="mt-1 block min-h-4 text-[10px] text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {copyFeedback}
                </span>
              ) : (
                <span className="mt-1 block min-h-4" aria-hidden="true" />
              )}
              <p
                className={`mt-2 inline-flex items-center gap-1.5 text-xs ${
                  connected || realtime.connection === "connecting"
                    ? "text-primary"
                    : realtime.connection === "reconnecting"
                      ? "text-warning"
                      : "text-destructive"
                }`}
                role={
                  realtime.connection === "offline" ||
                  realtime.connection === "closed"
                    ? undefined
                    : "status"
                }
                aria-live={
                  realtime.connection === "offline" ||
                  realtime.connection === "closed"
                    ? "off"
                    : "polite"
                }
                aria-atomic="true"
              >
                {realtime.connection === "offline" ||
                realtime.connection === "closed" ? (
                  <WarningCircleIcon />
                ) : (
                  <PlugsConnectedIcon />
                )}
                {connected &&
                phase === "waiting" &&
                opponentPlayer &&
                !opponentPlayer.connected
                  ? "你已连接"
                  : connectionCopy(realtime.connection)}
              </p>
            </div>
          </header>

          {realtime.error || leaveError || connectionUnavailable ? (
            <div
              className="mb-5 flex flex-col justify-between gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center"
              role={
                realtime.connection === "reconnecting" ? undefined : "alert"
              }
            >
              <div>
                <h2
                  ref={recoveryTitleRef}
                  tabIndex={-1}
                  className="font-semibold outline-none"
                >
                  {fatalOffline ? "当前房间会话已失效" : "连接需要处理"}
                </h2>
                <p className="mt-1">
                  {leaveError ||
                    realtime.error ||
                    connectionCopy(realtime.connection)}
                </p>
              </div>
              {fatalOffline ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={discardInvalidSession}
                >
                  {realtime.offlineReason === "profile_invalid"
                    ? "重新设置身份"
                    : mode === "room"
                      ? "重新加入房间"
                      : "重新匹配"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={
                    leaveError
                      ? () => exitSeries()
                      : realtime.retry
                  }
                >
                  {leaveError ? "重试退出" : "立即重连"}
                </Button>
              )}
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

          {mode === "room" ? (
            <section
              className="mb-5 border-y border-foreground/20 py-3"
              aria-label="好友房设置与成员"
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs text-muted-foreground">房间设置</p>
                  <p className="mt-1 font-mono text-xs font-medium">
                    {roomSettings.join(" · ")}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  {roomMembers.map((player) => (
                    <li
                      key={player.playerId}
                      data-player-id={player.playerId}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span>{player.displayName}</span>
                      {player.playerId === hostPlayerId ? (
                        <span className="font-mono text-[10px] font-semibold text-primary">
                          房主
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <BattleContext
            mode={mode}
            guesses={selfGuessCount}
            opponentGuesses={opponentGuessCount}
            maxGuesses={maxGuesses}
            roomCode={roomCode}
            isRoomHost={isHost}
            onlinePlayers={connectedPlayers}
            maxPlayers={maxPlayers}
            selfName={selfPlayer?.displayName ?? "你"}
            opponentName={opponentPlayer?.displayName ?? "等待对手"}
            connected={connected}
            opponentConnected={opponentPlayer?.connected ?? false}
            selfPresenceLabel={
              realtime.connection !== "connected"
                ? playerPresenceLabel(
                    true,
                    realtime.connection,
                    selfPlayer?.connected ?? false,
                    phase,
                  )
                : selfForfeitedThisRound && connected
                ? "在线 · 本轮已判负"
                : playerPresenceLabel(
                    true,
                    realtime.connection,
                    selfPlayer?.connected ?? false,
                    phase,
                  )
            }
            opponentPresenceLabel={
              opponentPlayer?.forfeitedThisRound &&
              opponentPlayer.connected
                ? "在线 · 本轮已判负"
                : playerPresenceLabel(
                    false,
                    realtime.connection,
                    opponentPlayer?.connected ?? false,
                    phase,
                  )
            }
            opponentDisconnectSeconds={opponentDisconnectSeconds}
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

          {phase === "waiting" && mode === "room" ? (
            <div className="mt-5 flex flex-col items-end gap-2">
              <Button
                className="rounded-none"
                disabled={Boolean(startDisabledReason)}
                aria-describedby="room-start-reason"
                onClick={requestStartRound}
              >
                {startPending ? "正在开始" : "开始本轮"}
              </Button>
              <p
                id="room-start-reason"
                className="text-xs text-muted-foreground"
              >
                {startDisabledReason || "所有成员将同步进入同一题目"}
              </p>
            </div>
          ) : null}

          <div className="mt-6 min-w-0">
            {phase === "playing" && selfForfeitedThisRound ? (
              <p
                className="mb-3 border-l-2 border-destructive pl-3 text-sm font-medium text-destructive"
                role={connected ? "status" : undefined}
              >
                本轮已判负，等待下一轮
              </p>
            ) : null}
            {phase === "waiting" ? (
              <p className="mb-2 text-xs text-muted-foreground">
                {waitingCopy}
              </p>
            ) : null}
            <PlayerSearch
              players={availablePlayers}
              selectedPlayer={selectedPlayer}
              query={searchQuery}
              open={searchOpen}
              disabled={!canGuess}
              onOpenChange={setSearchOpen}
              onQueryChange={setSearchQuery}
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
              opponentDisconnectSeconds={opponentDisconnectSeconds}
              opponentForfeitedThisRound={
                opponentPlayer?.forfeitedThisRound ?? false
              }
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

          {phase === "finished" && seriesComplete ? (
            <section
              className="mt-6 border border-foreground/25"
              aria-labelledby="round-review-title"
            >
              <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-3 sm:px-5">
                <h2 id="round-review-title" className="text-sm font-semibold">
                  各轮回顾
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {roundResults.length} 轮
                </span>
              </div>
              {roundResults.length > 0 ? (
                <ol className="grid gap-px bg-foreground/15 sm:grid-cols-2 xl:grid-cols-3">
                  {roundResults.map((round) => {
                    const answer =
                      players.find((player) => player.id === round.mysteryId);
                    const winner = round.standings.find(
                      (standing) =>
                        standing.playerId === round.winnerPlayerId,
                    );
                    return (
                      <li
                        key={round.roundNumber}
                        className="min-w-0 bg-background p-4"
                      >
                        <div className="flex items-start gap-3">
                          <PlayerAvatar
                            player={answer ?? { nickname: "未知选手" }}
                            className="size-12"
                            eager
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-primary">
                                第 {round.roundNumber} 轮
                              </p>
                              <span className="text-[10px] text-muted-foreground">
                                {finishReasonLabel(round.finishReason)}
                              </span>
                            </div>
                            <p className="mt-1 truncate font-semibold">
                              {answer?.nickname ?? "未知选手"}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {winner
                                ? `${winner.displayName} 获胜`
                                : "本轮平局"}
                            </p>
                          </div>
                        </div>
                        <ol
                          className="mt-3 grid grid-cols-2 gap-px bg-foreground/15"
                          aria-label={`第 ${round.roundNumber} 轮结束后比分`}
                        >
                          {round.standings.map((standing) => (
                            <li
                              key={standing.playerId}
                              className="min-w-0 bg-background px-2 py-2"
                            >
                              <p className="truncate text-[10px] text-muted-foreground">
                                {round.standings.length > 2
                                  ? `第 ${standing.rank || "—"} 名`
                                  : standing.playerId === selfPlayerId
                                    ? "你"
                                    : standing.displayName}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-xs font-semibold">
                                {round.standings.length > 2
                                  ? `${standing.displayName} · ${standing.score} 分`
                                  : `${standing.score} 分`}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">
                  此对局来自旧版本，未包含逐轮记录。
                </p>
              )}
            </section>
          ) : null}

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
                  {seriesStatus === "abandoned"
                    ? "SERIES ABANDONED"
                    : seriesWinnerPlayerId === selfPlayerId
                    ? "SERIES WON"
                    : seriesWinnerPlayerId
                      ? "SERIES LOST"
                      : winnerPlayerId === selfPlayerId
                        ? "ROUND WON"
                        : winnerPlayerId
                          ? "ROUND LOST"
                          : "ROUND DRAW"}
                </p>
                {!seriesComplete && nextRoundSeconds !== undefined ? (
                  <p className="mt-1">
                    {tiebreak
                      ? "本轮平局，继续加赛"
                      : nextRoundPaused
                      ? "等待成员重连后开始下一局"
                      : `下一局将在 ${nextRoundSeconds} 秒后自动开始`}
                  </p>
                ) : null}
              </div>
            ) : phase === "waiting" ? (
              <p className="font-mono">WAITING FOR ROUND</p>
            ) : (
              <p className="font-mono">SERVER AUTHORITATIVE</p>
            )}
          </div>

          {phase === "finished" && seriesComplete ? (
            <div className="mt-5 flex flex-col gap-2 border-t border-foreground/15 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground" role="status">
                {mode === "room"
                  ? isHost
                    ? !connected
                      ? fatalOffline
                        ? "会话已失效，请重新加入房间"
                        : "恢复连接后可再次对战"
                      : restartPending
                      ? "正在重置系列赛…"
                      : "可保留当前成员并开始一场全新的系列赛"
                    : "留在房间，等待房主开始下一场"
                  : !connected
                    ? fatalOffline
                      ? "会话已失效，请重新匹配"
                      : "恢复连接后可重新匹配"
                    : "可返回大厅或重新匹配"}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {mode === "room" && isHost ? (
                  <div>
                    <Button
                      size="sm"
                      className="w-full rounded-none sm:w-auto"
                      disabled={!connected || restartPending}
                      aria-describedby={
                        !connected ? "restart-series-disabled-reason" : undefined
                      }
                      onClick={requestRestartSeries}
                    >
                      {restartPending ? "正在重置" : "开始下一场"}
                    </Button>
                    {!connected ? (
                      <p
                        id="restart-series-disabled-reason"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        {fatalOffline
                          ? "会话已失效，请重新加入房间"
                          : "恢复连接后可开始下一场"}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={dismissCelebration}
                >
                  查看对局
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={exitSeries}
                >
                  返回模式大厅
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </main>
      {showCelebration ? (
        <CelebrationOverlay
          outcome={resultOutcome}
          seriesComplete={seriesComplete}
          seriesStatus={seriesStatus}
          seriesFinishReason={seriesFinishReason}
          score={`${selfScore} : ${opponentScore}`}
          mysteryPlayer={mysteryPlayer}
          finishReason={finishReason}
          nextRoundSeconds={nextRoundSeconds}
          nextRoundPaused={nextRoundPaused}
          tiebreak={tiebreak}
          waitingForHostRestart={
            mode === "room" && seriesComplete && !isHost
          }
          standings={resultStandings}
          onClose={dismissCelebration}
          onExit={fatalOffline ? discardInvalidSession : exitSeries}
          exitLabel={
            fatalOffline
              ? realtime.offlineReason === "profile_invalid"
                ? "重新设置身份"
                : mode === "room"
                  ? "重新加入房间"
                  : "重新匹配"
              : undefined
          }
          onRematch={
            mode === "quick"
              ? () => void rematch()
              : mode === "room" && isHost
                ? requestRestartSeries
                : undefined
          }
          rematchDisabled={!connected}
          rematchDisabledReason={
            fatalOffline
              ? mode === "room"
                ? "会话已失效，请重新加入房间"
                : "会话已失效，请重新匹配"
              : "恢复连接后可再次对战"
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              const focusTarget = resultDialogExitRef.current
                ? closingTitleRef.current
                : resultTitleRef.current;
              focusTarget?.focus({ preventScroll: true });
            });
          }}
        />
      ) : null}
    </div>
  );
}
