import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ModeSidebar } from "@/components/ModeSidebar";

describe("ModeSidebar reduced-motion contract", () => {
  it("limits the brand rotation to motion-safe environments", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeSidebar
          mode="solo"
          secondsLeft={180}
          guesses={0}
          maxGuesses={8}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("motion-safe:group-hover:rotate-45");
    expect(markup).toContain("motion-reduce:transform-none");
    expect(markup).toContain("motion-reduce:transition-none");
  });

  it.each([
    ["won", "本局胜利", "text-outcome-win"],
    ["lost", "本局失利", "text-outcome-loss"],
  ] as const)("uses the %s result tone after a battle", (status, label, tone) => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeSidebar
          mode="quick"
          secondsLeft={0}
          guesses={4}
          maxGuesses={8}
          status={status}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(label);
    expect(markup).toContain(tone);
  });

  it("places live connection state in the game sidebar", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeSidebar
          mode="quick"
          secondsLeft={120}
          guesses={2}
          maxGuesses={8}
          connectionLabel="实时连接正常"
          connectionTone="connected"
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("连接状态");
    expect(markup).toContain("实时连接正常");
    expect(markup).not.toContain("Series");
    expect(markup).not.toContain("Date");
    expect(markup).not.toContain("猜测进度");
  });

  it("keeps opponent visibility beside the current live mode", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ModeSidebar
          mode="quick"
          secondsLeft={120}
          guesses={2}
          maxGuesses={8}
          opponentVisibility="hidden"
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("当前模式");
    expect(markup).toContain("隐藏猜测");
    expect(markup).toContain("查看对手信息规则");
  });
});
