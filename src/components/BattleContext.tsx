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
}

interface BattleParticipant {
  playerId: string;
  name: string;
  connected: boolean;
  guesses: number;
  score: number;
  self: boolean;
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
}: {
  side: "自己" | "对手";
  name: string;
  connected: boolean;
  guesses: number;
  maxGuesses: number;
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
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            side === "对手" ? "justify-end" : ""
          } ${connected ? "text-primary" : "text-destructive"}`}
        >
          <WifiHighIcon className="size-3" />
          {connected ? "在线" : "离线"}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground sm:hidden">
          {guesses} / {maxGuesses} 次
        </p>
      </div>
      <div className={`ml-auto hidden sm:block ${side === "对手" ? "order-first ml-0 mr-auto" : ""}`}>
        <p className="mb-2 font-mono text-[10px] text-muted-foreground">
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
}: BattleContextProps) {
  if (mode === "daily") {
    return (
      <div className="flex items-center justify-between border-y border-foreground/20 px-5 py-4">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">今日统一题目</p>
          <InfoTip label="今日题目说明" side="right" className="size-7">
            所有玩家共享同一个神秘选手，每日零点刷新。
          </InfoTip>
        </div>
        <AttemptDots used={guesses} total={maxGuesses} />
      </div>
    );
  }

  if (participants && participants.length > 2) {
    return (
      <section className="border border-foreground/25">
        <div className="flex items-center justify-between gap-4 border-b border-foreground/20 px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-primary">
              4 Players · BO{bestOf} ·{" "}
              {roundNumber > 0 ? `R${roundNumber}` : "READY"}
            </p>
            <p className="mt-1 text-sm font-semibold">四人同题竞速</p>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {roomCode}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {participants.map((participant) => (
            <div
              key={participant.playerId}
              className={`min-w-0 border-b border-foreground/20 p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0 ${
                participant.self ? "bg-primary/[0.055]" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                    {participant.self ? "自己" : "对手"}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">
                    {participant.name}
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
                  className={`inline-flex items-center gap-1 text-[10px] ${
                    participant.connected
                      ? "text-primary"
                      : "text-destructive"
                  }`}
                >
                  <WifiHighIcon className="size-3" />
                  {participant.connected ? "在线" : "离线"}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-[10px] text-muted-foreground">
          <span>
            {onlinePlayers} / {maxPlayers} 位玩家在线
          </span>
          <span className="font-mono text-primary">
            {isRoomHost ? "HOST · GROUP BATTLE" : "FIRST TO SOLVE WINS"}
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
        />
      </div>
      {mode === "room" ? (
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-[10px] text-muted-foreground">
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
