// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerSearch } from "@/components/PlayerSearch";
import { players, type Player } from "@/data/players";
import { completionSuffix } from "@/lib/player-search";

interface MountedSearch {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedSearch[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function SearchHarness({ candidates }: { candidates: readonly Player[] }) {
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  return (
    <PlayerSearch
      players={candidates}
      selectedPlayer={candidates.find((player) => player.id === selectedId)}
      open={open}
      onOpenChange={setOpen}
      onSelect={setSelectedId}
      onSubmit={vi.fn()}
    />
  );
}

function ControlledSearchHarness({
  candidates,
  initialQuery,
  onOpenChangeSpy,
}: {
  candidates: readonly Player[];
  initialQuery: string;
  onOpenChangeSpy?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState<string>();
  return (
    <>
      <output data-testid="controlled-query">{query}</output>
      <output data-testid="controlled-open">{String(open)}</output>
      <output data-testid="controlled-selection">{selectedId ?? "none"}</output>
      <PlayerSearch
        players={candidates}
        selectedPlayer={candidates.find((player) => player.id === selectedId)}
        query={query}
        open={open}
        onQueryChange={setQuery}
        onOpenChange={(nextOpen) => {
          onOpenChangeSpy?.(nextOpen);
          setOpen(nextOpen);
        }}
        onSelect={setSelectedId}
        onSubmit={vi.fn()}
      />
    </>
  );
}

function DisabledSearchHarness({
  onSelect,
  onSubmit,
}: {
  onSelect: (playerId: string) => void;
  onSubmit: (playerId?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("don");
  const [disabled, setDisabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  return (
    <>
      <button type="button" onClick={() => setDisabled(true)}>
        disconnect
      </button>
      <output data-testid="query">{query}</output>
      <output data-testid="selection">{selectedId ?? "none"}</output>
      <PlayerSearch
        players={players.slice(0, 12)}
        selectedPlayer={players.find((player) => player.id === selectedId)}
        query={query}
        open={open}
        disabled={disabled}
        onQueryChange={setQuery}
        onOpenChange={setOpen}
        onSelect={(playerId) => {
          setSelectedId(playerId);
          onSelect(playerId);
        }}
        onSubmit={onSubmit}
      />
    </>
  );
}

function MutableSearchHarness({
  initialCandidates,
  initialQuery,
  onSubmit,
}: {
  initialCandidates: readonly Player[];
  initialQuery: string;
  onSubmit: (playerId?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [selectedId, setSelectedId] = useState<string>();
  return (
    <>
      <button type="button" onClick={() => setQuery("zyw")}>
        replace query
      </button>
      <button
        type="button"
        onClick={() => setCandidates((current) => current.slice(0, 1))}
      >
        shrink results
      </button>
      <PlayerSearch
        players={candidates}
        selectedPlayer={candidates.find(
          (player) => player.id === selectedId,
        )}
        query={query}
        open={open}
        onQueryChange={setQuery}
        onOpenChange={setOpen}
        onSelect={setSelectedId}
        onSubmit={onSubmit}
      />
    </>
  );
}

async function mountSearch() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(<SearchHarness candidates={players.slice(0, 12)} />);
  });
  return container;
}

async function mountControlledSearch(
  initialQuery: string,
  onOpenChangeSpy?: (open: boolean) => void,
  candidates: readonly Player[] = players.slice(0, 12),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <ControlledSearchHarness
        candidates={candidates}
        initialQuery={initialQuery}
        onOpenChangeSpy={onOpenChangeSpy}
      />,
    );
  });
  return container;
}

async function mountMutableSearch(
  initialCandidates: readonly Player[],
  initialQuery: string,
  onSubmit = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <MutableSearchHarness
        initialCandidates={initialCandidates}
        initialQuery={initialQuery}
        onSubmit={onSubmit}
      />,
    );
  });
  return container;
}

function inputIn(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]');
  if (!input) throw new Error("combobox input was not rendered");
  return input;
}

async function enterQuery(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressKey(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function hoverOption(option: HTMLElement) {
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

async function startComposition(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  });
}

async function finishComposition(
  input: HTMLInputElement,
  finalValue: string,
) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, finalValue);
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
    // Browsers emit the final input/change notification immediately after
    // compositionend. Keep it in the same task so the component can prove that
    // the final composition is committed only once.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PlayerSearch combobox ARIA", () => {
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
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    for (const { root, container } of mounted.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.unstubAllGlobals();
  });

  it("keeps a full spacing step between the search icon and input text", async () => {
    const container = await mountSearch();
    const addon = container.querySelector<HTMLElement>(
      '[data-slot="input-group-addon"]',
    );

    expect(addon?.classList).toContain("pr-2");
    expect(inputIn(container).classList).toContain("px-1");
  });

  it("does not claim an absent listbox for an empty query", async () => {
    const container = await mountSearch();
    const input = inputIn(container);

    expect(input.getAttribute("aria-label")).toBe(
      "按昵称、姓名、战队或国家搜索并选择选手",
    );
    expect(input.getAttribute("placeholder")).toBe("搜索选手、战队或国家");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("links both result and empty panels while they are rendered", async () => {
    const container = await mountSearch();
    const input = inputIn(container);

    await enterQuery(input, players[0].nickname.slice(0, 2));
    const resultList = container.querySelector<HTMLElement>('[role="listbox"]');
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(resultList?.id);
    expect(input.hasAttribute("aria-activedescendant")).toBe(true);

    await enterQuery(input, "definitely-no-player");
    const emptyList = container.querySelector<HTMLElement>('[role="listbox"]');
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(emptyList?.id);
    expect(emptyList).not.toBeNull();
  });

  it("announces each empty query outside the listbox and clears on recovery", async () => {
    const onSubmit = vi.fn();
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "doto"].includes(player.nickname),
    );
    const container = await mountMutableSearch(candidates, "do", onSubmit);
    const input = inputIn(container);
    const status = container.querySelector<HTMLElement>('[role="status"]');

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.classList.contains("sr-only")).toBe(true);
    expect(status?.textContent).toBe("");

    await enterQuery(input, "not-a-player");

    const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
    const empty = container.querySelector<HTMLElement>(
      '[data-slot="command-empty"]',
    );
    expect(status?.textContent).toBe(
      "没有找到与“not-a-player”匹配的选手",
    );
    expect(listbox?.contains(status ?? null)).toBe(false);
    expect(empty?.textContent).toBe("没有找到这名选手");
    expect(empty?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);

    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    await enterQuery(input, "still-not-a-player");
    expect(status?.textContent).toBe(
      "没有找到与“still-not-a-player”匹配的选手",
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await enterQuery(input, "do");
    expect(status?.textContent).toBe("");
    expect(container.querySelectorAll('[role="option"]').length).toBe(3);
  });

  it("does not announce draft composition before its final empty query", async () => {
    const container = await mountSearch();
    const input = inputIn(container);
    const status = container.querySelector<HTMLElement>('[role="status"]');

    await startComposition(input);
    await enterQuery(input, "notaplayer");

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(status?.textContent).toBe("");

    await finishComposition(input, "notaplayer");

    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(status?.textContent).toBe(
      "没有找到与“notaplayer”匹配的选手",
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("removes list references after Escape and after selection", async () => {
    const container = await mountSearch();
    const input = inputIn(container);
    await enterQuery(input, players[0].nickname.slice(0, 2));
    await pressKey(input, "Escape");

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => input.click());
    const option = container.querySelector<HTMLElement>('[role="option"]');
    if (!option) throw new Error("search option was not rendered");
    await act(async () => option.click());

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("points aria-activedescendant at the keyboard-highlighted option", async () => {
    const container = await mountSearch();
    const input = inputIn(container);
    await enterQuery(input, players[6].nickname.slice(0, 1));
    expect(
      container.querySelectorAll('[role="option"]').length,
      container.innerHTML,
    ).toBeGreaterThan(0);
    await pressKey(input, "ArrowDown");

    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId ?? "")?.getAttribute("role")).toBe(
      "option",
    );
  });

  it("automatically highlights the first ranked result", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "doto"].includes(player.nickname),
    );
    const container = await mountMutableSearch(candidates, "do");
    const input = inputIn(container);
    const firstOption =
      container.querySelector<HTMLElement>('[role="option"]');

    expect(container.querySelectorAll('[role="option"]').length).toBe(3);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      firstOption?.id,
    );
    expect(
      container.querySelectorAll('[role="option"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[role="option"][data-selected="true"]'),
    ).toHaveLength(1);
    expect(firstOption?.getAttribute("aria-selected")).toBe("true");
    const firstPlayer = candidates.find(
      (player) => player.id === firstOption?.dataset.value,
    );
    expect(
      container.querySelector(
        '[data-slot="command-input-completion"]',
      )?.textContent,
    ).toBe(
      `do${completionSuffix("do", firstPlayer?.nickname ?? "")}  ⇥ 补全`,
    );
  });

  it("accepts the highlighted inline completion with Tab without submitting", async () => {
    const candidate = players.find((player) => player.nickname === "donk")!;
    const onSubmit = vi.fn(() => true);
    const container = await mountMutableSearch([candidate], "don", onSubmit);
    const input = inputIn(container);

    expect(
      container.querySelector(
        '[data-slot="command-input-completion"]',
      )?.textContent,
    ).toBe("donk  ⇥ 补全");

    await pressKey(input, "Tab");

    expect(input.value).toBe("donk");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("提交猜测"),
      )?.disabled,
    ).toBe(false);
  });

  it("submits an exact first result on Enter without an arrow key", async () => {
    const candidate = players.find((player) => player.nickname === "donk")!;
    const onSubmit = vi.fn(() => true);
    const container = await mountMutableSearch([candidate], "donk", onSubmit);
    const input = inputIn(container);

    expect(
      container.querySelector('[role="option"][aria-selected="true"]')
        ?.getAttribute("data-value"),
    ).toBe(candidate.id);

    await pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(candidate.id);
  });

  it("keeps pointer, keyboard, completion and ARIA highlight in one state", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "doto"].includes(player.nickname),
    );
    const container = await mountMutableSearch(candidates, "do");
    const input = inputIn(container);
    const options = Array.from(
      container.querySelectorAll<HTMLElement>('[role="option"]'),
    );

    await hoverOption(options[0]);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(
      container.querySelectorAll('[role="option"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[role="option"][data-selected="true"]'),
    ).toHaveLength(1);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector(
        '[data-slot="command-input-completion"]',
      )?.textContent,
    ).toBe(
      `do${completionSuffix(
        "do",
        candidates.find((player) => player.id === options[0].dataset.value)
          ?.nickname ?? "",
      )}  ⇥ 补全`,
    );

    await pressKey(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[0].getAttribute("aria-selected")).toBe("false");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });

  it("submits the real highlighted option on Enter and scrolls keyboard moves", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "doto"].includes(player.nickname),
    );
    const onSubmit = vi.fn();
    const container = await mountMutableSearch(candidates, "do", onSubmit);
    const input = inputIn(container);
    const options = Array.from(
      container.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);

    scrollIntoView.mockClear();
    await pressKey(input, "ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    const activeOption = document.getElementById(
      input.getAttribute("aria-activedescendant") ?? "",
    );
    expect(activeOption).not.toBeNull();
    const activeValue = activeOption?.dataset.value;

    await pressKey(input, "Enter");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(activeValue);
    expect(options.every((option) => option.isConnected === false)).toBe(true);
  });

  it("shows an explicit gray Enter affordance for an exact keyboard highlight", async () => {
    const candidate = players.find((player) => player.nickname === "donk")!;
    const container = await mountMutableSearch([candidate], "donk");
    const input = inputIn(container);

    await pressKey(input, "ArrowDown");

    const completion = container.querySelector<HTMLElement>(
      '[data-slot="command-input-completion"]',
    );
    expect(completion?.textContent).toBe("donk  ↵ 提交");
    expect(completion?.querySelector(".text-muted-foreground\\/55")).not.toBeNull();
  });

  it("keeps the highlighted draft retryable until an asynchronous submission is accepted", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "doto"].includes(player.nickname),
    );
    const firstAttempt = deferred<boolean>();
    const onSubmit = vi.fn(() => firstAttempt.promise);
    const container = await mountMutableSearch(candidates, "do", onSubmit);
    const input = inputIn(container);

    await pressKey(input, "ArrowDown");
    const activeValue = document.getElementById(
      input.getAttribute("aria-activedescendant") ?? "",
    )?.dataset.value;
    const completionBefore =
      container.querySelector(
        '[data-slot="command-input-completion"]',
      )?.textContent;
    await pressKey(input, "Enter");
    await pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(input.value).toBe("do");
    expect(input.disabled).toBe(true);

    await act(async () => firstAttempt.resolve(false));

    expect(input.disabled).toBe(false);
    expect(input.value).toBe("do");
    expect(
      document.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      )?.dataset.value,
    ).toBe(activeValue);
    expect(
      container.querySelector(
        '[data-slot="command-input-completion"]',
      )?.textContent,
    ).toBe(completionBefore);

    const acceptedAttempt = deferred<boolean>();
    onSubmit.mockReturnValueOnce(acceptedAttempt.promise);
    await pressKey(input, "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(2);

    await act(async () => acceptedAttempt.resolve(true));

    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("single-flights the selected-player button and retains it after rejection", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia"].includes(player.nickname),
    );
    const attempt = deferred<boolean>();
    const onSubmit = vi.fn(() => attempt.promise);
    const container = await mountMutableSearch(candidates, "do", onSubmit);
    const input = inputIn(container);
    const option =
      container.querySelector<HTMLElement>('[role="option"]');
    if (!option) throw new Error("search option was not rendered");
    const selectedCandidate = candidates.find(
      (candidate) => candidate.id === option.dataset.value,
    );
    if (!selectedCandidate) throw new Error("selected player was not found");
    await act(async () => option.click());

    const submit = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("提交猜测"));
    if (!submit) throw new Error("submit button was not rendered");

    await act(async () => {
      submit.click();
      submit.click();
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");

    await act(async () => attempt.resolve(false));

    expect(input.value).toBe(selectedCandidate.nickname);
    expect(submit.disabled).toBe(false);
    expect(submit.hasAttribute("aria-busy")).toBe(false);
  });

  it("returns focus to the input after a pointer selection so Enter submits", async () => {
    const candidate = players.find((player) => player.nickname === "donk")!;
    const onSubmit = vi.fn();
    const container = await mountMutableSearch([candidate], "don", onSubmit);
    const input = inputIn(container);
    const option =
      container.querySelector<HTMLElement>('[role="option"]');
    if (!option) throw new Error("search option was not rendered");

    await act(async () => option.click());
    expect(document.activeElement).toBe(input);

    await pressKey(input, "Enter");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(candidate.id);
  });

  it("returns focus to the input after an accepted keyboard submission", async () => {
    const candidate = players.find((player) => player.nickname === "donk")!;
    const onSubmit = vi.fn(() => true);
    const container = await mountMutableSearch([candidate], "don", onSubmit);
    const input = inputIn(container);

    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onSubmit).toHaveBeenCalledWith(candidate.id);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
  });

  it("clears stale highlight state after controlled query and result changes", async () => {
    const candidates = players.filter((player) =>
      ["donk", "Dosia", "ZywOo"].includes(player.nickname),
    );
    const container = await mountMutableSearch(candidates, "do");
    const input = inputIn(container);
    const firstOption =
      container.querySelector<HTMLElement>('[role="option"]');
    if (!firstOption) throw new Error("search option was not rendered");

    await hoverOption(firstOption);
    expect(input.hasAttribute("aria-activedescendant")).toBe(true);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "replace query")
        ?.click();
    });
    expect(input.value).toBe("zyw");
    expect(input.hasAttribute("aria-activedescendant")).toBe(true);
    expect(
      container.querySelectorAll('[role="option"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-slot="command-input-completion"]'),
    ).not.toBeNull();

    const zywOoOption =
      container.querySelector<HTMLElement>('[role="option"]');
    if (!zywOoOption) throw new Error("replacement option was not rendered");
    await hoverOption(zywOoOption);
    expect(input.hasAttribute("aria-activedescendant")).toBe(true);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "shrink results")
        ?.click();
    });
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(
      container.querySelectorAll('[role="option"][aria-selected="true"]'),
    ).toHaveLength(0);
  });

  it("supports a restored controlled query without opening until the user interacts", async () => {
    const container = await mountControlledSearch("don");
    const input = inputIn(container);

    expect(input.value).toBe("don");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => input.focus());
    expect(input.getAttribute("aria-expanded")).toBe("true");

    await enterQuery(input, "donk");
    expect(input.value).toBe("donk");
  });

  it("keeps a controlled pinyin composition as a closed draft until compositionend", async () => {
    const openChanges = vi.fn();
    const container = await mountControlledSearch(
      "",
      openChanges,
      players,
    );
    const input = inputIn(container);

    await startComposition(input);
    openChanges.mockClear();
    await enterQuery(input, "zhong");

    expect(input.value).toBe("zhong");
    expect(
      container.querySelector('[data-testid="controlled-query"]')?.textContent,
    ).toBe("zhong");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(openChanges).not.toHaveBeenCalled();

    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(
      container.querySelector('[data-testid="controlled-selection"]')
        ?.textContent,
    ).toBe("none");

    await finishComposition(input, "中国");

    expect(input.value).toBe("中国");
    expect(
      container.querySelector('[data-testid="controlled-query"]')?.textContent,
    ).toBe("中国");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(openChanges).toHaveBeenCalledTimes(1);
    expect(openChanges).toHaveBeenCalledWith(true);
  });

  it("keeps an uncontrolled pinyin composition closed and commits the final value once", async () => {
    const container = await mountSearch();
    const input = inputIn(container);

    await startComposition(input);
    await enterQuery(input, "zhong");

    expect(input.value).toBe("zhong");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await finishComposition(input, "中国");

    expect(input.value).toBe("中国");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("keeps mobile results in document flow and anchors them on desktop", async () => {
    const container = await mountSearch();
    const input = inputIn(container);
    await enterQuery(input, "don");

    const list = container.querySelector<HTMLElement>(
      '[data-slot="command-list"]',
    );
    const submit = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("提交猜测"));

    expect(list).not.toBeNull();
    expect(submit).toBeDefined();
    expect(list?.classList.contains("relative")).toBe(true);
    expect(list?.classList.contains("absolute")).toBe(false);
    expect(list?.classList.contains("sm:absolute")).toBe(true);
    expect(list?.className).toContain("max-h-");
    expect(list?.classList.contains("overflow-y-auto")).toBe(true);
    expect(list?.classList.contains("border")).toBe(true);
    expect(list?.classList.contains("shadow-xl")).toBe(true);
    expect(list?.classList.contains("z-20")).toBe(true);
    expect(
      container
        .querySelector('[data-slot="player-search"]')
        ?.classList.contains("min-w-0"),
    ).toBe(true);
    expect(
      Boolean(
        (list?.compareDocumentPosition(submit as HTMLButtonElement) ?? 0) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("freezes an expanded search when the connection disables guessing", async () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    await act(async () => {
      root.render(
        <DisabledSearchHarness
          onSelect={onSelect}
          onSubmit={onSubmit}
        />,
      );
    });

    const input = inputIn(container);
    const staleOption =
      container.querySelector<HTMLElement>('[role="option"]');
    expect(staleOption).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("button")
        ?.click();
    });

    expect(input.disabled).toBe(true);
    expect(
      container
        .querySelector('[data-slot="command"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await enterQuery(input, "zywoo");
    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");
    await act(async () => staleOption?.click());

    expect(container.querySelector('[data-testid="query"]')?.textContent).toBe(
      "don",
    );
    expect(
      container.querySelector('[data-testid="selection"]')?.textContent,
    ).toBe("none");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
