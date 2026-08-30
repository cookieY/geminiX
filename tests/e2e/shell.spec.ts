import { expect, test } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F2/F3 shell e2e: the logged-in shell (sidebar, header, footer) renders
// with Yearning content over the production build with the shared MSW worker.
// Sessions are real cookie sessions produced by the mock auth handlers.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
  await mockSession(page, "admin");
  await page.goto("/workspace");
  await page.evaluate(() => document.fonts.ready);
});

test("the shell renders navigation groups, header actions and the workspace placeholder", async ({
  page,
}) => {
  await expect(page.getByText("工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("审计", { exact: true })).toBeVisible();
  await expect(page.getByText("审核引擎")).toBeVisible();
  await expect(page.getByText("工作台内容尚未交付")).toBeVisible();
});

test("admin navigation follows the server capability", async ({ page }) => {
  // Admin session (can_access_admin=true from /users/me): admin groups show.
  await expect(page.getByRole("link", { name: "用户" })).toBeVisible();
  await expect(page.getByRole("link", { name: "数据源" })).toBeVisible();

  // Zero-permission session: the same UI hides them — presentation only.
  await page.context().clearCookies();
  await mockSession(page, "default");
  await page.goto("/workspace");
  await expect(page.getByText("等待管理员配置权限")).toBeVisible();
  await expect(page.getByRole("link", { name: "用户" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "数据源" })).toHaveCount(0);
});

test("the admin capability guard blocks /admin/users for zero-permission users", async ({
  page,
}) => {
  await page.context().clearCookies();
  await mockSession(page, "default");
  await page.goto("/admin/users");
  await expect(page.getByText("无权访问")).toBeVisible();
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
  // /changes/mine (我的工单) is built since FE-F6; 工单审批 (/approvals/changes)
  // stays unbuilt until the approval workspace package.
  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});

test("unknown routes land on the not-found page", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});
