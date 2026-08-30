import { expect, test } from "@playwright/test";
import { loginViaForm, mockSession, setMockAuthBehavior } from "./helpers/auth";

// FE-F3 acceptance gates (work package FE-F3-API-AUTH): mock login, logout,
// expiry and no-permission flows; server capability drives admin routes; the
// session token never enters a URL or web storage.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
});

test("login through the form lands on the workspace", async ({ page }) => {
  await loginViaForm(page);
  await expect(page.getByText("等待管理员配置权限")).toBeVisible();
  await expect(page).toHaveURL(/\/workspace$/);
});

test("login with wrong credentials shows the mapped business error", async ({ page }) => {
  await setMockAuthBehavior(page, "invalid_credentials");
  await loginViaForm(page);
  // err_code 1101 is declared for the login operation; its message comes from
  // the i18n catalog, never the raw error name.
  await expect(page.getByText("用户名或密码不正确。")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("the locked admin sees the server-side reset command hint", async ({ page }) => {
  await setMockAuthBehavior(page, "admin_locked");
  await loginViaForm(page, "admin", "fixture-pw");
  await expect(page.getByText("超级管理员已锁定")).toBeVisible();
  await expect(page.getByText("./Yearning --reset-admin-password")).toBeVisible();
});

test("logout revokes the session and returns to the login page", async ({ page }) => {
  await mockSession(page, "admin");
  await page.goto("/workspace");
  await expect(page.getByText("工作台内容尚未交付")).toBeVisible();
  await page.getByRole("button", { name: "账户菜单" }).click();
  const signOut = page.getByRole("button", { name: /退出登录/ });
  await expect(signOut).toBeEnabled();
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
});

test("an expired session is redirected to the login page", async ({ page }) => {
  await mockSession(page, "default");
  await page.goto("/workspace");
  await expect(page.getByText("等待管理员配置权限")).toBeVisible();
  // The expiry is discovered server-side on the next /users/me call.
  await setMockAuthBehavior(page, "expired");
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login$/);
});

test("the session token stays out of URLs and web storage", async ({ page }) => {
  await mockSession(page, "admin");
  await page.goto("/workspace");
  await expect(page.getByText("工作台内容尚未交付")).toBeVisible();
  const evidence = await page.evaluate(() => ({
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
    cookieNames: document.cookie.split(";").map((entry) => entry.trim().split("=")[0]),
    url: window.location.href,
  }));
  expect(evidence.localStorage).not.toContain("e2e-session-token");
  expect(evidence.sessionStorage).not.toContain("e2e-session-token");
  expect(evidence.url).not.toContain("token");
  // document.cookie may only carry the session/CSRF pair — the app itself
  // never persists credential material anywhere else. The HttpOnly response
  // attribute is enforced by the backend; the mock echoes the contract header
  // (asserted in auth-handlers.test.ts) and its live behavior is verified
  // against the real server in FE-F12.
  expect(evidence.cookieNames.sort()).toEqual(["yearning_csrf", "yearning_session"]);
});

test("mutating requests carry the CSRF double-submit header", async ({ page }) => {
  await mockSession(page, "admin");
  await page.goto("/workspace");
  await expect(page.getByText("工作台内容尚未交付")).toBeVisible();
  await page.getByRole("button", { name: "账户菜单" }).click();
  const logoutRequest = page.waitForRequest((request) =>
    request.url().includes("/auth/logout"),
  );
  await page.getByRole("button", { name: /退出登录/ }).click();
  const request = await logoutRequest;
  expect(request.headers()["x-csrf-token"]).toBe("e2e-csrf-token");
});
