import type { Player } from "@/data/players";

const DEFAULT_PRELOAD_LIMIT = 29;
const DEFAULT_PRELOAD_CONCURRENCY = 4;
const DEFAULT_PRELOAD_TIMEOUT_MS = 2_500;

interface PlayerImagePreloadOptions {
  limit?: number;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  createImage?: () => HTMLImageElement;
}

export function uniquePlayerImageUrls(
  players: readonly Pick<Player, "imageUrl">[],
  limit = DEFAULT_PRELOAD_LIMIT,
) {
  const urls = new Set<string>();

  for (const player of players) {
    if (!player.imageUrl) continue;
    urls.add(player.imageUrl);
    if (urls.size >= limit) break;
  }

  return [...urls];
}

export async function preloadPlayerImages(
  players: readonly Pick<Player, "imageUrl">[],
  {
    limit = DEFAULT_PRELOAD_LIMIT,
    concurrency = DEFAULT_PRELOAD_CONCURRENCY,
    timeoutMs = DEFAULT_PRELOAD_TIMEOUT_MS,
    signal,
    createImage = () => new Image(),
  }: PlayerImagePreloadOptions = {},
) {
  const urls = uniquePlayerImageUrls(players, limit);
  if (urls.length === 0 || signal?.aborted) return;

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeoutId = globalThis.setTimeout(
    abort,
    Math.max(0, timeoutMs),
  );
  let nextIndex = 0;

  async function preloadUrl(url: string) {
    if (controller.signal.aborted) return;
    const image = createImage();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";

    let removeAbortListener = () => {};
    const aborted = new Promise<void>((resolve) => {
      const onAbort = () => {
        try {
          image.src = "";
        } catch {
          // A test double or browser may reject clearing an in-flight URL.
        }
        resolve();
      };
      controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      removeAbortListener = () =>
        controller.signal.removeEventListener("abort", onAbort);
    });

    image.src = url;
    try {
      const decode =
        typeof image.decode === "function"
          ? Promise.resolve()
              .then(() => image.decode())
              .catch(() => undefined)
          : Promise.resolve();
      await Promise.race([decode, aborted]);
    } finally {
      removeAbortListener();
    }
  }

  async function preloadNext() {
    while (!controller.signal.aborted && nextIndex < urls.length) {
      const url = urls[nextIndex];
      nextIndex += 1;
      await preloadUrl(url);
    }
  }

  const workerCount = Math.min(
    Math.max(1, Math.floor(concurrency)),
    urls.length,
  );
  try {
    await Promise.all(Array.from({ length: workerCount }, preloadNext));
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}
