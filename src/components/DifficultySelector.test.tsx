/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DifficultySelector } from "@/components/DifficultySelector";
import {
  loadSoloDifficulty,
  SOLO_DIFFICULTIES,
  soloMysteryPool,
} from "@/lib/solo-game";
import { SoloDifficultyPage } from "@/pages/SoloDifficultyPage";
import type { GameDifficulty } from "@/types/game";

let container: HTMLDivElement;
let root: Root;

function press(target: HTMLElement, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

function radioButtons(label: string) {
  const group = container.querySelector<HTMLElement>(
    `[role="radiogroup"][aria-label="${label}"]`,
  );
  return Array.from(
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  );
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("difficulty radio groups", () => {
  it("cycles, handles Home and End, and maintains the roving tab stop", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <SoloDifficultyPage />
        </MemoryRouter>,
      );
    });
    const radios = radioButtons("练习难度");

    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    radios[0].focus();
    press(radios[0], "ArrowLeft");
    expect(document.activeElement).toBe(radios[2]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    expect(loadSoloDifficulty()).toBe("hard");

    press(radios[2], "ArrowRight");
    expect(document.activeElement).toBe(radios[0]);
    press(radios[0], "End");
    expect(document.activeElement).toBe(radios[2]);
    press(radios[2], "Home");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("supports vertical arrows and click selection in the shared selector", () => {
    function Harness() {
      const [value, setValue] = useState<GameDifficulty>("easy");
      return <DifficultySelector value={value} onChange={setValue} />;
    }

    act(() => root.render(<Harness />));
    const radios = radioButtons("题库难度");

    radios[0].focus();
    press(radios[0], "ArrowUp");
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);

    press(radios[2], "ArrowDown");
    expect(document.activeElement).toBe(radios[0]);
    act(() => radios[1].click());
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("shows each pool boundary and player count without requiring a tooltip", () => {
    act(() =>
      root.render(
        <DifficultySelector value="easy" onChange={() => undefined} />,
      ),
    );
    const radios = radioButtons("题库难度");
    const group = container.querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="题库难度"]',
    );

    expect(radios).toHaveLength(3);
    expect(group?.classList).toContain("grid-cols-3");
    for (const [index, option] of SOLO_DIFFICULTIES.entries()) {
      expect(radios[index].classList).toContain("min-h-24");
      expect(radios[index].textContent).toContain(option.label);
      expect(radios[index].textContent).toContain(option.poolLabel);
      expect(radios[index].textContent).toContain(
        `${soloMysteryPool(option.id).length} 人`,
      );
    }
  });
});
