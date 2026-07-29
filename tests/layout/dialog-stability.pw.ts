import {
  expect,
  test,
  type Browser,
  type ViewportSize,
} from "@playwright/test";

interface DialogGeometry {
  height: number;
  top: number;
  width: number;
}

const statePairs = [
  {
    name: "身份抽取",
    from: "/identity?return=%2F&audit=identity-rolling",
    to: "/identity?return=%2F&audit=identity-result",
  },
  {
    name: "首次身份抽取",
    from: "/identity?return=%2F&audit=onboarding-rolling",
    to: "/identity?return=%2F&audit=onboarding-result",
  },
  {
    name: "每日题目载入",
    from: "/play/daily?audit=daily-loading",
    to: "/play/daily?audit=daily-error",
  },
  {
    name: "加入匹配队列",
    from:
      "/quick?players=2&bestOf=3&difficulty=easy&visibility=hidden&audit=quick-submitting",
    to:
      "/quick?players=2&bestOf=3&difficulty=easy&visibility=hidden&audit=quick-error",
  },
  {
    name: "取消匹配",
    from: "/matching?audit=matching-canceling",
    to: "/matching?audit=matching-cancel-error",
  },
  {
    name: "创建好友房",
    from: "/room?audit=room-submitting",
    to: "/room?audit=room-error",
  },
  {
    name: "实时连接恢复",
    from: "/play/quick?audit=live-reconnecting",
    to: "/play/quick?audit=live-offline",
  },
  {
    name: "单局结算情绪",
    from: "/play/quick?audit=live-round-win",
    to: "/play/quick?audit=live-round-loss",
  },
  {
    name: "系列赛结算情绪",
    from: "/play/quick?audit=live-series-win",
    to: "/play/quick?audit=live-series-loss",
  },
] as const;

const viewports = [
  { name: "desktop", size: { width: 1600, height: 900 } },
  { name: "mobile", size: { width: 390, height: 844 } },
] as const satisfies readonly {
  name: string;
  size: ViewportSize;
}[];

async function captureDialog(
  browser: Browser,
  viewport: ViewportSize,
  path: string,
): Promise<DialogGeometry> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    await page.goto(path);
    const dialog = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .first();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    let box = await dialog.boundingBox();
    let previousBox = box;
    let stableSamples = 0;
    await expect
      .poll(async () => {
        const nextBox = await dialog.boundingBox();
        if (!nextBox) {
          stableSamples = 0;
          return false;
        }
        if (
          previousBox &&
          Math.abs(nextBox.height - previousBox.height) <= 0.1 &&
          Math.abs(nextBox.width - previousBox.width) <= 0.1 &&
          Math.abs(nextBox.y - previousBox.y) <= 0.1
        ) {
          stableSamples += 1;
        } else {
          stableSamples = 0;
        }
        previousBox = nextBox;
        box = nextBox;
        return stableSamples >= 2;
      }, { intervals: [50], timeout: 3_000 })
      .toBe(true);
    return {
      height: box!.height,
      top: box!.y,
      width: box!.width,
    };
  } finally {
    await context.close();
  }
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    for (const pair of statePairs) {
      test(`${pair.name}切换不改变弹窗几何尺寸`, async ({ browser }) => {
        const before = await captureDialog(
          browser,
          viewport.size,
          pair.from,
        );
        const after = await captureDialog(browser, viewport.size, pair.to);

        const geometry = JSON.stringify({ before, after });
        expect
          .soft(Math.abs(after.height - before.height), geometry)
          .toBeLessThanOrEqual(1);
        expect
          .soft(Math.abs(after.top - before.top), geometry)
          .toBeLessThanOrEqual(1);
        expect
          .soft(Math.abs(after.width - before.width), geometry)
          .toBeLessThanOrEqual(1);
      });
    }
  });
}
