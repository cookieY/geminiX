import { expect, test } from "@playwright/test";

// FE-F1 smoke: the skeleton renders its two lazy routes. Mock-driven flows are
// covered by vitest against the shared MSW handlers; browser-worker scenarios
// extend this suite when the shell lands in FE-F2.
test("login page renders the structural placeholder", async ({ page }) => {
  await page.goto("/login");
  // base-lyra CardTitle renders a div, not a heading; assert on visible text
  await expect(page.getByText(/登录 Yearning|Sign in to Yearning/)).toBeVisible();
  await expect(page.getByLabel(/用户名|Username/)).toBeVisible();
  await expect(page.getByLabel(/密码|Password/)).toBeVisible();
});

test("unknown routes land on the not-found page", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});
