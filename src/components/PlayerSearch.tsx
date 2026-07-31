import { t } from "@lingui/core/macro";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CrosshairSimpleIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { Player } from "@/data/players";
import { countryNameZh } from "@/lib/country-geography";
import { displayTeamName } from "@/lib/player-display";
import {
  completionSuffix,
  movePlayerHighlight,
  searchPlayers,
} from "@/lib/player-search";

interface PlayerSearchProps {
  players: readonly Player[];
  selectedPlayer?: Player;
  query?: string;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange?: (query: string) => void;
  onSelect: (playerId: string) => void;
  onSubmit: (
    playerId?: string,
  ) => boolean | void | Promise<boolean | void>;
}

type HighlightInteraction = "none" | "pointer" | "keyboard";

const NO_COMMAND_SELECTION = "__player-search-no-selection__";

export function PlayerSearch({
  players,
  selectedPlayer,
  query: controlledQuery,
  open,
  disabled,
  onOpenChange,
  onQueryChange,
  onSelect,
  onSubmit,
}: PlayerSearchProps) {
  const searchRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [internalQuery, setInternalQuery] = useState("");
  const query = controlledQuery ?? internalQuery;
  const isQueryControlled = controlledQuery !== undefined;
  const [highlightedId, setHighlightedId] = useState<string>();
  const [highlightInteraction, setHighlightInteraction] =
    useState<HighlightInteraction>("none");
  const [activeOptionDomId, setActiveOptionDomId] = useState<string>();
  const highlightInteractionRef = useRef<HighlightInteraction>("none");
  const pendingCommandInteractionRef = useRef<
    Exclude<HighlightInteraction, "none"> | undefined
  >(undefined);
  const highlightQueryRef = useRef("");
  const [isComposing, setIsComposing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionPendingRef = useRef(false);
  const submissionGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const isComposingRef = useRef(false);
  const restoringSelectionFocusRef = useRef(false);
  const pendingCompositionInputRef = useRef<string | undefined>(undefined);
  const hasConfirmedSelection =
    selectedPlayer !== undefined &&
    query.trim().toLocaleLowerCase() ===
      selectedPlayer.nickname.toLocaleLowerCase();
  const visiblePlayers = useMemo(() => {
    if (isComposing) return [];
    return searchPlayers(players, query);
  }, [isComposing, players, query]);
  const highlightedPlayer =
    highlightInteraction !== "none" &&
    highlightQueryRef.current === query
      ? visiblePlayers.find((player) => player.id === highlightedId)
      : undefined;
  const effectiveHighlightedId = highlightedPlayer?.id;
  const highlightedCompletion = highlightedPlayer
    ? completionSuffix(query, highlightedPlayer.nickname)
    : "";
  const completion = highlightedPlayer
    ? highlightedCompletion
      ? t`${highlightedCompletion}  ⇥ 补全`
      : t`  ↵ 提交`
    : "";
  const listboxVisible =
    open &&
    !disabled &&
    !isSubmitting &&
    !isComposing &&
    query.trim().length > 0;
  const noResultsAnnouncement =
    listboxVisible && visiblePlayers.length === 0
      ? t`没有找到与“${query.trim()}”匹配的选手`
      : "";
  const activeOptionId =
    listboxVisible && effectiveHighlightedId ? activeOptionDomId : undefined;

  function clearHighlight() {
    highlightInteractionRef.current = "none";
    pendingCommandInteractionRef.current = undefined;
    highlightQueryRef.current = "";
    setHighlightedId(undefined);
    setHighlightInteraction("none");
  }

  function commitHighlight(
    playerId: string,
    interaction: Exclude<HighlightInteraction, "none">,
  ) {
    if (!visiblePlayers.some((player) => player.id === playerId)) {
      clearHighlight();
      return;
    }
    highlightInteractionRef.current = interaction;
    highlightQueryRef.current = query;
    setHighlightedId(playerId);
    setHighlightInteraction(interaction);
  }

  function syncOptionDomState(selectedId?: string) {
    const options = Array.from(
      searchRef.current?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [],
    );
    for (const option of options) {
      const selected = option.dataset.value === selectedId;
      option.setAttribute("aria-selected", String(selected));
      if (selected) {
        option.setAttribute("data-selected", "true");
      } else {
        option.removeAttribute("data-selected");
      }
    }
    return options;
  }

  useEffect(() => {
    if (
      highlightInteraction === "none" ||
      highlightQueryRef.current !== query ||
      !visiblePlayers.some((player) => player.id === highlightedId)
    ) {
      if (highlightInteraction !== "none" || highlightedId !== undefined) {
        clearHighlight();
      }
    }
  }, [highlightInteraction, highlightedId, query, visiblePlayers]);

  useLayoutEffect(() => {
    const options = syncOptionDomState(effectiveHighlightedId);
    if (!listboxVisible || !effectiveHighlightedId) {
      setActiveOptionDomId(undefined);
      return;
    }
    const option = options.find(
      (item) => item.dataset.value === effectiveHighlightedId,
    );
    setActiveOptionDomId(option?.id);
    if (highlightInteraction === "keyboard") {
      option?.scrollIntoView({ block: "nearest" });
    }
  }, [effectiveHighlightedId, highlightInteraction, listboxVisible]);

  useEffect(() => {
    if (!isQueryControlled) {
      setInternalQuery(selectedPlayer?.nickname ?? "");
    }
    clearHighlight();
  }, [
    isQueryControlled,
    selectedPlayer?.id,
    selectedPlayer?.nickname,
  ]);

  useEffect(() => {
    const firstPlayer = visiblePlayers[0];
    if (!listboxVisible || !firstPlayer) return;
    if (
      highlightInteractionRef.current !== "none" &&
      highlightQueryRef.current === query &&
      visiblePlayers.some((player) => player.id === highlightedId)
    ) {
      return;
    }

    highlightInteractionRef.current = "keyboard";
    highlightQueryRef.current = query;
    setHighlightedId(firstPlayer.id);
    setHighlightInteraction("keyboard");
  }, [highlightedId, listboxVisible, query, visiblePlayers]);

  useEffect(() => {
    if (!open) return;

    const closeWhenOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !searchRef.current?.contains(event.target)
      ) {
        onOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!disabled || isSubmitting) return;
    isComposingRef.current = false;
    pendingCompositionInputRef.current = undefined;
    setIsComposing(false);
    clearHighlight();
    if (open) onOpenChange(false);
  }, [disabled, isSubmitting, onOpenChange, open]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submissionGenerationRef.current += 1;
      submissionPendingRef.current = false;
    };
  }, []);

  function updateQuery(value: string) {
    if (disabled) return;
    if (!isQueryControlled) setInternalQuery(value);
    onQueryChange?.(value);
  }

  function handleQueryChange(value: string) {
    if (disabled) return;
    updateQuery(value);

    if (isComposingRef.current) {
      if (open) onOpenChange(false);
      return;
    }

    if (pendingCompositionInputRef.current === value) {
      pendingCompositionInputRef.current = undefined;
      return;
    }

    clearHighlight();
    onOpenChange(value.trim().length > 0);
  }

  function handleCompositionStart() {
    if (disabled) return;
    isComposingRef.current = true;
    pendingCompositionInputRef.current = undefined;
    setIsComposing(true);
    if (open) onOpenChange(false);
  }

  function handleCompositionEnd(value: string) {
    if (disabled) return;
    isComposingRef.current = false;
    setIsComposing(false);
    pendingCompositionInputRef.current = value;
    queueMicrotask(() => {
      if (pendingCompositionInputRef.current === value) {
        pendingCompositionInputRef.current = undefined;
      }
    });
    updateQuery(value);
    clearHighlight();
    onOpenChange(value.trim().length > 0);
  }

  function restoreInputFocus(afterCommit = false) {
    const focus = () => {
      const input =
        searchRef.current?.querySelector<HTMLInputElement>(
          '[data-slot="command-input"]',
        );
      if (!input || input.disabled) return;
      restoringSelectionFocusRef.current = true;
      input.focus({ preventScroll: true });
      restoringSelectionFocusRef.current = false;
    };
    if (afterCommit) {
      window.setTimeout(focus, 0);
      return;
    }
    queueMicrotask(focus);
  }

  function handleSelect(player: Player) {
    if (disabled || isComposingRef.current) return;
    updateQuery(player.nickname);
    clearHighlight();
    onSelect(player.id);
    onOpenChange(false);
    restoreInputFocus();
  }

  function moveHighlight(direction: -1 | 1) {
    if (disabled || isComposingRef.current) return;
    const nextId = movePlayerHighlight(
      visiblePlayers.map((player) => player.id),
      effectiveHighlightedId,
      direction,
    );
    if (!nextId) return;

    commitHighlight(nextId, "keyboard");
    onOpenChange(true);
  }

  async function runSubmission(playerId: string) {
    if (
      disabled ||
      submissionPendingRef.current ||
      isComposingRef.current
    ) {
      return;
    }

    const generation = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = generation;
    submissionPendingRef.current = true;
    setIsSubmitting(true);
    let accepted = false;
    try {
      accepted = (await onSubmit(playerId)) !== false;
    } catch {
      accepted = false;
    }
    if (
      !mountedRef.current ||
      submissionGenerationRef.current !== generation
    ) {
      return;
    }
    submissionPendingRef.current = false;
    setIsSubmitting(false);
    if (!accepted) return;

    updateQuery("");
    clearHighlight();
    onOpenChange(false);
    restoreInputFocus(true);
  }

  function submitHighlightedPlayer() {
    if (!highlightedPlayer || disabled || isComposingRef.current) {
      return false;
    }

    void runSubmission(highlightedPlayer.id);
    return true;
  }

  return (
    <div
      data-slot="player-search"
      className="grid w-full min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div ref={searchRef} className="relative min-w-0">
        <Command
          aria-disabled={disabled || isSubmitting || undefined}
          shouldFilter={false}
          value={effectiveHighlightedId ?? NO_COMMAND_SELECTION}
          onValueChange={(value) => {
            if (disabled || isSubmitting) return;
            const pendingInteraction =
              pendingCommandInteractionRef.current;
            pendingCommandInteractionRef.current = undefined;
            if (pendingInteraction) {
              commitHighlight(value, pendingInteraction);
              return;
            }
            if (
              highlightInteractionRef.current === "none" ||
              highlightQueryRef.current !== query ||
              !effectiveHighlightedId
            ) {
              queueMicrotask(() => syncOptionDomState(undefined));
              return;
            }
            commitHighlight(value, highlightInteractionRef.current);
          }}
          className="h-auto overflow-visible rounded-none! bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-16! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-foreground/30 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none!"
        >
          <CommandInput
            value={query}
            completion={completion}
            completionClassName="px-1"
            onValueChange={handleQueryChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={(event) => {
              handleCompositionEnd(event.currentTarget.value);
            }}
            onFocus={() => {
              if (
                disabled ||
                isSubmitting ||
                isComposingRef.current
              ) {
                return;
              }
              if (restoringSelectionFocusRef.current) return;
              if (query.trim()) onOpenChange(true);
            }}
            onClick={() => {
              if (
                disabled ||
                isSubmitting ||
                isComposingRef.current
              ) {
                return;
              }
              if (query.trim()) onOpenChange(true);
            }}
            onKeyDownCapture={(event) => {
              if (disabled || isSubmitting) return;
              if (event.nativeEvent.isComposing || isComposingRef.current) {
                return;
              }

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                moveHighlight(event.key === "ArrowDown" ? 1 : -1);
                return;
              }

              if (
                event.key === "Tab" &&
                highlightedPlayer &&
                highlightedCompletion
              ) {
                event.preventDefault();
                event.stopPropagation();
                handleSelect(highlightedPlayer);
                return;
              }

              if (event.key === "Enter") {
                if (submitHighlightedPlayer()) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (hasConfirmedSelection && selectedPlayer && !disabled) {
                  event.preventDefault();
                  event.stopPropagation();
                  void runSubmission(selectedPlayer.id);
                  return;
                }
              }

              if (event.key === "Escape") {
                clearHighlight();
                onOpenChange(false);
              }
            }}
            disabled={disabled || isSubmitting}
            aria-expanded={listboxVisible}
            aria-controls={listboxVisible ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="both"
            aria-label={t`搜索并选择猜测选手`}
            placeholder={t`搜索选手昵称、姓名、战队或国家`}
            className="px-1 text-base"
          />
          {listboxVisible ? (
            <CommandList
              id={listboxId}
              className="relative z-20 mt-2 max-h-[min(20rem,45vh)] w-full border border-foreground/30 bg-popover shadow-xl sm:absolute sm:inset-x-0 sm:top-[calc(100%+0.5rem)] sm:z-50 sm:mt-0 sm:max-h-96"
            >
              <CommandEmpty aria-hidden="true">
                {t`没有找到这名选手`}
              </CommandEmpty>
              <CommandGroup heading={t`搜索结果`}>
                {visiblePlayers.map((player) => (
                  <CommandItem
                    key={player.id}
                    value={player.id}
                    disabled={disabled}
                    aria-disabled={disabled || undefined}
                    aria-selected={effectiveHighlightedId === player.id}
                    onMouseEnter={() => {
                      if (
                        disabled ||
                        isSubmitting ||
                        isComposingRef.current
                      ) {
                        return;
                      }
                      pendingCommandInteractionRef.current = "pointer";
                      commitHighlight(player.id, "pointer");
                      queueMicrotask(() => {
                        if (
                          pendingCommandInteractionRef.current === "pointer"
                        ) {
                          pendingCommandInteractionRef.current = undefined;
                        }
                      });
                    }}
                    onSelect={() => handleSelect(player)}
                    className="min-h-13 rounded-none px-3 py-2.5"
                  >
                    <PlayerAvatar player={player} className="size-9" />
                    <span className="w-14 truncate text-xs text-muted-foreground">
                      {countryNameZh(player.countryCode)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {player.nickname}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {player.name} · {displayTeamName(player.team)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          ) : null}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {noResultsAnnouncement}
          </div>
        </Command>
      </div>

      <Button
        className="h-16 min-w-30 gap-2 rounded-none px-8 text-center font-semibold shadow-none"
        onClick={() => {
          if (selectedPlayer) void runSubmission(selectedPlayer.id);
        }}
        disabled={!hasConfirmedSelection || disabled || isSubmitting}
        aria-busy={isSubmitting || undefined}
      >
        <CrosshairSimpleIcon className="size-4" aria-hidden="true" />
        <span>{t`提交猜测`}</span>
      </Button>
    </div>
  );
}
