import { renderToStaticMarkup } from "react-dom/server";
import type { HTMLAttributes, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <>{children}</>,
  DialogContent: ({
    children,
    className,
  }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({
    children,
    ...props
  }: PropsWithChildren<HTMLAttributes<HTMLParagraphElement>>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({
    children,
    className,
  }: PropsWithChildren<{ className?: string }>) => (
    <footer className={className}>{children}</footer>
  ),
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { players } from "@/data/players";

function politeLiveRegionCount(markup: string) {
  return markup.match(/aria-live="polite"/g)?.length ?? 0;
}

describe("group round result", () => {
  it("shows every stable seat, score, and tied rank for four players", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="draw"
        seriesComplete={false}
        score="2 : 1"
        mysteryPlayer={players[0]}
        standings={[
          { label: "你", name: "donk", score: 2, rankLabel: "并列第 1", self: true },
          { label: "对手 1", name: "m0NESY", score: 2, rankLabel: "并列第 1", self: false },
          { label: "对手 2", name: "ZywOo", score: 1, rankLabel: "第 3", self: false },
          { label: "对手 3", name: "等待玩家", score: 0, rankLabel: "第 4", self: false },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("当前排行榜");
    expect(markup).toContain("你 · 并列第 1");
    expect(markup).toContain("对手 1 · 并列第 1");
    expect(markup).toContain("对手 2 · 第 3");
    expect(markup).toContain("对手 3 · 第 4");
    expect(markup).not.toContain(">2 : 1<");
    expect(markup).toContain("min-w-[32rem]");
  });

  it("keeps the compact two-player score", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="win"
        seriesComplete={false}
        score="2 : 1"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("当前比分");
    expect(markup).toContain("2 : 1");
    expect(markup).not.toContain("当前排行榜");
  });

  it("explains a disconnect forfeit without claiming either player solved", () => {
    const winningMarkup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="win"
        seriesComplete={false}
        finishReason="disconnect_forfeit"
        score="1 : 0"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );
    const losingMarkup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="loss"
        seriesComplete
        finishReason="disconnect_forfeit"
        score="0 : 2"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(winningMarkup).toContain(
      "对手重连宽限期结束，本局由你获胜。",
    );
    expect(winningMarkup).not.toContain("锁定了神秘选手");
    expect(losingMarkup).toContain(
      "你的重连宽限期结束，对手赢得了本场系列赛。",
    );
    expect(losingMarkup).not.toContain("率先拿到");
  });

  it("uses neutral copy when an older snapshot has no finish reason", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="loss"
        seriesComplete={false}
        score="0 : 1"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("对手赢得了本局。");
    expect(markup).not.toContain("锁定了神秘选手");
  });

  it("offers view, rematch, and lobby actions after a series", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="win"
        seriesComplete
        score="2 : 1"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
        onRematch={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(markup).toContain("查看对局");
    expect(markup).toContain("再次对战");
    expect(markup).toContain("返回模式大厅");
    expect(markup).toContain("flex-col");
    expect(markup).toContain("sm:flex-row");
  });

  it.each([
    {
      label: "2P explicit leave",
      outcome: "win" as const,
      seriesStatus: "completed" as const,
      seriesFinishReason: "member_left_forfeit" as const,
      finishReason: "member_left" as const,
      expected: "对手已离开，服务器判定你赢得本系列。",
      absent: "断线超时",
    },
    {
      label: "2P disconnect timeout",
      outcome: "win" as const,
      seriesStatus: "completed" as const,
      seriesFinishReason: "member_left_forfeit" as const,
      finishReason: "disconnect_forfeit" as const,
      expected: "对手断线超时，服务器判定你赢得本系列。",
      absent: "对手已离开",
    },
    {
      label: "4P explicit leave",
      outcome: "draw" as const,
      seriesStatus: "abandoned" as const,
      seriesFinishReason: "member_left_abandoned" as const,
      finishReason: "member_left" as const,
      expected: "有成员离开，本系列已结束。最终排名已保留。",
      absent: "断线超时",
    },
    {
      label: "4P disconnect timeout",
      outcome: "draw" as const,
      seriesStatus: "abandoned" as const,
      seriesFinishReason: "member_left_abandoned" as const,
      finishReason: "disconnect_forfeit" as const,
      expected: "有成员断线超时，本系列已结束。最终排名已保留。",
      absent: "有成员离开",
    },
  ])(
    "distinguishes $label from other terminal reasons",
    ({
      outcome,
      seriesStatus,
      seriesFinishReason,
      finishReason,
      expected,
      absent,
    }) => {
      const standings =
        seriesStatus === "abandoned"
          ? [
              { label: "你", name: "donk", score: 1, rankLabel: "并列第 1", self: true },
              { label: "对手 1", name: "m0NESY", score: 1, rankLabel: "并列第 1", self: false },
              { label: "对手 2", name: "ZywOo（已离开）", score: 0, rankLabel: "第 3", self: false },
              { label: "对手 3", name: "sh1ro", score: 0, rankLabel: "第 3", self: false },
            ]
          : undefined;
      const markup = renderToStaticMarkup(
        <CelebrationOverlay
          outcome={outcome}
          seriesComplete
          seriesStatus={seriesStatus}
          seriesFinishReason={seriesFinishReason}
          finishReason={finishReason}
          score="1 : 1"
          mysteryPlayer={players[0]}
          standings={standings}
          onClose={vi.fn()}
        />,
      );

      expect(markup).toContain(expected);
      expect(markup).not.toContain(absent);
      expect(markup).not.toContain("锁定了神秘选手");
      expect(politeLiveRegionCount(markup)).toBe(1);
      expect(markup).toContain('aria-atomic="true"');
      if (seriesStatus === "abandoned") {
        expect(markup).toContain("系列赛已结束");
        expect(markup).toContain("最终排行榜");
        expect(markup).not.toContain("本局平局");
      }
    },
  );

  it("uses a neutral terminal fallback for an older abandoned snapshot", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="draw"
        seriesComplete
        seriesStatus="abandoned"
        score="1 : 1"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("本系列已结束。最终排名已保留。");
    expect(markup).not.toContain("成员离开");
    expect(markup).not.toContain("断线超时");
  });

  it("confines mobile horizontal scrolling to the labelled standings region", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="draw"
        seriesComplete={false}
        score="0 : 0"
        mysteryPlayer={players[0]}
        standings={[
          { label: "你", name: "donk", score: 0, rankLabel: "并列第 1", self: true },
          { label: "对手 1", name: "m0NESY", score: 0, rankLabel: "并列第 1", self: false },
          { label: "对手 2", name: "ZywOo", score: 0, rankLabel: "并列第 1", self: false },
          { label: "对手 3", name: "sh1ro", score: 0, rankLabel: "并列第 1", self: false },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("overflow-x-hidden");
    expect(markup).toContain('aria-label="当前排行榜，可横向滚动"');
    expect(markup).toContain("左右滑动查看全部席位");
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("sticky bottom-0");
  });

  it("announces when the authoritative next-round countdown is paused for reconnection", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="win"
        seriesComplete={false}
        nextRoundSeconds={0}
        nextRoundPaused
        score="1 : 0"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("等待成员重连后开始下一局。");
    expect(markup).not.toContain("00 秒");
    expect(politeLiveRegionCount(markup)).toBe(1);
    expect(markup).toContain('role="status"');
  });

  it("keeps static round copy and a changing countdown in separate announcement scopes", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="win"
        seriesComplete={false}
        nextRoundSeconds={4}
        score="1 : 0"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("你赢得了本局。");
    expect(markup).toContain("下一局");
    expect(markup).toContain("04 秒");
    expect(politeLiveRegionCount(markup)).toBe(1);
    expect(markup).toContain(
      'role="status" aria-live="polite" aria-atomic="true"',
    );
  });

  it("announces a static ordinary round result once when no countdown is present", () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        outcome="draw"
        seriesComplete={false}
        score="0 : 0"
        mysteryPlayer={players[0]}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("本局未分出胜负。");
    expect(politeLiveRegionCount(markup)).toBe(1);
    expect(markup).not.toContain('role="status"');
  });
});
