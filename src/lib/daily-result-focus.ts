interface PreventableFocusEvent {
  preventDefault(): void;
}

interface FocusableResult {
  focus(options?: FocusOptions): void;
}

interface FocusableDialogTitle {
  focus(): void;
}

export function focusCelebrationTitleOnOpen(
  event: PreventableFocusEvent,
  title: FocusableDialogTitle | null,
) {
  event.preventDefault();
  title?.focus();
}

export function focusDailyResultAfterDialog(
  event: PreventableFocusEvent,
  result: FocusableResult | null,
) {
  event.preventDefault();
  result?.focus({ preventScroll: true });
}
