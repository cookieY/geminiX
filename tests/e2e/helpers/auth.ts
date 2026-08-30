import type { Page } from "@playwright/test";

/**
 * Mock session bootstrap for e2e (shared MSW handlers, code-generation-policy
 * mock_layer). The `yearning_session` HttpOnly cookie is planted directly in
 * the browser cookie jar exactly as a real login would leave it — no token
 * ever lives in web storage or a URL. The behavior dimension is read per
 * request by the auth mock handlers, so expiry and lock-out can be flipped
 * mid-test.
 */
export type MockAuthBehavior =
  | "default"
  | "admin"
  | "invalid_credentials"
  | "admin_locked"
  | "expired";

export async function mockSession(page: Page, behavior: MockAuthBehavior = "admin"): Promise<void> {
  await page.addInitScript(`window.localStorage.setItem('yearning-mock-auth', '${behavior}');`);
  await page.context().addCookies([
    {
      name: "yearning_session",
      value: "e2e-session-token",
      url: "http://localhost:4173",
    },
    { name: "yearning_csrf", value: "e2e-csrf-token", url: "http://localhost:4173" },
  ]);
}

/**
 * Flips the behavior mid-test. Uses an init script so it works before any
 * navigation (about:blank denies localStorage access) and an immediate write
 * once a real document exists, so handlers read the new value on the next
 * request without a reload.
 */
export async function setMockAuthBehavior(page: Page, behavior: MockAuthBehavior): Promise<void> {
  await page.addInitScript(`window.localStorage.setItem('yearning-mock-auth', '${behavior}');`);
  const url = page.url();
  if (url !== "" && !url.startsWith("about:")) {
    await page.evaluate((next) => {
      window.localStorage.setItem("yearning-mock-auth", next);
    }, behavior);
  }
}

/** Logs in through the real UI form and waits for the workspace to appear. */
export async function loginViaForm(page: Page, username = "henry", password = "fixture-pw"): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/用户名|Username/).fill(username);
  await page.getByLabel(/密码|Password/).fill(password);
  await page.getByRole("button", { name: /登录|Sign in/ }).click();
}
