// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfoTip } from "@/components/InfoTip";

let container: HTMLDivElement;
let root: Root;

function pointerEvent(
  type: string,
  {
    pointerType = "mouse",
    relatedTarget,
  }: { pointerType?: string; relatedTarget?: EventTarget | null } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    relatedTarget,
  });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

function trigger() {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="查看说明"]',
  );
  if (!button) throw new Error("InfoTip trigger was not rendered");
  return button;
}

function content() {
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  it("opens on desktop hover and stays open while crossing into its content", async () => {
    vi.useFakeTimers();
    await renderInfoTip();

    await act(async () => {
      trigger().dispatchEvent(pointerEvent("pointerover"));
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const popover = content();
    expect(popover?.textContent).toContain("帮助用户做决定");

    await act(async () => {
      trigger().dispatchEvent(
        pointerEvent("pointerout", { relatedTarget: popover }),
      );
      popover?.dispatchEvent(
        pointerEvent("pointerover", { relatedTarget: trigger() }),
      );
      vi.advanceTimersByTime(150);
    });
    expect(content()).not.toBeNull();

    await act(async () => {
      popover?.dispatchEvent(
        pointerEvent("pointerout", { relatedTarget: document.body }),
      );
      vi.advanceTimersByTime(150);
    });
    expect(content()).toBeNull();
  });

  it("opens on keyboard focus and closes after focus leaves the tip", async () => {
    await renderInfoTip();
    const outside = container.querySelector<HTMLButtonElement>(
      "button:last-of-type",
    )!;

    await act(async () => trigger().focus());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(content()).not.toBeNull();

    await act(async () => outside.focus());
    await flush();
    expect(content()).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("uses click for a stable touch path without opening on touch hover", async () => {
    await renderInfoTip();

    await act(async () => {
      trigger().dispatchEvent(
        pointerEvent("pointerover", { pointerType: "touch" }),
      );
    });
    expect(content()).toBeNull();

    await act(async () => trigger().click());
    expect(content()).not.toBeNull();

    await act(async () => trigger().click());
    expect(content()).toBeNull();
  });

  it("provides a visible mobile close action and returns focus to the trigger", async () => {
    await renderInfoTip();
    const button = trigger();

    await act(async () => button.click());
    const closeButton = content()?.querySelector<HTMLButtonElement>(
      '[data-slot="info-tip-close"]',
    );
    expect(closeButton?.getAttribute("aria-label")).toBe("关闭说明");
    expect(closeButton?.className).toContain("max-sm:grid");

    await act(async () => closeButton?.click());
    await flush();

    expect(content()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("keeps hover, click pinning, and click dismissal in one state", async () => {
    vi.useFakeTimers();
    await renderInfoTip();

    await act(async () => {
      trigger().dispatchEvent(pointerEvent("pointerover"));
      trigger().click();
      trigger().dispatchEvent(
        pointerEvent("pointerout", { relatedTarget: document.body }),
      );
      vi.advanceTimersByTime(150);
    });
    expect(content()).not.toBeNull();

    await act(async () => {
      trigger().dispatchEvent(pointerEvent("pointerover"));
      trigger().click();
      vi.advanceTimersByTime(150);
    });
    expect(content()).toBeNull();

    await act(async () => {
      trigger().dispatchEvent(
        pointerEvent("pointerout", { relatedTarget: document.body }),
      );
      trigger().dispatchEvent(
        pointerEvent("pointerover", { relatedTarget: document.body }),
      );
    });
    expect(content()).not.toBeNull();
  });

  it("closes on Escape, restores trigger focus, and exposes a valid ARIA relationship", async () => {
    await renderInfoTip();
    const button = trigger();

    await act(async () => {
      button.focus();
      button.click();
    });
    const popover = content();
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(popover?.id);
    expect(button.getAttribute("aria-describedby")).toBe(popover?.id);
    expect(popover?.getAttribute("role")).toBe("dialog");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(content()).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("keeps a pure hover preview closed after Escape restores trigger focus", async () => {
    await renderInfoTip();
    const button = trigger();

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerover"));
    });
    expect(content()).not.toBeNull();
    expect(document.activeElement).not.toBe(button);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(content()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    const outside = container.querySelector<HTMLButtonElement>(
      "button:last-of-type",
    )!;
    await act(async () => {
      outside.focus();
      button.focus();
    });
    expect(content()).not.toBeNull();
  });

  it("closes on outside pointer interaction without stealing the new focus", async () => {
    await renderInfoTip();
    const outside = container.querySelector<HTMLButtonElement>(
      "button:last-of-type",
    )!;

    await act(async () => trigger().click());
    expect(content()).not.toBeNull();

    await act(async () => {
      outside.dispatchEvent(pointerEvent("pointerdown"));
      outside.focus();
      outside.dispatchEvent(pointerEvent("pointerup"));
      outside.click();
    });
    await flush();

    expect(content()).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("opts the popover animation out when reduced motion is requested", async () => {
    await renderInfoTip();
    await act(async () => trigger().click());

    const popover = content();
    expect(popover?.className).toContain("motion-reduce:animate-none");
    expect(popover?.className).toContain("motion-reduce:transition-none");

    await act(async () => trigger().click());
    expect(content()).toBeNull();
  });
});
