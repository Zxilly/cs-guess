import { expect, test } from "@playwright/test";

test.describe("English mobile layout", () => {
  test.use({ locale: "en-US", viewport: { width: 390, height: 844 } });

  test("keeps the lobby brand, actions and identity summary readable", async ({
    page,
  }) => {
    await page.goto("/?audit=lobby");
    await page.evaluate(() => document.fonts.ready);

    const brand = page.getByRole("link", {
      name: "CS GUESS · Pro Player Guessing",
    });
    const actions = page.locator('[data-layout="app-header-actions"]');
    const subtitle = page.getByText("Pro Player Guessing", { exact: true });
    const identity = page.locator('[data-layout="compact-player-identity"]');
    const pool = page.locator('[data-layout="compact-identity-pool"]');
    const creditRule = page.locator(
      '[data-layout="compact-identity-credit-rule"]',
    );
    const manageAction = page.locator('[data-layout="identity-manage-action"]');

    await expect(brand).toBeVisible();
    await expect(actions).toBeVisible();
    await expect(subtitle).toBeHidden();
    await expect(identity).toBeVisible();
    await expect(pool).toHaveText(/My Identity · Major Participant Pool/i);
    await expect(creditRule).toHaveText(
      /\d+ draws? · Win 1 game or lose 2 games in total \+1/i,
    );

    const brandBox = await brand.boundingBox();
    const actionsBox = await actions.boundingBox();
    const identityBox = await identity.boundingBox();
    const creditRuleBox = await creditRule.boundingBox();
    const manageBox = await manageAction.boundingBox();

    expect(brandBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    expect(creditRuleBox).not.toBeNull();
    expect(manageBox).not.toBeNull();
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    expect(manageBox!.y).toBeGreaterThanOrEqual(
      creditRuleBox!.y + creditRuleBox!.height,
    );

    for (const content of [pool, creditRule]) {
      const styles = await content.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          overflow: computed.overflow,
          textOverflow: computed.textOverflow,
          whiteSpace: computed.whiteSpace,
        };
      });
      expect(styles.whiteSpace).toBe("normal");
      expect(styles.textOverflow).not.toBe("ellipsis");
    }
  });

  test("uses a complete compact English search prompt", async ({ page }) => {
    await page.goto("/play/solo?difficulty=easy&audit=solo-active");
    await page.evaluate(() => document.fonts.ready);

    const search = page.getByRole("combobox", {
      name: "Search and select a player by nickname, name, team, or country",
    });

    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute(
      "placeholder",
      "Search players, teams, or countries",
    );
  });
});
