import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "@/lib/utils";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { SearchIcon, CheckIcon } from "lucide-react";

const CommandInputElement = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>((props, ref) => <input ref={ref} {...props} />);

const CommandListElement = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>((props, ref) => <div ref={ref} {...props} />);

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  completion,
  completionClassName,
  value,
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
  "aria-activedescendant": ariaActiveDescendant,
  "aria-autocomplete": ariaAutocomplete,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  completion?: string;
  completionClassName?: string;
}) {
  const visibleValue = typeof value === "string" ? value : "";

  return (
    <div
      data-slot="command-input-wrapper"
      className="border-b border-foreground/20 p-3"
    >
      <InputGroup className="h-12! rounded-none! border-foreground/25 bg-background shadow-none! *:data-[slot=input-group-addon]:pl-3!">
        <div className="relative min-w-0 flex-1 self-stretch">
          {completion ? (
            <span
              data-slot="command-input-completion"
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-base",
                completionClassName,
              )}
            >
              <span className="invisible">{visibleValue}</span>
              <span className="text-muted-foreground/55">{completion}</span>
            </span>
          ) : null}
          <CommandPrimitive.Input asChild value={value} {...props}>
            <CommandInputElement
              data-slot="command-input"
              className={cn(
                "relative z-10 h-full w-full bg-transparent text-base outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
                className,
              )}
              aria-expanded={ariaExpanded}
              aria-controls={ariaControls}
              aria-activedescendant={ariaActiveDescendant}
              aria-autocomplete={ariaAutocomplete}
            />
          </CommandPrimitive.Input>
        </div>
        <InputGroupAddon className="pr-2">
          <SearchIcon className="size-5 shrink-0 text-primary" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({
  className,
  id,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      asChild
      {...props}
    >
      <CommandListElement
        id={id}
        data-slot="command-list"
        className={cn(
          "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
          className,
        )}
      >
        {children}
      </CommandListElement>
    </CommandPrimitive.List>
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
};
