import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({
    children,
  }: PropsWithChildren<ComponentProps<"div">>) => <div>{children}</div>,
  DialogDescription: ({
    children,
  }: PropsWithChildren<ComponentProps<"p">>) => <p>{children}</p>,
  DialogHeader: ({
    children,
  }: PropsWithChildren<ComponentProps<"div">>) => <div>{children}</div>,
  DialogTitle: ({
    children,
  }: PropsWithChildren<ComponentProps<"h2">>) => <h2>{children}</h2>,
}));

import { IdentityDrawDialog } from "@/components/IdentityDrawDialog";
import type { Player } from "@/data/players";

const winner: Player = {
  id: "winner",
  nickname: "Winner",
  name: "Winner",
  countryCode: "CN",
  nationality: "China",
  age: 24,
  team: "Test",
  role: "Rifler",
  majorAppearances: 1,
  majorWins: 0,
};

describe("IdentityDrawDialog accessibility", () => {
  it("announces winner text in an isolated live region, outside the actions", () => {
    const markup = renderToStaticMarkup(
      <IdentityDrawDialog
        open
        poolLabel="Major 参赛池"
        rollKey={1}
        items={Array.from({ length: 29 }, () => winner)}
        winner={winner}
        winnerIndex={23}
        revealed
        remainingCredits={1}
        onOpenChange={vi.fn()}
        onKeep={vi.fn()}
        onReroll={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    const liveRegion = markup.match(
      /<p class="sr-only" role="status" aria-live="polite"[^>]*>([^<]+)<\/p>/,
    );
    expect(liveRegion?.[1]).toBe("抽取结果：Winner");
    expect(liveRegion?.[0]).toContain(
      'aria-label="第 1 次抽取结果：Winner"',
    );
    expect(liveRegion?.[0]).not.toContain("button");
    expect(markup.indexOf(liveRegion?.[0] ?? "")).toBeLessThan(
      markup.indexOf("<button"),
    );
  });

  it("keeps adoption errors visible without removing the actions", () => {
    const markup = renderToStaticMarkup(
      <IdentityDrawDialog
        open
        poolLabel="Major 参赛池"
        rollKey={1}
        items={Array.from({ length: 29 }, () => winner)}
        winner={winner}
        winnerIndex={23}
        revealed
        errorMessage="身份保存失败，请保留此窗口并重试。"
        remainingCredits={0}
        onOpenChange={vi.fn()}
        onKeep={vi.fn()}
        onReroll={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("身份保存失败，请保留此窗口并重试。");
    expect(markup).toContain("使用新身份");
  });

  it("routes every result action through the maintained mobile button contract", () => {
    const markup = renderToStaticMarkup(
      <IdentityDrawDialog
        open
        poolLabel="Major 参赛池"
        rollKey={1}
        items={Array.from({ length: 29 }, () => winner)}
        winner={winner}
        winnerIndex={23}
        revealed
        remainingCredits={1}
        onOpenChange={vi.fn()}
        onKeep={vi.fn()}
        onReroll={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(markup.match(/data-slot="button"/g)).toHaveLength(3);
    expect(markup.match(/data-size="default"/g)).toHaveLength(3);
    expect(markup).toContain("保留当前");
    expect(markup).toContain("重抽 · 1");
    expect(markup).toContain("使用新身份");
  });
});
