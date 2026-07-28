/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchFoundOverlay } from "@/components/MatchFoundOverlay";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MatchFoundOverlay", () => {
  it("focuses and traps the enter action while making the background inert", async () => {
    const onEnter = vi.fn();
    await act(async () => {
      root.render(
        <>
          <button type="button">底层取消</button>
          <MatchFoundOverlay
            playerNames={["donk", "m0NESY"]}
            partySize={2}
            bestOf={3}
            difficulty="easy"
            onEnter={onEnter}
          />
        </>,
      );
      await Promise.resolve();
    });

    const enter = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button',
    )!;
    expect(document.activeElement).toBe(enter);
    expect(container.getAttribute("aria-hidden")).toBe("true");

    act(() => {
      enter.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(enter);

    act(() => {
      enter.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(enter);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onEnter).not.toHaveBeenCalled();

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
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(enter);

    act(() => enter.click());
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("labels self and opponents uniquely and keeps a mobile 2x2 divider", async () => {
    await act(async () => {
      root.render(
        <MatchFoundOverlay
          playerNames={["donk"]}
          partySize={4}
          bestOf={5}
          difficulty="hard"
          onEnter={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("你");
    expect(dialog.textContent).toContain("对手 1");
    expect(dialog.textContent).toContain("对手 2");
    expect(dialog.textContent).toContain("对手 3");
    expect(dialog.textContent).toContain("等待中的对手 1");
    expect(dialog.textContent).toContain("等待中的对手 2");
    expect(dialog.textContent).toContain("等待中的对手 3");
    expect(dialog.innerHTML).toContain("[&amp;:nth-child(-n+2)]:border-b");
  });
});
