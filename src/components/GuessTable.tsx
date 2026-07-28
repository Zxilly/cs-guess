import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@phosphor-icons/react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/InfoTip";
import { PlayerRoleIcon } from "@/components/PlayerRoleLabel";
import { TeamLogo } from "@/components/TeamLogo";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  playerRoleNameZh,
  players as catalogPlayers,
  type Player,
} from "@/data/players";
import {
  compareCountries,
  countryContinentZh,
  countryNameZh,
  formatCountryDistance,
} from "@/lib/country-geography";
import { cn } from "@/lib/utils";
import type {
  CountryHint,
  GameMode,
  OpponentGuessProgress,
  OpponentVisibility,
} from "@/types/game";

interface GuessTableProps {
  guesses: readonly Player[];
  opponentGuesses: readonly Player[];
  opponentVisibility: OpponentVisibility;
  mysteryPlayer: Player;
  mode: GameMode;
  maxGuesses: number;
  selfName?: string;
  opponentName?: string;
  ownMatchedFields?: readonly (readonly string[])[];
  ownCountryHints?: readonly CountryHint[];
  opponentProgress?: readonly OpponentGuessProgress[];
  opponents?: readonly OpponentBoardData[];
  onOpponentVisibilityChange?: (visibility: OpponentVisibility) => void;
  opponentDisconnectSeconds?: number | null;
  opponentForfeitedThisRound?: boolean;
}

interface OpponentBoardData {
  id: string;
  name: string;
  progress: readonly OpponentGuessProgress[];
  disconnectSeconds?: number | null;
  forfeitedThisRound?: boolean;
}

type Comparison = "match" | "higher" | "lower" | "miss";

const ATTRIBUTES = [
  ["战队", "team", "team"],
  ["国籍", "countryCode", "nationality"],
  ["年龄", "age", "age"],
  ["位置", "role", "role"],
  ["Major", "majorAppearances", "major_appearances"],
] as const;

function compareNumber(guess: number, target: number): Comparison {
  if (guess === target) return "match";
  return target > guess ? "higher" : "lower";
}

function ComparisonValue({
  value,
  comparison,
  valueIcon,
}: {
  value: string | number;
  comparison: Comparison;
  valueIcon?: ReactNode;
}) {
  const Icon =
    comparison === "match"
      ? CheckIcon
      : comparison === "higher"
        ? ArrowUpIcon
        : comparison === "lower"
          ? ArrowDownIcon
          : CircleIcon;
  const comparisonLabel =
    comparison === "higher"
      ? "目标数值更高"
      : comparison === "lower"
        ? "目标数值更低"
        : comparison === "match"
          ? "完全一致"
          : "未命中";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center justify-center gap-1 font-mono text-xs",
        comparison === "match" && "font-semibold text-primary",
        comparison === "higher" &&
          "font-semibold text-comparison-higher",
        comparison === "lower" &&
          "font-semibold text-comparison-lower",
        comparison === "miss" && "text-muted-foreground",
      )}
      title={comparisonLabel}
      aria-label={`${value}，${comparisonLabel}`}
    >
      {valueIcon ?? (
        <Icon
          className="size-3"
          weight={comparison === "miss" ? "light" : "bold"}
        />
      )}
      <span className="max-w-22 truncate">{value}</span>
    </span>
  );
}

function TeamComparisonValue({
  player,
  comparison,
}: {
  player: Player;
  comparison: Comparison;
}) {
  const comparisonLabel =
    comparison === "match" ? "完全一致" : "战队未命中";

  return (
    <span
      className={cn(
        "mx-auto flex max-w-full items-center justify-center gap-1.5",
        comparison === "match"
          ? "font-semibold text-primary"
          : "text-muted-foreground",
      )}
      title={`${player.team}，${comparisonLabel}`}
      aria-label={`${player.team}，${comparisonLabel}`}
    >
      <TeamLogo name={player.team} src={player.teamLogoUrl} />
      <span className="min-w-0 truncate font-mono text-xs">{player.team}</span>
    </span>
  );
}

function CountryComparisonValue({
  countryCode,
  targetCountryCode,
  hint,
}: {
  countryCode: string;
  targetCountryCode: string;
  hint?: CountryHint;
}) {
  const comparison = hint ?? compareCountries(countryCode, targetCountryCode);
  const continent = countryContinentZh(countryCode);
  const relationLabel =
    comparison.relation === "match"
      ? "命中"
      : comparison.relation === "near"
        ? "同洲接近"
        : "不同洲";
  const distanceLabel = formatCountryDistance(comparison.distanceKm);
  const comparisonLabel = `${countryNameZh(countryCode)}，${relationLabel}${
    continent ? `，${continent}` : ""
  }，两国首都直线距离 ${distanceLabel}`;

  return (
    <span
      className={cn(
        "inline-flex w-full min-w-0 max-w-full flex-col items-center justify-center overflow-hidden",
        comparison.relation === "match" && "text-primary",
        comparison.relation === "near" && "text-comparison-near",
        comparison.relation === "miss" && "text-muted-foreground",
      )}
      title={comparisonLabel}
      aria-label={comparisonLabel}
    >
      <span className="max-w-full truncate text-xs font-semibold">
        {countryNameZh(countryCode)}
      </span>
      <span
        className={cn(
          "mt-1 font-mono text-xs max-w-full truncate",
          comparison.relation === "match" && "text-primary",
        )}
      >
        {distanceLabel} · {relationLabel}
      </span>
    </span>
  );
}

function comparisonFor(
  player: Player,
  mysteryPlayer: Player,
  attribute: (typeof ATTRIBUTES)[number],
  matchedFields?: readonly string[],
): Comparison {
  const [, key, protocolKey] = attribute;
  if (matchedFields) {
    return matchedFields.includes(protocolKey) ? "match" : "miss";
  }
  if (key === "age" || key === "majorAppearances") {
    return compareNumber(
      player[key] as number,
      mysteryPlayer[key] as number,
    );
  }
  return player[key] === mysteryPlayer[key] ? "match" : "miss";
}

function GuessBoard({
  title,
  guesses,
  maxGuesses,
  mysteryPlayer,
  matchedFields,
  countryHints,
}: {
  title: string;
  guesses: readonly Player[];
  maxGuesses: number;
  mysteryPlayer: Player;
  matchedFields?: readonly (readonly string[])[];
  countryHints?: readonly CountryHint[];
}) {
  const rows = Array.from({ length: maxGuesses }, (_, index) => guesses[index]);
  const mobileVisibleRows = Math.min(maxGuesses, guesses.length + 1);
  return (
    <section className="min-w-0 border border-foreground/25">
      <div className="flex items-baseline justify-between border-b border-foreground/20 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="font-mono text-xs text-muted-foreground">
          {guesses.length} / {maxGuesses}
        </p>
      </div>
      <p className="border-b border-foreground/15 px-4 py-2 text-xs text-muted-foreground sm:hidden">
        横向滑动查看全部属性 →
      </p>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        role="region"
        aria-label={`${title}，横向滚动查看更多属性`}
        tabIndex={0}
      >
        <Table className="min-w-[46rem] table-fixed">
          <TableHeader>
            <TableRow className="border-foreground/20 hover:bg-transparent">
              <TableHead className="w-10 border-r border-foreground/15 text-center">
                #
              </TableHead>
              <TableHead className="w-34 border-r border-foreground/15">
                猜测选手
              </TableHead>
              {ATTRIBUTES.map(([label]) => (
                <TableHead
                  key={label}
                  className="border-r border-foreground/15 text-center last:border-r-0"
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((player, index) => (
              <TableRow
                key={player?.id ?? `own-empty-${index}`}
                className={cn(
                  "h-15 border-foreground/15 hover:bg-primary/[0.025]",
                  index >= mobileVisibleRows && "hidden sm:table-row",
                )}
              >
                <TableCell className="border-r border-foreground/15 text-center font-mono text-xs">
                  {index + 1}
                </TableCell>
                <TableCell className="border-r border-foreground/15">
                  {player ? (
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-semibold"
                        title={player.nickname}
                      >
                        {player.nickname}
                      </p>
                      <p
                        className="mt-0.5 truncate text-xs text-muted-foreground"
                        title={player.name}
                      >
                        {player.name}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">
                      等待猜测
                    </span>
                  )}
                </TableCell>
                {ATTRIBUTES.map((attribute) => (
                  <TableCell
                    key={attribute[0]}
                    className="overflow-hidden border-r border-foreground/15 px-2 text-center last:border-r-0"
                  >
                    {player ? (
                      attribute[1] === "team" ? (
                        <TeamComparisonValue
                          player={player}
                          comparison={comparisonFor(
                            player,
                            mysteryPlayer,
                            attribute,
                            matchedFields?.[index],
                          )}
                        />
                      ) : attribute[1] === "countryCode" ? (
                        <CountryComparisonValue
                          countryCode={player.countryCode}
                          targetCountryCode={mysteryPlayer.countryCode}
                          hint={countryHints?.[index]}
                        />
                      ) : (
                        <ComparisonValue
                          value={
                            attribute[1] === "role"
                              ? playerRoleNameZh(player.role)
                              : player[attribute[1]]
                          }
                          valueIcon={
                            attribute[1] === "role" ? (
                              <PlayerRoleIcon role={player.role} />
                            ) : undefined
                          }
                          comparison={comparisonFor(
                            player,
                            mysteryPlayer,
                            attribute,
                            matchedFields?.[index],
                          )}
                        />
                      )
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function OpponentBoard({
  title,
  progress,
  visibility,
  maxGuesses,
  mysteryPlayer,
  disconnectSeconds,
  forfeitedThisRound = false,
}: {
  title: string;
  progress: readonly OpponentGuessProgress[];
  visibility: OpponentVisibility;
  maxGuesses: number;
  mysteryPlayer: Player;
  disconnectSeconds?: number | null;
  forfeitedThisRound?: boolean;
}) {
  const rows = Array.from({ length: maxGuesses }, (_, index) => progress[index]);
  const mobileVisibleRows = Math.min(maxGuesses, progress.length + 1);
  return (
    <section className="min-w-0 border border-foreground/25">
      <div className="flex items-start justify-between gap-3 border-b border-foreground/20 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {disconnectSeconds !== null && disconnectSeconds !== undefined ? (
            <>
              <p
                className="mt-1 font-mono text-xs text-destructive"
                aria-hidden="true"
              >
                重连 00:{String(disconnectSeconds).padStart(2, "0")} · 超时判负
              </p>
            </>
          ) : null}
          {forfeitedThisRound ? (
            <p className="mt-1 text-xs font-medium text-destructive">
              在线 · 本轮已判负
            </p>
          ) : null}
        </div>
        <p className="shrink-0 font-mono text-xs text-muted-foreground">
          {progress.length} / {maxGuesses}
        </p>
      </div>
      <p className="border-b border-foreground/15 px-4 py-2 text-xs text-muted-foreground sm:hidden">
        横向滑动查看全部属性 →
      </p>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        role="region"
        aria-label={`${title}，横向滚动查看更多属性`}
        tabIndex={0}
      >
        <Table className="min-w-[46rem] table-fixed">
          <TableHeader>
            <TableRow className="border-foreground/20 hover:bg-transparent">
              <TableHead className="w-10 border-r border-foreground/15 text-center">
                #
              </TableHead>
              <TableHead className="w-34 border-r border-foreground/15">
                {visibility === "open" ? "对手猜测" : "猜测状态"}
              </TableHead>
              {ATTRIBUTES.map(([label]) => (
                <TableHead
                  key={label}
                  className="border-r border-foreground/15 text-center last:border-r-0"
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((attempt, index) => {
              const player =
                visibility === "open" && attempt?.guessedPlayerId
                  ? catalogPlayers.find(
                      (candidate) => candidate.id === attempt.guessedPlayerId,
                    )
                  : undefined;
              return (
                <TableRow
                  key={`${attempt?.guessedPlayerId ?? "hidden"}-${index}`}
                  className={cn(
                    "h-15 border-foreground/15 hover:bg-primary/[0.025]",
                    index >= mobileVisibleRows && "hidden sm:table-row",
                  )}
                >
                  <TableCell className="border-r border-foreground/15 text-center font-mono text-xs">
                    {index + 1}
                  </TableCell>
                  <TableCell className="border-r border-foreground/15">
                    {attempt ? (
                      player ? (
                        <div className="min-w-0">
                          <p
                            className="truncate text-sm font-semibold"
                            title={player.nickname}
                          >
                            {player.nickname}
                          </p>
                          <p
                            className="mt-0.5 truncate text-xs text-muted-foreground"
                            title={player.name}
                          >
                            {player.name}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs">
                          <EyeSlashIcon className="size-3.5 text-primary" />
                          <span>已提交，内容隐藏</span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground/50">
                        {forfeitedThisRound ? "本轮已判负" : "等待对手"}
                      </span>
                    )}
                  </TableCell>
                  {ATTRIBUTES.map((attribute) => {
                    const matched = attempt?.matchedFields.includes(attribute[2]);
                    const countryRelation =
                      attribute[1] === "countryCode"
                        ? attempt?.countryRelation
                        : undefined;
                    const near = countryRelation === "near";
                    return (
                      <TableCell
                        key={attribute[0]}
                        className="border-r border-foreground/15 px-2 text-center last:border-r-0"
                      >
                        {attempt ? (
                          player ? (
                            attribute[1] === "team" ? (
                              <TeamComparisonValue
                                player={player}
                                comparison={comparisonFor(
                                  player,
                                  mysteryPlayer,
                                  attribute,
                                  attempt.matchedFields,
                                )}
                              />
                            ) : attribute[1] === "countryCode" ? (
                              <CountryComparisonValue
                                countryCode={player.countryCode}
                                targetCountryCode={mysteryPlayer.countryCode}
                                hint={
                                  attempt.countryRelation
                                    ? {
                                        relation: attempt.countryRelation,
                                        distanceKm:
                                          attempt.countryDistanceKm ?? null,
                                      }
                                    : undefined
                                }
                              />
                            ) : (
                              <ComparisonValue
                                value={
                                  attribute[1] === "role"
                                    ? playerRoleNameZh(player.role)
                                    : player[attribute[1]]
                                }
                                valueIcon={
                                  attribute[1] === "role" ? (
                                    <PlayerRoleIcon role={player.role} />
                                  ) : undefined
                                }
                                comparison={comparisonFor(
                                  player,
                                  mysteryPlayer,
                                  attribute,
                                  attempt.matchedFields,
                                )}
                              />
                            )
                          ) : (
                            <span
                              className={cn(
                                "inline-flex size-7 items-center justify-center",
                                matched
                                  ? "text-primary"
                                  : near
                                    ? "text-primary/75"
                                    : "text-muted-foreground/45",
                              )}
                              title={
                                matched
                                  ? `${attribute[0]}命中`
                                  : near
                                    ? "国籍同洲接近"
                                    : `${attribute[0]}未命中`
                              }
                              aria-label={
                                matched
                                  ? `${attribute[0]}命中`
                                  : near
                                    ? "国籍同洲接近"
                                    : `${attribute[0]}未命中`
                              }
                            >
                              {matched ? (
                                <CheckIcon className="size-3.5" weight="bold" />
                              ) : near ? (
                                <CircleIcon className="size-3" weight="duotone" />
                              ) : (
                                <CircleIcon className="size-2.5" weight="fill" />
                              )}
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function MultiplayerGuessBoards({
  guesses,
  maxGuesses,
  mysteryPlayer,
  selfName,
  ownMatchedFields,
  ownCountryHints,
  opponents,
  opponentVisibility,
}: {
  guesses: readonly Player[];
  maxGuesses: number;
  mysteryPlayer: Player;
  selfName: string;
  ownMatchedFields?: readonly (readonly string[])[];
  ownCountryHints?: readonly CountryHint[];
  opponents: readonly OpponentBoardData[];
  opponentVisibility: OpponentVisibility;
}) {
  const tabsId = useId();
  const [activeOpponentId, setActiveOpponentId] = useState(
    () => opponents[0]?.id,
  );
  const activeIndex = Math.max(
    0,
    opponents.findIndex((opponent) => opponent.id === activeOpponentId),
  );

  function moveOpponentTab(
    event: KeyboardEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) {
    event.preventDefault();
    const nextIndex =
      (activeIndex + direction + opponents.length) % opponents.length;
    const next = opponents[nextIndex];
    if (!next) return;
    setActiveOpponentId(next.id);
    document
      .getElementById(`${tabsId}-tab-${next.id}`)
      ?.focus({ preventScroll: true });
  }

  return (
    <>
      <div
        className="mb-3 grid grid-cols-3 border border-foreground/25"
        role="tablist"
        aria-label="选择要查看的对手"
      >
        {opponents.map((opponent, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={opponent.id}
              id={`${tabsId}-tab-${opponent.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${opponent.id}`}
              tabIndex={selected ? 0 : -1}
              className={cn(
                "min-w-0 border-r border-foreground/20 px-3 py-2.5 text-left last:border-r-0",
                "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-primary/[0.04]",
              )}
              onClick={() => setActiveOpponentId(opponent.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  moveOpponentTab(event, 1);
                } else if (event.key === "ArrowLeft") {
                  moveOpponentTab(event, -1);
                }
              }}
            >
              <span className="block truncate text-xs font-semibold">
                对手 {index + 1}
              </span>
              <span
                className={cn(
                  "mt-0.5 block truncate font-mono text-[10px]",
                  selected
                    ? "text-primary-foreground/75"
                    : "text-muted-foreground",
                )}
              >
                {opponent.name.replace(/^对手 \d+ · /, "")} ·{" "}
                {opponent.progress.length}/{maxGuesses}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid min-w-0 gap-4 min-[1400px]:grid-cols-2">
        <GuessBoard
          title={`${selfName} · 我的猜测`}
          guesses={guesses}
          maxGuesses={maxGuesses}
          mysteryPlayer={mysteryPlayer}
          matchedFields={ownMatchedFields}
          countryHints={ownCountryHints}
        />
        {opponents.map((opponent, index) => (
          <div
            key={opponent.id}
            id={`${tabsId}-panel-${opponent.id}`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${opponent.id}`}
            hidden={index !== activeIndex}
            className="min-w-0"
          >
            <OpponentBoard
              title={`${opponent.name} · 对手进度`}
              progress={opponent.progress}
              visibility={opponentVisibility}
              maxGuesses={maxGuesses}
              mysteryPlayer={mysteryPlayer}
              disconnectSeconds={opponent.disconnectSeconds}
              forfeitedThisRound={opponent.forfeitedThisRound}
            />
          </div>
        ))}
      </div>
    </>
  );
}

export function GuessTable({
  guesses,
  opponentGuesses,
  opponentVisibility,
  mysteryPlayer,
  mode,
  maxGuesses,
  selfName = "自己",
  opponentName = "对手",
  ownMatchedFields,
  ownCountryHints,
  opponentProgress,
  opponents,
  onOpponentVisibilityChange,
  opponentDisconnectSeconds,
  opponentForfeitedThisRound = false,
}: GuessTableProps) {
  if (mode === "daily" || mode === "solo") {
    return (
      <GuessBoard
        title="我的猜测"
        guesses={guesses}
        maxGuesses={maxGuesses}
        mysteryPlayer={mysteryPlayer}
        matchedFields={ownMatchedFields}
        countryHints={ownCountryHints}
      />
    );
  }

  const normalizedProgress: OpponentGuessProgress[] = opponentProgress
    ? [...opponentProgress]
    : opponentGuesses.map((player) => ({
        guessedPlayerId: player.id,
        matchedFields: [],
      }));

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-col justify-between gap-3 border-y border-foreground/15 py-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="rounded-none">
            {opponentVisibility === "open" ? <EyeIcon /> : <EyeSlashIcon />}
            {opponentVisibility === "open" ? "明牌模式" : "隐藏模式"}
          </Badge>
          <InfoTip label="查看可见性规则" side="right" className="size-10">
            {opponentVisibility === "open"
              ? "所有玩家都能看到彼此猜测的具体选手。"
              : "只公开对手命中的属性，不显示具体猜测选手。"}
          </InfoTip>
        </div>
        {onOpponentVisibilityChange ? (
          <div
            className="inline-flex w-fit border border-foreground/25"
            role="group"
            aria-label="对手信息显示方式"
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "rounded-none border-r border-foreground/20 px-3 text-xs",
                opponentVisibility === "hidden" &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
              aria-pressed={opponentVisibility === "hidden"}
              onClick={() => onOpponentVisibilityChange("hidden")}
            >
              <EyeSlashIcon />
              隐藏猜测
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "rounded-none px-3 text-xs",
                opponentVisibility === "open" &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
              aria-pressed={opponentVisibility === "open"}
              onClick={() => onOpponentVisibilityChange("open")}
            >
              <EyeIcon />
              明牌
            </Button>
          </div>
        ) : null}
      </div>

      {opponents && opponents.length > 1 ? (
        <MultiplayerGuessBoards
          guesses={guesses}
          maxGuesses={maxGuesses}
          mysteryPlayer={mysteryPlayer}
          selfName={selfName}
          ownMatchedFields={ownMatchedFields}
          ownCountryHints={ownCountryHints}
          opponents={opponents}
          opponentVisibility={opponentVisibility}
        />
      ) : (
        <div className="grid min-w-0 gap-4 min-[1400px]:grid-cols-2">
          <GuessBoard
            title={`${selfName} · 我的猜测`}
            guesses={guesses}
            maxGuesses={maxGuesses}
            mysteryPlayer={mysteryPlayer}
            matchedFields={ownMatchedFields}
            countryHints={ownCountryHints}
          />
          <OpponentBoard
            title={`${opponentName} · 对手进度`}
            progress={normalizedProgress}
            visibility={opponentVisibility}
            maxGuesses={maxGuesses}
            mysteryPlayer={mysteryPlayer}
            disconnectSeconds={opponentDisconnectSeconds}
            forfeitedThisRound={opponentForfeitedThisRound}
          />
        </div>
      )}
    </div>
  );
}
