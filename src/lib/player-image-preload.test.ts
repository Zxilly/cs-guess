import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preloadPlayerImages,
  uniquePlayerImageUrls,
} from "@/lib/player-image-preload";

describe("uniquePlayerImageUrls", () => {
  it("deduplicates the prepared roulette images and applies a bounded limit", () => {
    const players = [
      { imageUrl: "https://example.com/one.webp" },
      { imageUrl: "https://example.com/one.webp" },
      {},
      { imageUrl: "https://example.com/two.webp" },
      { imageUrl: "https://example.com/three.webp" },
    ];

    expect(uniquePlayerImageUrls(players, 2)).toEqual([
      "https://example.com/one.webp",
      "https://example.com/two.webp",
    ]);
  });
});

describe("preloadPlayerImages", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("decodes a bounded number of images without exceeding the worker limit", async () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      imageUrl: `https://example.com/${index}.webp`,
    }));
    const decodedUrls: string[] = [];
    let activeDecodes = 0;
    let peakDecodes = 0;

    await preloadPlayerImages(players, {
      limit: 6,
      concurrency: 3,
      createImage: () => {
        const image = {
          decoding: "auto",
          referrerPolicy: "",
          src: "",
          async decode() {
            activeDecodes += 1;
            peakDecodes = Math.max(peakDecodes, activeDecodes);
            await Promise.resolve();
            decodedUrls.push(this.src);
            activeDecodes -= 1;
          },
        };
        return image as HTMLImageElement;
      },
    });

    expect(decodedUrls).toHaveLength(6);
    expect(new Set(decodedUrls).size).toBe(6);
    expect(peakDecodes).toBeLessThanOrEqual(3);
  });

  it("settles a permanently pending decode at the shared timeout", async () => {
    vi.useFakeTimers();
    const image = {
      decoding: "auto",
      referrerPolicy: "",
      src: "",
      decode: () => new Promise<void>(() => {}),
    };
    let settled = false;
    const preload = preloadPlayerImages(
      [{ imageUrl: "https://example.com/pending.webp" }],
      {
        timeoutMs: 250,
        createImage: () => image as HTMLImageElement,
      },
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await preload;

    expect(settled).toBe(true);
    expect(image.src).toBe("");
  });

  it("cancels in-flight decodes and does not start queued images", async () => {
    const controller = new AbortController();
    const created: Array<{ src: string }> = [];
    const preload = preloadPlayerImages(
      Array.from({ length: 8 }, (_, index) => ({
        imageUrl: `https://example.com/${index}.webp`,
      })),
      {
        concurrency: 2,
        signal: controller.signal,
        createImage: () => {
          const image = {
            decoding: "auto",
            referrerPolicy: "",
            src: "",
            decode: () => new Promise<void>(() => {}),
          };
          created.push(image);
          return image as HTMLImageElement;
        },
      },
    );

    await Promise.resolve();
    controller.abort();
    await preload;

    expect(created).toHaveLength(2);
    expect(created.every((image) => image.src === "")).toBe(true);
  });
});
