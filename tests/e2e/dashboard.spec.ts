import { expect, test } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// Owner layout-alignment ruling 2026-09-02 (reference image
// app-shell-home-zh-cn-v1): the home renders the operations order trend
// chart plus the 查询次数/用户数/数据源 stat cards from
// /admin/dashboard/operations. §18.71 (owner ruling 2026-10-16) widens that
// surface to every authenticated session — the zero-permission home renders
// the same platform statistics (dashboard PRD §9 superseded).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
});

test("admin home renders the order trend chart and the reference stat cards", async ({
  page,
}) => {
  await mockSession(page, "admin");
  await page.goto("/workspace");
  const trend = page.getByTestId("workspace-order-trend-chart");
  await expect(trend).toBeVisible();
  await expect(trend.locator("svg")).toBeVisible();
  await expect(page.getByTestId("admin-order-total")).toHaveText("47");
  await expect(page.getByTestId("admin-query-total")).toHaveText("23K");
  await expect(page.getByTestId("admin-user-total")).toHaveText("12");
  await expect(page.getByTestId("admin-datasource-total")).toHaveText("5");
  // Decorative sparklines render on each reference stat card (owner ruling
  // 2026-09-02) — hidden from accessibility, layered beneath the text.
  const sparks = page.getByTestId("workspace-admin-stat-cards").getByTestId("stat-bars");
  await expect(sparks).toHaveCount(3);
  await expect(sparks.first()).toHaveAttribute("aria-hidden", "true");
  // The reference "Total Assets" slot carries the announcement; the
  // reference "Update" slot carries the latest GitHub release with the
  // notes excerpt and a details link (deterministic same-origin fixture).
  await expect(page.getByTestId("workspace-announcement")).toBeVisible();
  const banner = page.getByTestId("workspace-release-banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId("release-tag")).toHaveText("v4.1.0");
  await expect(banner.getByTestId("release-notes-excerpt")).toContainText("…");
  await expect(banner.getByRole("link", { name: "更新内容详情" })).toHaveAttribute(
    "href",
    "/mock/github-releases/latest/v4.1.0",
  );
});

test("the window selector refetches operations with the requested window", async ({
  page,
}) => {
  await mockSession(page, "admin");
  const operationsCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/admin/dashboard/operations")) {
      operationsCalls.push(request.url());
    }
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-order-trend-chart")).toBeVisible();

  await page.getByTestId("admin-trend-window").click();
  await page.getByRole("option", { name: "最近7天" }).click();
  await expect
    .poll(() => operationsCalls.some((url) => url.includes("window_days=7")))
    .toBe(true);
  // The fixture honors window_days in meta, so the round trip is visible.
  await expect(page.getByTestId("workspace-admin-operations")).toContainText("2026-08-26");
});

test("zero-permission home renders the platform statistics (§18.71)", async ({ page }) => {
  const operationsCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/admin/dashboard/operations")) {
      operationsCalls.push(request.url());
    }
  });
  await mockSession(page, "default");
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  await expect(page.getByTestId("workspace-announcement")).toBeVisible();
  // The release banner is public repository metadata — every user sees it.
  await expect(page.getByTestId("workspace-release-banner")).toBeVisible();
  // §18.71: platform statistics are an authenticated-session surface — the
  // zero-permission home fetches operations and renders the same trend +
  // stat cards the admin home shows.
  await expect(page.getByTestId("workspace-admin-dashboards")).toBeVisible();
  await expect(page.getByTestId("admin-order-total")).toHaveText("47");
  expect(operationsCalls.length).toBeGreaterThan(0);
});

test("the manual refresh control refetches the personal dashboard", async ({ page }) => {
  await mockSession(page, "admin");
  let meCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/dashboard/me")) {
      meCalls += 1;
    }
  });
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-order-trend-chart")).toBeVisible();
  const before = meCalls;
  await page.getByTestId("workspace-refresh").click();
  await expect.poll(() => meCalls).toBeGreaterThan(before);
});
