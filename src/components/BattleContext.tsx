import { UserCircleIcon, WifiHighIcon } from "@phosphor-icons/react";

import { InfoTip } from "@/components/InfoTip";
import type { GameMode } from "@/types/game";

interface BattleContextProps {
  mode: GameMode;
  guesses: number;
  opponentGuesses: number;
  maxGuesses: number;
  roomCode?: string;
  isRoomHost?: boolean;
  onlinePlayers?: number;
  maxPlayers?: number;
  selfName?: string;
  opponentName?: string;
  connected?: boolean;
  opponentConnected?: boolean;
  selfScore?: number;
  opponentScore?: number;
  bestOf?: number;
  roundNumber?: number;
  participants?: readonly BattleParticipant[];
  selfPresenceLabel?: string;
  opponentPresenceLabel?: string;
  opponentDisconnectSeconds?: number | null;
}

interface BattleParticipant {
  playerId: string;
  name: string;
  connected: boolean;
  guesses: number;
  score: number;
  self: boolean;
  slotLabel?: string;
  presenceLabel?: string;
  rankLabel?: string;
  disconnectSeconds?: number | null;
}

function AttemptDots({ used, total }: { used: number; total: number }) {
  return (
    <div className="flex gap-1" aria-label={`已使用 ${used} 次机会`}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={
            index < used
              ? "size-2 border border-primary bg-primary"
              : "size-2 border border-foreground/25 bg-transparent"
          }
        />
      ))}
    </div>
  );
}

function PlayerSide({
  side,
  name,
  connected,
  guesses,
  maxGuesses,
  presenceLabel,
  disconnectSeconds,
  slotLabel,
}: {
  side: "自己" | "对手";
  name: string;
  connected: boolean;
  guesses: number;
  maxGuesses: number;
  presenceLabel?: string;
  disconnectSeconds?: number | null;
  slotLabel?: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 px-3 py-4 sm:px-5 ${
        side === "对手" ? "justify-end text-right" : ""
      }`}
    >
      {side === "自己" ? (
        <UserCircleIcon
          className="hidden size-9 shrink-0 text-foreground sm:block"
          weight="light"
        />
      ) : null}
      <div className="min-w-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          {side}
        </p>
        <p className="mt-1 truncate text-sm font-semibold">{name}</p>
        <p
          className={`mt-1 flex items-center gap-1 text-xs ${
            side === "对手" ? "justify-end" : ""
          } ${connected ? "text-primary" : "text-destructive"}`}
        >
          <WifiHighIcon className="size-3" />
          {presenceLabel ?? (connected ? "在线" : "离线")}
        </p>
        {disconnectSeconds !== null && disconnectSeconds !== undefined ? (
          <>
            <p className="mt-1 font-mono text-xs text-destructive" aria-live="off">
              重连 00:{String(disconnectSeconds).padStart(2, "0")} · 超时判负
            </p>
            <span className="sr-only" role="status" aria-live="polite">
              {slotLabel ?? side}连接中断，重连宽限期已开始。
            </span>
          </>
        ) : null}
        <p className="mt-1 font-mono text-xs text-muted-foreground sm:hidden">
          {guesses} / {maxGuesses} 次
        </p>
      </div>
      <div className={`ml-auto hidden sm:block ${side === "对手" ? "order-first ml-0 mr-auto" : ""}`}>
        <p className="mb-2 font-mono text-xs text-muted-foreground">
          {maxGuesses - guesses} / {maxGuesses}
        </p>
        <AttemptDots used={guesses} total={maxGuesses} />
      </div>
      {side === "对手" ? (
        <UserCircleIcon
          className="hidden size-9 shrink-0 text-foreground sm:block"
          weight="light"
        />
      ) : null}
    </div>
  );
}

export function BattleContext({
  mode,
  guesses,
  opponentGuesses,
  maxGuesses,
  roomCode = "CS-207207",
  isRoomHost = false,
  onlinePlayers = 1,
  maxPlayers = 8,
  selfName = "你",
  opponentName = "等待对手",
  connected = true,
  opponentConnected = false,
  selfScore = 0,
  opponentScore = 0,
  bestOf = 3,
  roundNumber = 0,
  participants,
  selfPresenceLabel,
  opponentPresenceLabel,
  opponentDisconnectSeconds,
}: BattleContextProps) {
  if (mode === "daily" || mode === "solo") {
    const isDaily = mode === "daily";
    return (
      <div className="flex items-center justify-between border-y border-foreground/20 px-5 py-4">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">
            {isDaily ? "今日统一题目" : "随机个人题目"}
          </p>
          <InfoTip
            label={isDaily ? "今日题目说明" : "单人题目说明"}
            side="right"
            className="size-7"
          >
            {isDaily
              ? "所有玩家共享同一个神秘选手，每日零点刷新。"
              : "本局随机生成神秘选手，结算后可以立即开始下一局。"}
          </InfoTip>
        </div>
        <AttemptDots used={guesses} total={maxGuesses} />
      </div>
    );
  }

  if (participants && participants.length > 2) {
    return (
      <section
        className="border border-foreground/25"
        aria-labelledby="group-battle-heading"
      >
        <div className="flex items-center justify-between gap-4 border-b border-foreground/20 px-4 py-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
              4 Players · BO{bestOf} ·{" "}
              {roundNumber > 0 ? `R${roundNumber}` : "READY"}
            </p>
            <h2
              id="group-battle-heading"
              className="mt-1 text-sm font-semibold"
            >
              四人同题竞速
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {roomCode}
          </p>
        </div>
        <div
          className="grid sm:grid-cols-2 xl:grid-cols-4"
          role="list"
          aria-label="对战席位"
        >
          {participants.map((participant, index) => {
            const headingId = `battle-participant-${index}`;
            return (
              <div
                key={participant.playerId}
                role="listitem"
                aria-labelledby={headingId}
                className={`min-w-0 border-b border-foreground/20 p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0 ${
                  participant.self ? "bg-primary/[0.055]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                      {participant.slotLabel ??
                        (participant.self ? "你" : "对手")}
                    </p>
                    <h3
                      id={headingId}
                      className="mt-1 truncate text-sm font-semibold"
                    >
                      {participant.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {participant.rankLabel}
                    </p>
                  </div>
                  <p className="font-mono text-2xl font-semibold text-primary">
                    {participant.score}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <AttemptDots
                    used={participant.guesses}
                    total={maxGuesses}
                  />
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      participant.connected
                        ? "text-primary"
                        : "text-destructive"
                    }`}
                  >
                    <WifiHighIcon className="size-3" />
                    {participant.presenceLabel ??
                      (participant.connected ? "在线" : "离线")}
                  </span>
                </div>
                {participant.disconnectSeconds !== null &&
                participant.disconnectSeconds !== undefined ? (
                  <>
                    <p
                      className="mt-2 font-mono text-xs text-destructive"
                      aria-live="off"
                    >
                      重连 00:
                      {String(participant.disconnectSeconds).padStart(2, "0")} ·
                      超时判负
                    </p>
                    <span className="sr-only" role="status" aria-live="polite">
                      {participant.slotLabel ?? "对手"}
                      连接中断，重连宽限期已开始。
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {onlinePlayers} / {maxPlayers} 位玩家在线
          </span>
          <span className="font-mono text-primary">
            {mode === "room"
              ? isRoomHost
                ? "HOST · GROUP BATTLE"
                : "FRIEND ROOM"
              : "FIRST TO SOLVE WINS"}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-foreground/25">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <PlayerSide
          side="自己"
          name={selfName}
          connected={connected}
          guesses={guesses}
          maxGuesses={maxGuesses}
          presenceLabel={selfPresenceLabel}
          slotLabel="你"
        />
        <div className="flex min-w-26 flex-col items-center justify-center border-x border-foreground/20 px-3 py-3 sm:min-w-36 sm:px-6">
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
            BO{bestOf} · {roundNumber > 0 ? `R${roundNumber}` : "READY"}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-[-0.05em] sm:text-3xl">
            {selfScore}
            <span className="mx-2 text-muted-foreground">:</span>
            {opponentScore}
          </p>
          <p className="mt-1 hidden font-mono text-[9px] text-muted-foreground sm:block">
            {roomCode}
          </p>
        </div>
        <PlayerSide
          side="对手"
          name={opponentName}
          connected={opponentConnected}
          guesses={opponentGuesses}
          maxGuesses={maxGuesses}
          presenceLabel={opponentPresenceLabel}
          disconnectSeconds={opponentDisconnectSeconds}
          slotLabel="对手 1"
        />
      </div>
      {mode === "room" ? (
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {onlinePlayers} / {maxPlayers} 位玩家在线
          </span>
          <span className="font-mono text-primary">
            {isRoomHost ? "HOST · 同题竞速" : "FRIEND ROOM"}
          </span>
        </div>
      ) : null}
    </section>
  );
}
