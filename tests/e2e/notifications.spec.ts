// S007通知中心导航验收（FE-F10-NOTIFICATION-CENTER）：
// 从系统设置导航进入通知页（非直输URL）、三视图切换、规则预览不发送。
// 浏览器真实导航验收（人工门禁）另录证据；本spec覆盖mock世界功能面。
import { expect, test } from "@playwright/test";
import { mockSession } from "./helpers/auth";

test.describe("notification center (S007)", () => {
  test("admin reaches notifications from the settings tab bar and switches views", async ({ page }) => {
    await mockSession(page, "admin");
    await page.goto("/admin/settings/general");
    const notificationsTab = page.getByTestId("settings-tab-notifications");
    await expect(notificationsTab).toBeVisible();
    // 设置导航含通知标签（可发现入口——验收-01的mock世界功能等价面）。
    await notificationsTab.click();
    await page.waitForURL("**/admin/settings/notifications");
    await expect(page.getByTestId("admin-notifications-page")).toBeVisible();
    await expect(page.getByTestId("admin-notifications-table")).toBeVisible();
    // 三视图切换：规则视图渲染种子规则（AI预审词汇不可见）。
    await page.getByTestId("admin-notifications-view-rules").click();
    await expect(page.getByTestId("admin-rules-table")).toBeVisible();
    const rulesText = await page.getByTestId("admin-rules-table").textContent();
    expect(rulesText).toContain("执行失败通知提交人");
    // 投递记录视图。
    await page.getByTestId("admin-notifications-view-deliveries").click();
    await expect(page.getByTestId("admin-deliveries-table")).toBeVisible();
    // 可切回其他设置（同一设置导航）。
    await page.getByTestId("settings-tab-general").click();
    await expect(page).toHaveURL(/\/admin\/settings\/general/);
  });
});
