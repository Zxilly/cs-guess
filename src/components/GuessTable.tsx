import { t } from "@lingui/core/macro";
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleIcon,
  EyeIcon,
  EyeSlashIcon,
  LinkSimpleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
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
import { displayTeamName } from "@/lib/player-display";
import { compareTeams } from "@/lib/team-relation";
import { cn } from "@/lib/utils";
import type {
  CountryHint,
  GameMode,
  OpponentGuessProgress,
  OpponentVisibility,
  TeamRelation,
} from "@/types/game";

interface GuessTableProps {
  guesses: readonly Player[];
  opponentGuesses: readonly Player[];
  opponentVisibility: OpponentVisibility;
  mysteryPlayer: Player;
  mode: GameMode;
  maxGuesses: number;
  ownMatchedFields?: readonly (readonly string[])[];
  ownTeamRelations?: readonly (TeamRelation | undefined)[];
  ownCountryHints?: readonly CountryHint[];
  opponentProgress?: readonly OpponentGuessProgress[];
  opponents?: readonly OpponentBoardData[];
  onOpponentVisibilityChange?: (visibility: OpponentVisibility) => void;
  opponentDisconnectSeconds?: number | null;
  opponentForfeitedThisRound?: boolean;
  showProgressCount?: boolean;
}

interface OpponentBoardData {
  id: string;
  name: string;
  progress: readonly OpponentGuessProgress[];
  disconnectSeconds?: number | null;
  forfeitedThisRound?: boolean;
}

type Comparison = "match" | "higher" | "lower" | "miss";

const TEAM_RELATION_DETAILS: Record<
  TeamRelation,
  { label: string; shortLabel: string; icon: Icon }
> = {
  match: {
    label: t`当前战队完全一致`,
    shortLabel: t`当前同队`,
    icon: CheckIcon,
  },
  target_history: {
    label: t`猜测选手的当前战队，是答案曾经效力过的战队`,
    shortLabel: t`答案曾效力`,
    icon: ArrowRightIcon,
  },
  guess_history: {
    label: t`答案的当前战队，是猜测选手曾经效力过的战队`,
    shortLabel: t`猜测曾效力`,
    icon: ArrowLeftIcon,
  },
  shared_history: {
    label: t`猜测选手和答案曾经效力过的战队有重叠`,
    shortLabel: t`共同历史队`,
    icon: LinkSimpleIcon,
  },
  miss: {
    label: t`战队未命中`,
    shortLabel: t`未命中`,
    icon: CircleIcon,
  },
};

const ATTRIBUTES = [
  [t`战队`, "team", "team"],
  [t`国籍`, "countryCode", "nationality"],
  [t`年龄`, "age", "age"],
  [t`位置`, "role", "role"],
  [t`Major 参赛`, "majorAppearances", "major_appearances"],
  [t`Major 冠军`, "majorWins", "major_wins"],
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
      ? t`目标数值更高`
      : comparison === "lower"
        ? t`目标数值更低`
        : comparison === "match"
          ? t`完全一致`
          : t`未命中`;

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
  relation,
}: {
  player: Player;
  relation: TeamRelation;
}) {
  const details = TEAM_RELATION_DETAILS[relation];
  const RelationIcon = details.icon;
  const teamName = displayTeamName(player.team);
  const isHistoricalRelation =
    relation === "target_history" ||
    relation === "guess_history" ||
    relation === "shared_history";

  return (
    <span
      className={cn(
        "mx-auto flex max-w-full flex-col items-center justify-center",
        relation === "match" && "font-semibold text-primary",
        isHistoricalRelation && "font-semibold text-comparison-near",
        relation === "miss" && "text-muted-foreground",
      )}
      title={`${teamName}，${details.label}`}
      aria-label={`${teamName}，${details.label}`}
    >
      <span className="flex min-w-0 max-w-full items-center justify-center gap-1.5">
        <TeamLogo name={teamName} src={player.teamLogoUrl} />
        <span className="min-w-0 truncate font-mono text-xs">{teamName}</span>
      </span>
      {isHistoricalRelation ? (
        <span className="mt-1 inline-flex max-w-full items-center gap-1 border border-comparison-near/35 bg-comparison-near/8 px-1.5 py-0.5 font-sans text-[10px] leading-none">
          <RelationIcon className="size-3 shrink-0" weight="bold" />
          <span className="truncate">{details.shortLabel}</span>
        </span>
      ) : null}
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
      ? t`命中`
      : comparison.relation === "near"
        ? t`同洲接近`
        : t`不同洲`;
  const distanceLabel = formatCountryDistance(comparison.distanceKm);
  const comparisonLabel = t`${countryNameZh(countryCode)}，${relationLabel}${
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
  if (
    key === "age" ||
    key === "majorAppearances" ||
    key === "majorWins"
  ) {
    return compareNumber(
      player[key] as number,
      mysteryPlayer[key] as number,
    );
  }
  return player[key] === mysteryPlayer[key] ? "match" : "miss";
}

function teamRelationFor(
  player: Player,
  mysteryPlayer: Player,
  matchedFields?: readonly string[],
  relation?: TeamRelation,
): TeamRelation {
  if (relation) return relation;
  if (matchedFields?.includes("team")) return "match";
  return compareTeams(player, mysteryPlayer);
}

function GuessBoard({
  title,
  guesses,
  maxGuesses,
  mysteryPlayer,
  matchedFields,
  teamRelations,
  countryHints,
  showCount = true,
}: {
  title: string;
  guesses: readonly Player[];
  maxGuesses: number;
  mysteryPlayer: Player;
  matchedFields?: readonly (readonly string[])[];
  teamRelations?: readonly (TeamRelation | undefined)[];
  countryHints?: readonly CountryHint[];
  showCount?: boolean;
}) {
  const rows = Array.from({ length: maxGuesses }, (_, index) => guesses[index]);
  const mobileVisibleRows = Math.min(maxGuesses, guesses.length + 1);
  return (
    <section className="min-w-0 border border-foreground/25">
      <div className="flex items-baseline justify-between border-b border-foreground/20 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {showCount ? (
          <p className="font-mono text-xs text-muted-foreground">
            {guesses.length} / {maxGuesses}
          </p>
        ) : null}
      </div>
      <p className="border-b border-foreground/15 px-4 py-2 text-xs text-muted-foreground sm:hidden">
        {t`横向滑动查看全部属性 →`}
      </p>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        role="region"
        aria-label={t`${title}，横向滚动查看更多属性`}
        tabIndex={0}
      >
        <Table className="min-w-[44rem] table-fixed">
          <TableHeader>
            <TableRow className="border-foreground/20 hover:bg-transparent">
              <TableHead className="w-10 border-r border-foreground/15 text-center">
                #
              </TableHead>
              <TableHead className="w-34 border-r border-foreground/15">
                {t`猜测选手`}
              </TableHead>
              {ATTRIBUTES.map(([label]) => (
                <TableHead
                  key={label}
                  className="h-12 whitespace-normal border-r border-foreground/15 px-1 text-center text-xs leading-tight last:border-r-0"
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
                      {t`等待猜测`}
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
                          relation={teamRelationFor(
                            player,
                            mysteryPlayer,
                            matchedFields?.[index],
                            teamRelations?.[index],
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
  showCount = true,
}: {
  title: string;
  progress: readonly OpponentGuessProgress[];
  visibility: OpponentVisibility;
  maxGuesses: number;
  mysteryPlayer: Player;
  disconnectSeconds?: number | null;
  forfeitedThisRound?: boolean;
  showCount?: boolean;
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
                {t`重连 00:`}{String(disconnectSeconds).padStart(2, "0")} {t`· 超时判负`}
              </p>
            </>
          ) : null}
          {forfeitedThisRound ? (
            <p className="mt-1 text-xs font-medium text-destructive">
              {t`在线 · 本轮已判负`}
            </p>
          ) : null}
        </div>
        {showCount ? (
          <p className="shrink-0 font-mono text-xs text-muted-foreground">
            {progress.length} / {maxGuesses}
          </p>
        ) : null}
      </div>
      <p className="border-b border-foreground/15 px-4 py-2 text-xs text-muted-foreground sm:hidden">
        {t`横向滑动查看全部属性 →`}
      </p>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        role="region"
        aria-label={t`${title}，横向滚动查看更多属性`}
        tabIndex={0}
      >
        <Table className="min-w-[44rem] table-fixed">
          <TableHeader>
            <TableRow className="border-foreground/20 hover:bg-transparent">
              <TableHead className="w-10 border-r border-foreground/15 text-center">
                #
              </TableHead>
              <TableHead className="w-34 border-r border-foreground/15">
                {visibility === "open" ? t`对手猜测` : t`猜测状态`}
              </TableHead>
              {ATTRIBUTES.map(([label]) => (
                <TableHead
                  key={label}
                  className="h-12 whitespace-normal border-r border-foreground/15 px-1 text-center text-xs leading-tight last:border-r-0"
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
                          <span>{t`已提交，内容隐藏`}</span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground/50">
                        {forfeitedThisRound ? t`本轮已判负` : t`等待对手`}
                      </span>
                    )}
                  </TableCell>
                  {ATTRIBUTES.map((attribute) => {
                    const matched = attempt?.matchedFields.includes(attribute[2]);
                    const countryRelation =
                      attribute[1] === "countryCode"
                        ? attempt?.countryRelation
                        : undefined;
                    const teamRelation =
                      attribute[1] === "team"
                        ? attempt?.teamRelation
                        : undefined;
                    const isHistoricalTeamRelation =
                      teamRelation === "target_history" ||
                      teamRelation === "guess_history" ||
                      teamRelation === "shared_history";
                    const cellMatched =
                      matched || teamRelation === "match";
                    const near =
                      countryRelation === "near" ||
                      isHistoricalTeamRelation;
                    const teamDetails = teamRelation
                      ? TEAM_RELATION_DETAILS[teamRelation]
                      : undefined;
                    const nearLabel = isHistoricalTeamRelation
                      ? teamDetails?.label
                      : t`国籍同洲接近`;
                    const NearIcon =
                      isHistoricalTeamRelation && teamDetails
                        ? teamDetails.icon
                        : CircleIcon;
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
                                relation={teamRelationFor(
                                  player,
                                  mysteryPlayer,
                                  attempt.matchedFields,
                                  attempt.teamRelation,
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
                                "inline-flex min-h-7 items-center justify-center",
                                cellMatched
                                  ? "text-primary"
                                  : near
                                    ? "text-primary/75"
                                    : "text-muted-foreground/45",
                              )}
                              title={
                                cellMatched
                                  ? t`${attribute[0]}命中`
                                  : near
                                    ? nearLabel
                                    : t`${attribute[0]}未命中`
                              }
                              aria-label={
                                cellMatched
                                  ? t`${attribute[0]}命中`
                                  : near
                                    ? nearLabel
                                    : t`${attribute[0]}未命中`
                              }
                            >
                              {cellMatched ? (
                                <CheckIcon className="size-3.5" weight="bold" />
                              ) : isHistoricalTeamRelation && teamDetails ? (
                                <span className="inline-flex items-center gap-1 border border-comparison-near/35 bg-comparison-near/8 px-1.5 py-1 text-[10px] leading-none text-comparison-near">
                                  <NearIcon
                                    className="size-3 shrink-0"
                                    weight="bold"
                                  />
                                  <span>{teamDetails.shortLabel}</span>
                                </span>
                              ) : near ? (
                                <NearIcon
                                  className="size-3"
                                  weight="duotone"
                                />
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
  ownMatchedFields,
  ownTeamRelations,
  ownCountryHints,
  opponents,
  opponentVisibility,
}: {
  guesses: readonly Player[];
  maxGuesses: number;
  mysteryPlayer: Player;
  ownMatchedFields?: readonly (readonly string[])[];
  ownTeamRelations?: readonly (TeamRelation | undefined)[];
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
        aria-label={t`选择要查看的对手`}
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
                {t`对手`} {index + 1}
              </span>
              <span
                className={cn(
                  "mt-0.5 block truncate font-mono text-[10px]",
                  selected
                    ? "text-primary-foreground/75"
                    : "text-muted-foreground",
                )}
              >
                {opponent.name.replace(/^对手 \d+ · /, "")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid min-w-0 gap-4 min-[1400px]:grid-cols-2">
        <GuessBoard
          title={t`我的猜测`}
          guesses={guesses}
          maxGuesses={maxGuesses}
          mysteryPlayer={mysteryPlayer}
          matchedFields={ownMatchedFields}
          teamRelations={ownTeamRelations}
          countryHints={ownCountryHints}
          showCount={false}
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
              title={t`对手进度`}
              progress={opponent.progress}
              visibility={opponentVisibility}
              maxGuesses={maxGuesses}
              mysteryPlayer={mysteryPlayer}
              disconnectSeconds={opponent.disconnectSeconds}
              forfeitedThisRound={opponent.forfeitedThisRound}
              showCount={false}
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
  ownMatchedFields,
  ownTeamRelations,
  ownCountryHints,
  opponentProgress,
  opponents,
  onOpponentVisibilityChange,
  opponentDisconnectSeconds,
  opponentForfeitedThisRound = false,
  showProgressCount = true,
}: GuessTableProps) {
  if (mode === "daily" || mode === "solo") {
    return (
      <GuessBoard
        title={t`我的猜测`}
        guesses={guesses}
        maxGuesses={maxGuesses}
        mysteryPlayer={mysteryPlayer}
        matchedFields={ownMatchedFields}
        teamRelations={ownTeamRelations}
        countryHints={ownCountryHints}
        showCount={showProgressCount}
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
      {onOpponentVisibilityChange ? (
        <div className="mb-3 flex justify-end border-y border-foreground/15 py-3">
          <div
            className="inline-flex w-fit border border-foreground/25"
            role="group"
            aria-label={t`对手信息显示方式`}
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
              {t`隐藏猜测`}
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
              {t`明牌`}
            </Button>
          </div>
        </div>
      ) : null}

      {opponents && opponents.length > 1 ? (
        <MultiplayerGuessBoards
          guesses={guesses}
          maxGuesses={maxGuesses}
          mysteryPlayer={mysteryPlayer}
          ownMatchedFields={ownMatchedFields}
          ownTeamRelations={ownTeamRelations}
          ownCountryHints={ownCountryHints}
          opponents={opponents}
          opponentVisibility={opponentVisibility}
        />
      ) : (
        <div className="grid min-w-0 gap-4 min-[1400px]:grid-cols-2">
          <GuessBoard
            title={t`我的猜测`}
            guesses={guesses}
            maxGuesses={maxGuesses}
            mysteryPlayer={mysteryPlayer}
            matchedFields={ownMatchedFields}
            teamRelations={ownTeamRelations}
            countryHints={ownCountryHints}
            showCount={false}
          />
          <OpponentBoard
            title={t`对手进度`}
            progress={normalizedProgress}
            visibility={opponentVisibility}
            maxGuesses={maxGuesses}
            mysteryPlayer={mysteryPlayer}
            disconnectSeconds={opponentDisconnectSeconds}
            forfeitedThisRound={opponentForfeitedThisRound}
            showCount={false}
          />
        </div>
      )}
    </div>
  );
}
