// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfoTip } from "@/components/InfoTip";

let container: HTMLDivElement;
let root: Root;

function mockTouchPresentation(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function pointerMove(pointerType = "mouse") {
  const event = new MouseEvent("pointermove", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

function trigger() {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="查看说明"]',
  );
  if (!button) throw new Error("InfoTip trigger was not rendered");
  return button;
}

function tooltipContent() {
  return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
}

function popoverContent() {
  return document.querySelector<HTMLElement>('[data-slot="popover-content"]');
}

async function renderInfoTip() {
  await act(async () => {
    root.render(
      <>
        <InfoTip label="查看说明">这是一段帮助用户做决定的说明。</InfoTip>
        <button type="button">外部操作</button>
      </>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockTouchPresentation(false);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("InfoTip interaction contract", () => {
  it("uses the shadcn tooltip on desktop hover", async () => {
    vi.useFakeTimers();
    await renderInfoTip();

    expect(window.matchMedia).toHaveBeenCalledWith("(any-hover: none)");
    await act(async () => {
      trigger().dispatchEvent(pointerMove());
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(tooltipContent()?.textContent).toContain("帮助用户做决定");
    expect(tooltipContent()?.className).toContain("data-closed:hidden");
    expect(trigger().getAttribute("data-slot")).toBe("tooltip-trigger");
  });

  it("opens from keyboard focus and closes on Escape", async () => {
    await renderInfoTip();
    const button = trigger();

    await act(async () => button.focus());
    expect(tooltipContent()?.getAttribute("role")).toBe("tooltip");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(tooltipContent()).toBeNull();
  });

  it("uses a quiet neutral trigger hover instead of a solid primary block", async () => {
    await renderInfoTip();

    expect(trigger().className).toContain("hover:bg-muted");
    expect(trigger().className).toContain("hover:text-foreground");
    expect(trigger().className).not.toContain("hover:bg-primary");
  });

  it("keeps a stable tap-to-open popover with a close action on touch layouts", async () => {
    mockTouchPresentation(true);
    await renderInfoTip();

    await act(async () => trigger().click());
    expect(popoverContent()?.textContent).toContain("帮助用户做决定");

    const closeButton = popoverContent()?.querySelector<HTMLButtonElement>(
      '[data-slot="info-tip-close"]',
    );
    expect(closeButton?.getAttribute("aria-label")).toBe("关闭说明");

    await act(async () => closeButton?.click());
    expect(popoverContent()).toBeNull();
  });

  it("opts tooltip motion out when reduced motion is requested", async () => {
    await renderInfoTip();
    await act(async () => trigger().focus());

    expect(tooltipContent()?.className).toContain("motion-reduce:animate-none");
    expect(tooltipContent()?.className).toContain(
      "motion-reduce:transition-none",
    );
  });
});
