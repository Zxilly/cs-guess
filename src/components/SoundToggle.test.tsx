/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SoundToggle } from "@/components/SoundToggle";
import { useSoundStore } from "@/stores/sound-store";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useSoundStore.setState({ enabled: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SoundToggle", () => {
  it("exposes one global mute control with an explicit pressed state", () => {
    act(() => root.render(<SoundToggle />));
    const button = container.querySelector("button");

    expect(button?.getAttribute("aria-label")).toBe("静音全站音效");
    expect(button?.getAttribute("aria-pressed")).toBe("false");

    act(() => button?.click());

    expect(button?.getAttribute("aria-label")).toBe("取消静音全站音效");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.textContent).toContain("已静音");
  });
});
