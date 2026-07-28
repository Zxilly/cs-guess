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
});
