import { expect, test } from "@playwright/test";

// FE-F2 shell e2e: the logged-in shell (sidebar, header, footer) renders with
// Yearning content over the production build. Mock-driven scenario flows
// remain covered by vitest against the shared MSW handlers.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
  await page.goto("/workspace");
  await page.evaluate(() => document.fonts.ready);
});

test("the shell renders navigation groups, header actions and the workspace placeholder", async ({
  page,
}) => {
  await expect(page.getByText("工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("审计", { exact: true })).toBeVisible();
  await expect(page.getByText("审核引擎")).toHaveCount(0);
  await expect(page.getByText("工作台内容尚未交付")).toBeVisible();
});

test("admin navigation is hidden for the placeholder user session", async ({ page }) => {
  await expect(page.getByRole("link", { name: "用户" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "数据源" })).toHaveCount(0);
});

test("the global footer shows the exact license line and stays below the content", async ({
  page,
}) => {
  const footer = page.getByText("AGPL-3.0 Licensed | Copyright © 2017-present Henry Yee");
  await expect(footer).toBeVisible();
  const footerBox = await footer.boundingBox();
  const contentBox = await page.getByText("工作台内容尚未交付").boundingBox();
  if (!footerBox || !contentBox) {
    throw new Error("footer or workspace placeholder is not rendered");
  }
  expect(footerBox.y).toBeGreaterThanOrEqual(contentBox.y);
});

test("the sidebar collapses to icon mode and back", async ({ page }) => {
  // data-state lives on the inner sidebar element, not the wrapper
  const sidebar = page.locator("[data-slot='sidebar']").first();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.getByRole("button", { name: "折叠侧边栏" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.getByRole("button", { name: "折叠侧边栏" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
});

test("the theme toggle switches the document class", async ({ page }) => {
  const html = page.locator("html");
  await page.evaluate(() => window.localStorage.setItem("vite-ui-theme", "light"));
  await page.reload();
  await expect(html).toHaveClass(/light/);
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(html).toHaveClass(/dark/);
});

test("unbuilt navigation targets land on the not-found page", async ({ page }) => {
  await page.getByRole("link", { name: "我的工单" }).click();
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});

test("unknown routes land on the not-found page", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});
