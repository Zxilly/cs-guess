import { t } from "@lingui/core/macro";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CrosshairSimpleIcon,
  FireIcon,
  TrophyIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";

import { AppHeader } from "@/components/AppHeader";
import { InfoTip } from "@/components/InfoTip";
import { PageIntro } from "@/components/PageIntro";
import { PanelHeader } from "@/components/PanelHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trackEvent } from "@/lib/analytics";
import {
  loadSoloDifficulty,
  prepareSoloRoundForPlay,
  saveSoloDifficulty,
  SOLO_DIFFICULTIES,
  soloMysteryPool,
  type SoloDifficulty,
} from "@/lib/solo-game";

const difficultyIcons = {
  easy: TrophyIcon,
  full: UsersThreeIcon,
  hard: FireIcon,
} satisfies Record<SoloDifficulty, typeof TrophyIcon>;

export function SoloDifficultyPage() {
  const navigate = useNavigate();
  const [selected, setSelected] =
    useState<SoloDifficulty>(loadSoloDifficulty);
  const options = useMemo(
    () =>
      SOLO_DIFFICULTIES.map((option) => ({
        ...option,
        playerCount: soloMysteryPool(option.id).length,
      })),
    [],
  );
  const selectedOption =
    options.find((option) => option.id === selected) ?? options[0];

  function choose(difficulty: SoloDifficulty) {
    setSelected(difficulty);
    saveSoloDifficulty(difficulty);
  }

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    choose(options[nextIndex].id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[nextIndex]?.focus();
  }

  function start() {
    saveSoloDifficulty(selected);
    prepareSoloRoundForPlay(selected);
    trackEvent("practice-started", { difficulty: selected });
    navigate(`/play/solo?difficulty=${selected}`);
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        subtitle={t`单人练习`}
        action={
          <Button asChild variant="outline" size="sm" className="rounded-none">
            <Link to="/">
              <ArrowLeftIcon />
              {t`模式大厅`}
            </Link>
          </Button>
        }
      />

      <main className="app-main app-main-optical">
        <div className="mx-auto w-full max-w-4xl">
          <PageIntro eyebrow="Solo Practice" title={t`选择练习难度`} />

          <Card className="mt-8 w-full gap-0 rounded-none border-foreground/25 bg-transparent py-0 shadow-none ring-0">
          <PanelHeader
            title={t`题目范围`}
            icon={<CrosshairSimpleIcon className="size-5 text-primary" />}
            action={
              <InfoTip
                label={t`了解难度题池`}
                side="bottom"
                align="end"
                className="size-9"
                contentClassName="w-80 max-w-[calc(100vw-2rem)]"
              >
                <p>
                  <strong>{t`简单：`}</strong>
                  {t`目标来自 Major 冠军或参赛至少 5 次的知名选手。`}
                </p>
                <p className="mt-1">
                  <strong>{t`完整：`}</strong>
                  {t`所有参加过 Major 的选手，包括退役与无队伍选手。`}
                </p>
                <p className="mt-1">
                  <strong>{t`困难：`}</strong>
                  {t`完整职业选手目录，包含未参加过 Major 的选手。`}
                </p>
              </InfoTip>
            }
          />

          <div
            className="grid md:grid-cols-3"
            role="radiogroup"
            aria-label={t`练习难度`}
          >
            {options.map((option, index) => {
              const selectedOption = selected === option.id;
              const DifficultyIcon = difficultyIcons[option.id];
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedOption}
                  tabIndex={selectedOption ? 0 : -1}
                  onClick={() => choose(option.id)}
                  onKeyDown={(event) => moveSelection(event, index)}
                  className={[
                    "group relative flex min-h-32 min-w-0 flex-col items-start justify-between gap-4 px-5 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-7 md:min-h-44 md:gap-8 md:py-6",
                    index > 0
                      ? "border-t border-foreground/20 md:border-t-0 md:border-l"
                      : "",
                    selectedOption
                      ? "bg-primary/[0.055]"
                      : "hover:bg-primary/[0.025]",
                  ].join(" ")}
                >
                  <span className="flex w-full items-start justify-between gap-4">
                    <DifficultyIcon
                      className="size-8 shrink-0 text-primary"
                      weight="light"
                    />
                    {selectedOption ? (
                      <span
                        className="grid size-6 shrink-0 place-items-center border border-primary bg-primary text-primary-foreground"
                        aria-hidden="true"
                      >
                        <CheckIcon className="size-3.5" weight="bold" />
                      </span>
                    ) : null}
                  </span>

                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xl font-semibold">
                        {option.label}
                      </span>
                      {option.recommended ? (
                        <Badge variant="outline" className="rounded-none">
                          {t`推荐`}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-2 block font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
                      {option.poolLabel} · {option.playerCount} {t`人`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 border-t border-foreground/20 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
              {t`已选择 ·`} {selectedOption.label}
            </p>
            <Button
              type="button"
              size="lg"
              className="min-w-44 justify-between rounded-none"
              onClick={start}
            >
              {t`开始练习`}
              <ArrowRightIcon />
            </Button>
          </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
