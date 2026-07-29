import { useRef, type ReactNode, type RefObject } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

interface OperationStatusDialogProps {
  open: boolean;
  kind: "progress" | "error";
  title: string;
  description: string;
  eyebrow?: string;
  children?: ReactNode;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange?: (open: boolean) => void;
}

export function OperationStatusDialog({
  open,
  kind,
  title,
  description,
  eyebrow = kind === "progress" ? "PROCESSING" : "ACTION REQUIRED",
  children,
  titleRef,
  returnFocusRef,
  onOpenChange,
}: OperationStatusDialogProps) {
  const isProgress = kind === "progress";
  const showCloseButton = !isProgress && Boolean(onOpenChange);
  const internalTitleRef = useRef<HTMLHeadingElement | null>(null);
  const resolvedTitleRef = titleRef ?? internalTitleRef;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isProgress && !nextOpen) return;
        onOpenChange?.(nextOpen);
      }}
    >
      <DialogContent
        role={isProgress ? "dialog" : "alertdialog"}
        showCloseButton={showCloseButton}
        closeLabel="关闭状态提示"
        aria-busy={isProgress}
        onEscapeKeyDown={(event) => {
          if (isProgress) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isProgress) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          resolvedTitleRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus({ preventScroll: true });
        }}
        overlayClassName="bg-background/72 backdrop-blur-[2px]"
        className="grid min-h-[18.5rem] w-full max-w-lg grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border border-foreground/25 bg-background p-0 shadow-[0_24px_80px_rgba(15,23,42,0.16)] ring-0 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:right-5 sm:min-h-[17.375rem] sm:max-w-lg sm:[&_[data-slot=dialog-close]]:right-6"
      >
        <div
          className={[
            "flex items-center justify-between border-b border-foreground/20 py-4 pl-5 sm:pl-6",
            showCloseButton ? "pr-16 sm:pr-[4.5rem]" : "pr-5 sm:pr-6",
          ].join(" ")}
        >
          <span className="font-mono text-xs uppercase tracking-[0.1em] text-primary">
            {eyebrow}
          </span>
          {isProgress ? (
            <span
              className="grid size-9 place-items-center border border-primary/35 bg-primary/5 text-primary"
              aria-hidden="true"
            >
              <Spinner
                className="size-5"
                role="presentation"
                aria-hidden="true"
              />
            </span>
          ) : null}
        </div>

        <div className="px-5 py-7 sm:px-6 sm:py-8">
          <DialogTitle
            ref={resolvedTitleRef}
            tabIndex={-1}
            className="text-2xl font-bold leading-tight tracking-[-0.03em] outline-none"
          >
            {title}
          </DialogTitle>
          <DialogDescription className="mt-3 max-w-prose leading-6">
            {description}
          </DialogDescription>
        </div>

        <DialogFooter className="m-0 grid grid-cols-2 rounded-none border-t border-foreground/20 bg-transparent px-5 py-4 sm:flex sm:px-6 [&>:only-child]:col-span-2">
          {children ?? (
            <div
              data-slot="operation-status-action-placeholder"
              className="col-span-2 grid h-10 place-items-center"
              aria-hidden="true"
            >
              <span className="h-px w-28 overflow-hidden bg-primary/15">
                <span className="block h-full w-full animate-pulse bg-primary motion-reduce:animate-none" />
              </span>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
