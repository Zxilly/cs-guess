import { useDeferredValue, useMemo, useState } from "react";
import {
  CaretUpDownIcon,
  CrosshairSimpleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { Player } from "@/data/players";
import { countryNameZh } from "@/lib/country-geography";

interface PlayerSearchProps {
  players: readonly Player[];
  selectedPlayer?: Player;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (playerId: string) => void;
  onSubmit: () => void;
}

export function PlayerSearch({
  players,
  selectedPlayer,
  open,
  disabled,
  onOpenChange,
  onSelect,
  onSubmit,
}: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visiblePlayers = useMemo(() => {
    if (!deferredQuery) return players.slice(0, 12);

    return players
      .filter((player) =>
        [
          player.nickname,
          player.name,
          player.team,
          player.countryCode,
          countryNameZh(player.countryCode),
        ].some((value) => value.toLocaleLowerCase().includes(deferredQuery)),
      )
      .slice(0, 30);
  }, [deferredQuery, players]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setQuery("");
    onOpenChange(nextOpen);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-16 w-full justify-between rounded-none border-foreground/30 bg-transparent px-5 text-left text-base font-normal shadow-none"
          >
            <span className="flex min-w-0 items-center gap-3">
              <MagnifyingGlassIcon className="size-6 shrink-0 text-primary" />
              {selectedPlayer ? (
                <span className="truncate">
                  <span className="font-medium">{selectedPlayer.nickname}</span>
                  <span className="ml-2 text-muted-foreground">
                    {selectedPlayer.team}
                  </span>
                </span>
              ) : (
                <span className="truncate text-muted-foreground">
                  搜索选手昵称、姓名、战队或国家
                </span>
              )}
            </span>
            <CaretUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(680px,calc(100vw-2rem))] rounded-none border-foreground/30 p-0 shadow-xl"
        >
          <Command shouldFilter={false} className="rounded-none! p-0">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="输入昵称、姓名、战队或中文国名…"
            />
            <CommandList className="max-h-96">
              <CommandEmpty>没有找到这名选手</CommandEmpty>
              <CommandGroup
                heading={deferredQuery ? "搜索结果" : "推荐选手 · 输入关键词继续查找"}
              >
                {visiblePlayers.map((player) => (
                  <CommandItem
                    key={player.id}
                    value={`${player.nickname} ${player.name} ${player.team}`}
                    onSelect={() => onSelect(player.id)}
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
                        {player.name} · {player.team}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        className="relative h-16 min-w-30 rounded-none px-8 text-center font-semibold shadow-none"
        onClick={onSubmit}
        disabled={!selectedPlayer || disabled}
      >
        <CrosshairSimpleIcon
          className="absolute left-4 size-4"
          aria-hidden="true"
        />
        <span className="w-full text-center">提交猜测</span>
      </Button>
    </div>
  );
}
