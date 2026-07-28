import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App, IdentityRouteLoading } from "@/App";

describe("IdentityRouteLoading", () => {
  it("renders an identity-specific, page-shaped loading state", () => {
    const markup = renderToStaticMarkup(<IdentityRouteLoading />);

    expect(markup).toContain('aria-label="正在载入玩家身份"');
    expect(markup).toContain("玩家身份");
    expect(markup).toContain("正在载入身份资料");
    expect(markup).toContain("lg:grid-cols-2");
    expect(markup).not.toContain("正在准备对局");
  });

  it("keeps the first unconfirmed route frame visible while redirecting", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="正在载入玩家身份"');
    expect(markup).not.toContain("正在准备对局");
  });
});
