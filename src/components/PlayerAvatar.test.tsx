/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlayerAvatar } from "@/components/PlayerAvatar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PlayerAvatar", () => {
  it("uses the same anonymous silhouette when an image is unavailable", () => {
    act(() => {
      root.render(<PlayerAvatar player={{ nickname: "device" }} />);
    });

    expect(
      container.querySelector('[data-slot="player-avatar-placeholder"]'),
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("falls back to the anonymous silhouette when an image fails", () => {
    act(() => {
      root.render(
        <PlayerAvatar
          player={{
            nickname: "device",
            imageUrl: "https://example.com/missing.webp",
          }}
        />,
      );
    });

    const image = container.querySelector<HTMLImageElement>("img");
    expect(image).not.toBeNull();

    act(() => image?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-slot="player-avatar-placeholder"]'),
    ).not.toBeNull();
  });
});
