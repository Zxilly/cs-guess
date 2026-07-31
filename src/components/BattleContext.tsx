import { t } from "@lingui/core/macro";
import { UserCircleIcon, WifiHighIcon } from "@phosphor-icons/react";

import type { GameMode } from "@/types/game";

interface BattleContextProps {
  mode: Extract<GameMode, "quick" | "room">;
  guesses: number;
  opponentGuesses: number;
  maxGuesses: number;
  roomCode?: string;
  isRoomHost?: boolean;
  onlinePlayers?: number;
  maxPlayers?: number;
  selfName?: string;
  opponentName?: string;
  selfPlayerId?: string;
  opponentPlayerId?: string;
  hostPlayerId?: string;
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
    <div className="flex gap-1" aria-label={t`已使用 ${used} 次机会`}>
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
  playerId,
  isHost = false,
}: {
  side: "自己" | "对手";
  name: string;
  connected: boolean;
  guesses: number;
  maxGuesses: number;
  presenceLabel?: string;
  disconnectSeconds?: number | null;
  slotLabel?: string;
  playerId?: string;
  isHost?: boolean;
}) {
  return (
    <div
      data-player-id={playerId}
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
        <div className={`mt-1 flex min-w-0 items-center gap-2 ${
          side === "对手" ? "justify-end" : ""
        }`}>
          <p className="truncate text-sm font-semibold">{name}</p>
          {isHost ? (
            <span className="shrink-0 font-mono text-[9px] font-semibold text-primary">
              {t`房主`}
            </span>
          ) : null}
        </div>
        <p
          className={`mt-1 flex items-center gap-1 text-xs ${
            side === "对手" ? "justify-end" : ""
          } ${connected ? "text-primary" : "text-destructive"}`}
        >
          <WifiHighIcon className="size-3" />
          {presenceLabel ?? (connected ? t`在线` : t`离线`)}
        </p>
        {disconnectSeconds !== null && disconnectSeconds !== undefined ? (
          <>
            <p className="mt-1 font-mono text-xs text-destructive" aria-live="off">
              {t`重连 00:`}{String(disconnectSeconds).padStart(2, "0")} {t`· 超时判负`}
            </p>
            <span className="sr-only" role="status" aria-live="polite">
              {slotLabel ?? side}{t`连接中断，重连宽限期已开始。`}
            </span>
          </>
        ) : null}
        <p className="mt-1 font-mono text-xs text-muted-foreground sm:hidden">
          {guesses} / {maxGuesses} {t`次`}
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
  roomCode,
  isRoomHost = false,
  onlinePlayers = 1,
  maxPlayers = 4,
  selfName = t`你`,
  opponentName = t`等待对手`,
  selfPlayerId,
  opponentPlayerId,
  hostPlayerId,
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
              {t`四人同题竞速`}
            </h2>
          </div>
          {roomCode ? (
            <p className="font-mono text-xs text-muted-foreground">
              {roomCode}
            </p>
          ) : null}
        </div>
        <div
          className="grid sm:grid-cols-2 xl:grid-cols-4"
          role="list"
          aria-label={t`对战席位`}
        >
          {participants.map((participant, index) => {
            const headingId = `battle-participant-${index}`;
            return (
              <div
                key={participant.playerId}
                data-player-id={participant.playerId}
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
                        (participant.self ? t`你` : t`对手`)}
                    </p>
                    <h3
                      id={headingId}
                      className="mt-1 truncate text-sm font-semibold"
                    >
                      {participant.name}
                    </h3>
                    {participant.playerId === hostPlayerId ? (
                      <p className="mt-1 font-mono text-[9px] font-semibold text-primary">
                        {t`房主`}
                      </p>
                    ) : null}
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
                      (participant.connected ? t`在线` : t`离线`)}
                  </span>
                </div>
                {participant.disconnectSeconds !== null &&
                participant.disconnectSeconds !== undefined ? (
                  <>
                    <p
                      className="mt-2 font-mono text-xs text-destructive"
                      aria-live="off"
                    >
                      {t`重连 00:`}
                      {String(participant.disconnectSeconds).padStart(2, "0")} {t`·
                      超时判负`}
                    </p>
                    <span className="sr-only" role="status" aria-live="polite">
                      {participant.slotLabel ?? t`对手`}
                      {t`连接中断，重连宽限期已开始。`}
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {onlinePlayers} / {maxPlayers} {t`位玩家在线`}
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
          slotLabel={t`你`}
          playerId={selfPlayerId}
          isHost={selfPlayerId === hostPlayerId}
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
          {roomCode ? (
            <p className="mt-1 hidden font-mono text-[9px] text-muted-foreground sm:block">
              {roomCode}
            </p>
          ) : null}
        </div>
        <PlayerSide
          side="对手"
          name={opponentName}
          connected={opponentConnected}
          guesses={opponentGuesses}
          maxGuesses={maxGuesses}
          presenceLabel={opponentPresenceLabel}
          disconnectSeconds={opponentDisconnectSeconds}
          slotLabel={t`对手 1`}
          playerId={opponentPlayerId}
          isHost={opponentPlayerId === hostPlayerId}
        />
      </div>
      {mode === "room" ? (
        <div className="flex items-center justify-between border-t border-foreground/15 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {onlinePlayers} / {maxPlayers} {t`位玩家在线`}
          </span>
          <span className="font-mono text-primary">
            {isRoomHost ? t`HOST · 同题竞速` : "FRIEND ROOM"}
          </span>
        </div>
      ) : null}
    </section>
  );
}
