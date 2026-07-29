import {
  forwardRef,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { InfoIcon, XIcon } from "@phosphor-icons/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
}

// Hybrid laptops can report a coarse primary pointer even while a mouse is
// available. Prefer the desktop Tooltip whenever any input can hover.
const TOUCH_PRESENTATION_QUERY = "(any-hover: none)";

function useTouchPresentation() {
  const [isTouchPresentation, setIsTouchPresentation] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(TOUCH_PRESENTATION_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(TOUCH_PRESENTATION_QUERY);
    const syncPresentation = () => setIsTouchPresentation(media.matches);
    syncPresentation();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncPresentation);
      return () => media.removeEventListener("change", syncPresentation);
    }
    media.addListener?.(syncPresentation);
    return () => media.removeListener?.(syncPresentation);
  }, []);

  return isTouchPresentation;
}

const TriggerButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { label: string }
>(({ label, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "grid size-8 min-h-11 min-w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      className,
    )}
    aria-label={label}
    {...props}
  >
    <InfoIcon className="size-4" />
  </button>
));
TriggerButton.displayName = "InfoTipTrigger";

export function InfoTip({
  label,
  children,
  side = "top",
  align = "center",
  className,
  contentClassName,
}: InfoTipProps) {
  const isTouchPresentation = useTouchPresentation();
  const [open, setOpen] = useState(false);

  if (isTouchPresentation) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <TriggerButton label={label} className={className} />
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          collisionPadding={12}
          className={cn(
            "relative w-[min(20rem,calc(100vw-2rem))] rounded-none border border-foreground/25 bg-background px-4 py-3 pr-12 text-sm leading-6 text-foreground shadow-xl ring-0",
            contentClassName,
          )}
        >
          <div>{children}</div>
          <button
            type="button"
            data-slot="info-tip-close"
            className="absolute top-1.5 right-1.5 grid size-11 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            aria-label="关闭说明"
            onClick={() => setOpen(false)}
          >
            <XIcon className="size-4" />
          </button>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <TriggerButton label={label} className={className} />
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          arrowClassName="border-t border-l border-foreground/25 bg-background fill-background"
          className={cn(
            "w-[min(20rem,calc(100vw-2rem))] rounded-none border border-foreground/25 bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-xl data-closed:hidden",
            contentClassName,
          )}
        >
          <div>{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
