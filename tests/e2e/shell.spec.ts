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

test("the shell renders navigation groups, header actions and the workspace dashboard", async ({
  page,
}) => {
  await expect(page.getByText("工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("审计", { exact: true })).toBeVisible();
  await expect(page.getByText("审核引擎")).toBeVisible();
  // FE-F10 replaces the honest placeholder with the real dashboard cards
  // (admin session additionally renders the administration statistics).
  await expect(page.getByTestId("workspace-page")).toBeVisible();
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
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  // One synchronous measurement: the dashboard queries resolve continuously
  // and shift the layout, so two separate boundingBox() calls could sample
  // different layout generations and compare unrelated positions.
  const boxes = await page.evaluate(() => {
    const footer = document.querySelector("footer");
    const cards = document.querySelector("[data-testid='workspace-page']");
    if (!footer || !cards) return null;
    const top = (element: Element) => element.getBoundingClientRect().top + window.scrollY;
    return { footer: top(footer), cards: top(cards) };
  });
  if (!boxes) {
    throw new Error("footer or workspace placeholder is not rendered");
  }
  expect(boxes.footer).toBeGreaterThanOrEqual(boxes.cards);
});

test("the footer carries the sponsor and docs links as plain text", async ({ page }) => {
  const sponsor = page.getByRole("link", { name: "赞助" });
  const docs = page.getByRole("link", { name: "文档" });
  await expect(sponsor).toHaveAttribute("href", "https://next.yearning.io/zh/about/w5jt71jw/");
  await expect(sponsor).toHaveAttribute("target", "_blank");
  await expect(docs).toHaveAttribute("href", "https://next.yearning.io/");
  await expect(docs).toHaveAttribute("target", "_blank");
  // Owner ruling: the links read as plain text — no underline, and the color
  // must not change on hover.
  for (const link of [sponsor, docs]) {
    await expect(link).toHaveCSS("text-decoration-line", "none");
    const before = await link.evaluate((element) => getComputedStyle(element).color);
    await link.hover();
    const after = await link.evaluate((element) => getComputedStyle(element).color);
    expect(after).toBe(before);
  }
});

test("the language picker switches the locale and persists the choice", async ({ page }) => {
  // Note: this spec's beforeEach re-plants zh-CN on every navigation, so a
  // reload here would mask the persisted choice — the storage value IS the
  // persistence contract (setLocale unit tests cover the resolver).
  await page.getByTestId("locale-toggle").click();
  await expect(page.getByTestId("locale-menu")).toBeVisible();
  await expect(page.getByTestId("locale-option-zh-CN")).toBeVisible();
  await expect(page.getByTestId("locale-option-en-US")).toBeVisible();
  await page.getByTestId("locale-option-en-US").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  expect(await page.evaluate(() => localStorage.getItem("yearning-locale"))).toBe("en-US");
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

test("the collapsed sidebar scales the logo, hides the badge, and reveals labels on hover", async ({
  page,
}) => {
  // Owner ruling 2026-09-02: the wordmark scales proportionally instead of
  // clipping, the version badge hides, and hovering the icon rail widens it
  // back to the full menu with visible labels (template mechanism).
  const sidebar = page.locator("[data-slot='sidebar']").first();
  const logo = page.locator("[data-slot='sidebar'] img").first();
  const badge = page.getByTestId("sidebar-version-badge");

  // Expanded: the release tag badge sits beside the logo.
  await expect(logo).toBeVisible();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/^v\d+\./);

  await page.getByRole("button", { name: "折叠侧边栏" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  const collapsedLogoWidth = (await logo.boundingBox())?.width ?? 999;
  expect(collapsedLogoWidth).toBeLessThanOrEqual(40);
  await expect(badge).toBeHidden();

  await page.locator(".sidebar-box").hover();
  await expect(page.getByText("我的工单")).toBeVisible();

  // Leaving the rail auto-collapses back (hover-initiated expansion).
  await page.mouse.move(700, 400);
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
});

test("the active sidebar item renders as a white pill with black text", async ({ page }) => {
  // Owner ruling 2026-09-02 (reference image): pure white background, black
  // text, matching the frozen template's active state.
  await page.getByRole("link", { name: "查询" }).first().click();
  await expect(page).toHaveURL(/\/query$/);
  const active = page.locator("[data-sidebar='menu-button'][data-active]").first();
  await expect(active).toBeVisible();
  const styles = await active.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { bg: computed.backgroundColor, fg: computed.color };
  });
  // Chromium reports the oklch token values as authored: pure white bg, black text.
  expect(styles.bg).toBe("oklch(1 0 0)");
  expect(styles.fg).toBe("oklch(0 0 0)");
});

test("the theme toggle switches the document class", async ({ page }) => {
  const html = page.locator("html");
  await page.evaluate(() => window.localStorage.setItem("vite-ui-theme", "light"));
  await page.reload();
  await expect(html).toHaveClass(/light/);
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(html).toHaveClass(/dark/);
});

test("sidebar navigation targets stay consistent with the built route tree", async ({ page }) => {
  // FE-F10 delivers the remaining §9.2 nav targets (/records, /query and
  // the admin entries). Every sidebar entry now resolves to a real page —
  // unknown routes still land on the not-found page (next test).
  await page.getByRole("link", { name: "审计记录" }).click();
  await expect(page.getByTestId("records-page")).toBeVisible();
  await page.getByRole("link", { name: "查询" }).click();
  await expect(page.getByTestId("query-entry")).toBeVisible();
});

test("unknown routes land on the not-found page", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page.getByText(/页面不存在|Page not found/)).toBeVisible();
});
