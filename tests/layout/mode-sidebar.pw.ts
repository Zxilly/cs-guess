import { expect, test } from "@playwright/test";

test("English sidebar actions stay within the desktop sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/play/solo?difficulty=easy&audit=solo-active");
  await page.evaluate(() => document.fonts.ready);

  const sidebar = page.locator("aside");
  const soundToggle = page.getByRole("button", {
    name: "Mute site-wide sound effects",
  });
  const backLink = page.getByRole("link", {
    name: "Change Difficulty",
  });

  await expect(sidebar).toBeVisible();
  await expect(soundToggle).toBeVisible();
  await expect(backLink).toBeVisible();

  const sidebarBox = await sidebar.boundingBox();
  const soundBox = await soundToggle.boundingBox();
  const backBox = await backLink.boundingBox();

  expect(sidebarBox).not.toBeNull();
  expect(soundBox).not.toBeNull();
  expect(backBox).not.toBeNull();

  const sidebarRight = sidebarBox!.x + sidebarBox!.width;
  expect(soundBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
  expect(soundBox!.x + soundBox!.width).toBeLessThanOrEqual(sidebarRight);
  expect(backBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
  expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(sidebarRight);
  expect(soundBox!.y + soundBox!.height).toBeLessThanOrEqual(backBox!.y);

  const overflowingHeaders = await page
    .locator("th")
    .evaluateAll((headers) =>
      headers
        .filter((header) => header.scrollWidth > header.clientWidth + 1)
        .map((header) => header.textContent?.trim()),
    );
  expect(overflowingHeaders).toEqual([]);
});
