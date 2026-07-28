import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { InfoIcon, XIcon } from "@phosphor-icons/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
}

export function InfoTip({
  label,
  children,
  side = "top",
  align = "center",
  className,
  contentClassName,
}: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [descriptionId, setDescriptionId] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerHoveredRef = useRef(false);
  const contentHoveredRef = useRef(false);
  const focusWithinRef = useRef(false);
  const pinnedRef = useRef(false);
  const suppressHoverUntilLeaveRef = useRef(false);
  const suppressFocusOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const handleContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    setDescriptionId(node?.id);
  }, []);

  function cancelScheduledClose() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function closeIfInactive() {
    if (
      pinnedRef.current ||
      triggerHoveredRef.current ||
      contentHoveredRef.current ||
      focusWithinRef.current
    ) {
      return;
    }
    restoreFocusRef.current = false;
    setOpen(false);
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closeIfInactive();
    }, 100);
  }

  function openTransiently() {
    cancelScheduledClose();
    restoreFocusRef.current = false;
    setOpen(true);
  }

  function handleTriggerPointerEnter(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "touch") return;
    triggerHoveredRef.current = true;
    if (!suppressHoverUntilLeaveRef.current) {
      openTransiently();
    }
  }

  function handleTriggerPointerLeave() {
    triggerHoveredRef.current = false;
    suppressHoverUntilLeaveRef.current = false;
    scheduleClose();
  }

  function handleContentPointerEnter(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    contentHoveredRef.current = true;
    cancelScheduledClose();
  }

  function handleContentPointerLeave() {
    contentHoveredRef.current = false;
    scheduleClose();
  }

  function isInsideTip(target: EventTarget | null) {
    return (
      target instanceof Node &&
      (triggerRef.current?.contains(target) ||
        contentRef.current?.contains(target))
    );
  }

  function handleFocus(event: FocusEvent<HTMLElement>) {
    if (suppressFocusOpenRef.current) {
      focusWithinRef.current = false;
      return;
    }
    if (event.target === triggerRef.current || isInsideTip(event.target)) {
      focusWithinRef.current = true;
      openTransiently();
    }
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (isInsideTip(event.relatedTarget)) return;
    focusWithinRef.current = false;
    closeIfInactive();
  }

  function handleTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    // Radix's trigger click toggles against the already-open hover/focus
    // preview. Own the click state so clicking a preview pins it instead of
    // unexpectedly closing it.
    event.preventDefault();
    cancelScheduledClose();
    if (pinnedRef.current) {
      pinnedRef.current = false;
      triggerHoveredRef.current = false;
      suppressHoverUntilLeaveRef.current = true;
      restoreFocusRef.current = false;
      setOpen(false);
      return;
    }
    pinnedRef.current = true;
    restoreFocusRef.current = false;
    setOpen(true);
  }

  function clearInteractionState() {
    cancelScheduledClose();
    pinnedRef.current = false;
    focusWithinRef.current = false;
    contentHoveredRef.current = false;
    suppressHoverUntilLeaveRef.current = triggerHoveredRef.current;
    triggerHoveredRef.current = false;
  }

  function closePinnedTip() {
    clearInteractionState();
    suppressFocusOpenRef.current = true;
    setOpen(false);
    queueMicrotask(() => {
      triggerRef.current?.focus();
      queueMicrotask(() => {
        suppressFocusOpenRef.current = false;
      });
    });
  }

  useEffect(
    () => () => {
      cancelScheduledClose();
    },
    [],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }
        clearInteractionState();
        setOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "grid size-8 min-h-11 min-w-11 place-items-center text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            className,
          )}
          aria-label={label}
          aria-describedby={descriptionId}
          onPointerEnter={handleTriggerPointerEnter}
          onPointerLeave={handleTriggerPointerLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={handleTriggerClick}
        >
          <InfoIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={12}
        ref={handleContentRef}
        onPointerEnter={handleContentPointerEnter}
        onPointerLeave={handleContentPointerLeave}
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
        onOpenAutoFocus={(event) => {
          // Explanatory content is not an interaction destination. Keeping
          // focus on the trigger makes hover and keyboard previews equivalent
          // and avoids announcing an unexpected dialog focus jump.
          event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          restoreFocusRef.current = true;
        }}
        onPointerDownOutside={() => {
          restoreFocusRef.current = false;
        }}
        onFocusOutside={() => {
          restoreFocusRef.current = false;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            restoreFocusRef.current &&
            document.activeElement !== triggerRef.current
          ) {
            // Escape from a hover preview restores the trigger. That
            // programmatic focus must not be interpreted as a fresh request to
            // reopen the same tip.
            suppressFocusOpenRef.current = true;
            triggerRef.current?.focus();
            queueMicrotask(() => {
              suppressFocusOpenRef.current = false;
            });
          }
          restoreFocusRef.current = false;
        }}
        className={cn(
          "relative w-[min(20rem,calc(100vw-2rem))] rounded-none border border-foreground/25 bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-xl ring-0 max-sm:pr-12",
          contentClassName,
        )}
      >
        <div>{children}</div>
        <button
          type="button"
          data-slot="info-tip-close"
          className="absolute top-1.5 right-1.5 hidden size-11 place-items-center text-muted-foreground hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary max-sm:grid"
          aria-label="关闭说明"
          onClick={closePinnedTip}
        >
          <XIcon className="size-4" />
        </button>
      </PopoverContent>
    </Popover>
  );
}
