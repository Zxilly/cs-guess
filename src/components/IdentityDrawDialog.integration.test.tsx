/** @vitest-environment jsdom */

import {
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityDrawDialog } from "@/components/IdentityDrawDialog";
import type { Player } from "@/data/players";

const winner: Player = {
  id: "winner",
  nickname: "Winner",
  name: "Winner",
  countryCode: "CN",
  nationality: "China",
  age: 24,
  team: "Test",
  role: "Rifler",
  majorAppearances: 1,
  majorWins: 0,
};

const items = Array.from({ length: 29 }, (_, index) => ({
  ...winner,
  id: `player-${index}`,
  nickname: `Player ${index}`,
}));

let container: HTMLDivElement;
let root: Root;
let animationFrames: FrameRequestCallback[];

function DrawHarness({
  initialOpen = true,
}: {
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const restoredButtonRef = useRef<HTMLButtonElement>(null);
  const dialogProps: ComponentProps<typeof IdentityDrawDialog> = {
    open,
    poolLabel: "Major 参赛池",
    rollKey: 1,
    items,
    winner,
    winnerIndex: 23,
    revealed: true,
    remainingCredits: 2,
    onOpenChange: setOpen,
    onKeep: () => setOpen(false),
    onReroll: vi.fn(),
    onAccept: () => setOpen(false),
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      window.requestAnimationFrame(() => {
        restoredButtonRef.current?.focus({ preventScroll: true });
      });
    },
  };

  return (
    <>
      {open ? (
        <span>抽取中</span>
      ) : (
        <button ref={restoredButtonRef} type="button">
          重抽 Major 参赛池
        </button>
      )}
      <IdentityDrawDialog {...dialogProps} />
    </>
  );
}

async function renderHarness() {
  await act(async () => {
    root.render(<DrawHarness />);
    await Promise.resolve();
  });
}

async function renderDrawState(revealed: boolean) {
  await act(async () => {
    root.render(
      <IdentityDrawDialog
        open
        poolLabel="Major 参赛池"
        rollKey={1}
        items={items}
        winner={winner}
        winnerIndex={23}
        revealed={revealed}
        remainingCredits={2}
        onOpenChange={vi.fn()}
        onKeep={vi.fn()}
        onReroll={vi.fn()}
        onAccept={vi.fn()}
      />,
    );
    await Promise.resolve();
  });
}

async function flushClose() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const frames = animationFrames.splice(0);
    act(() => {
      frames.forEach((callback) => callback(0));
    });
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  animationFrames = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("IdentityDrawDialog Radix focus integration", () => {
  it("keeps the result shell mounted and inert until the roulette reveals", async () => {
    await renderDrawState(false);

    const shell = document.querySelector(
      '[data-slot="identity-draw-result-shell"]',
    );
    const hiddenResult = document.querySelector<HTMLElement>(
      '[data-slot="identity-draw-result-content"]',
    );
    expect(shell).toBeTruthy();
    expect(hiddenResult?.hasAttribute("inert")).toBe(true);
    expect(hiddenResult?.getAttribute("aria-hidden")).toBe("true");
    expect(hiddenResult?.className).toContain("invisible");

    await renderDrawState(true);

    const revealedShell = document.querySelector(
      '[data-slot="identity-draw-result-shell"]',
    );
    const revealedResult = document.querySelector<HTMLElement>(
      '[data-slot="identity-draw-result-content"]',
    );
    expect(revealedShell).toBe(shell);
    expect(revealedResult).toBe(hiddenResult);
    expect(revealedResult?.hasAttribute("inert")).toBe(false);
    expect(revealedResult?.getAttribute("aria-hidden")).toBe("false");
    expect(revealedResult?.className).not.toContain("invisible");
  });

  it("traps Tab in the real dialog and restores focus after Escape replaces the opener", async () => {
    await renderHarness();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const buttons = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "保留当前",
      "重抽 · 2",
      "使用新身份",
    ]);
    expect(document.activeElement).toBe(buttons.at(-1));
    expect(dialog?.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(dialog?.className).toContain("overflow-y-auto");
    expect(dialog?.className).toContain("motion-reduce:animate-none");

    act(() => buttons.at(-1)?.focus());
    act(() => {
      buttons.at(-1)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(buttons[0]);

    act(() => buttons[0].focus());
    act(() => {
      buttons[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(buttons.at(-1));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushClose();

    const restoredButton = container.querySelector<HTMLButtonElement>(
      "button",
    );
    expect(restoredButton?.textContent).toBe("重抽 Major 参赛池");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(restoredButton);
  });

  it("dismisses from the overlay and restores the newly mounted draw action", async () => {
    await renderHarness();

    const overlay = document.querySelector<HTMLElement>(
      '[data-slot="dialog-overlay"]',
    )!;
    act(() => {
      overlay.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }),
      );
      overlay.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushClose();

    const restoredButton = container.querySelector<HTMLButtonElement>(
      "button",
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(restoredButton);
  });
});
