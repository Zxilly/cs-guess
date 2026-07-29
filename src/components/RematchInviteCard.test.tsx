import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RematchInviteCard } from "@/components/RematchInviteCard";

describe("RematchInviteCard", () => {
  it("shows the requester, countdown, and two explicit decisions", () => {
    const markup = renderToStaticMarkup(
      <RematchInviteCard
        requesterName="ZywOo"
        secondsLeft={18}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );

    expect(markup).toContain("ZywOo 请求再次对战");
    expect(markup).toContain("18s");
    expect(markup).toContain("拒绝");
    expect(markup).toContain("接受重赛");
    expect(markup).toContain("fixed top-4 right-4");
  });

  it("locks both decisions while a response is being sent", () => {
    const markup = renderToStaticMarkup(
      <RematchInviteCard
        requesterName="ZywOo"
        secondsLeft={9}
        pending="accept"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});
