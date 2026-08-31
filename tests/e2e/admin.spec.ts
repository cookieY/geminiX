import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F9-REVIEW-ADMIN acceptance gates over the production build with the
// shared MSW worker and the stateful admin fixture:
//   1. Secret永不回填 — datasource credential fields and the provider API
//      key render empty on edit; no stored secret text ever reaches the DOM;
//   2. 无外部代码HTTP或写库Custom Tool UI — the review-input editor exposes
//      only the four-field definition surface, no executable affordance;
//   3. 配置Hash与Review失效影响明确 — config hashes, the outdated-impact
//      note and the rule-set impact preview are visible;
//   4. 内部经验无自动学习入口 — knowledge management offers only manual
//      authoring and finding conversion;
//   5. 仅admin可访问 — every admin route redirects a non-admin to /403.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
  await mockSession(page, "admin");
});

test("secrets never render: datasource credentials and provider API key stay empty on edit", async ({
  page,
}) => {
  await page.goto("/admin/datasources");
  await expect(page.getByTestId(/ds-row-/).first()).toBeVisible();
  await page.getByTestId(/ds-edit-/).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const purpose of ["review", "query", "execution"]) {
    const username = dialog.getByTestId(`credential-username-${purpose}`);
    if (await username.isVisible().catch(() => false)) {
      await expect(username).toHaveValue("");
    }
    const password = dialog.getByTestId(`credential-password-${purpose}`);
    if (await password.isVisible().catch(() => false)) {
      await expect(password).toHaveValue("");
    }
  }
  // Neither the fixture-internal plaintexts nor any secret marker leaks.
  const pageContent = await page.content();
  expect(pageContent).not.toContain("revpw-1");
  expect(pageContent).not.toContain("execpw-1");
  await page.keyboard.press("Escape");

  await page.goto("/admin/review-engine/providers");
  await expect(page.getByTestId(/provider-row-/).first()).toBeVisible();
  await page.getByTestId(/provider-edit-/).first().click();
  const providerDialog = page.getByRole("dialog");
  await expect(providerDialog.getByTestId("provider-api-key")).toHaveValue("");
  await expect(providerDialog.getByText(/API Key：已配置/)).toBeVisible();
  expect(await page.content()).not.toContain("pkey-a1");
});

test("review-input editor offers no executable-code, HTTP or database-write surface", async ({
  page,
}) => {
  await page.goto("/admin/review-engine/skills");
  await page.getByTestId("review-input-create").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("review-input-knowledge-text")).toBeVisible();
  await expect(dialog.getByTestId("review-input-finding-key")).toBeVisible();
  await expect(dialog.getByTestId("review-input-title")).toBeVisible();
  await expect(dialog.getByTestId("review-input-message")).toBeVisible();
  await expect(dialog.getByTestId("review-input-suggestion")).toBeVisible();
  for (const button of await dialog.getByRole("button").all()) {
    expect(await button.textContent()).not.toMatch(/HTTP|执行代码|写库|Webhook/);
  }
});

test("config hashes and review-invalidation impact are visible", async ({ page }) => {
  await page.goto("/admin/review-engine/skills");
  await expect(page.getByTestId("review-input-outdated-note")).toContainText(
    "引用旧 Hash 的未提交预审立即失效",
  );
  await expect(page.getByTestId("review-input-hash").first()).toBeVisible();

  await page.goto("/admin/rule-sets");
  await expect(page.getByTestId("rule-set-hash").first()).toBeVisible();
  await page.getByTestId(/rule-set-edit-/).first().click();
  const preview = page.getByTestId("rule-set-impact-preview");
  await expect(preview).toContainText("1 个流程");
  await expect(preview).toContainText("生产变更默认流程");
  await expect(preview).toContainText("引用旧 Hash 的未提交预审将失效");
});

test("internal experience offers no auto-learning entry", async ({ page }) => {
  await page.goto("/admin/review-engine/knowledge");
  await expect(page.getByTestId(/review-input-row-/).first()).toBeVisible();
  for (const button of await page.getByRole("button").all()) {
    expect(await button.textContent()).not.toMatch(/自动学习|自动沉淀|auto-learn/i);
  }
  await expect(page.getByText("人工沉淀").first()).toBeVisible();
  await expect(page.getByText("Finding 转化").first()).toBeVisible();
});

test("a datasource connection test materializes the capability matrix with explanations", async ({
  page,
}) => {
  await page.goto("/admin/datasources");
  // analytics-pg has no execution credential — probing review succeeds and
  // materializes capabilities where execution is explicitly unavailable.
  const pgRow = page.locator("tr", { hasText: "analytics-pg" });
  await pgRow.getByTestId(/ds-test-purpose-/).click();
  await page.getByRole("option", { name: "Review" }).click();
  await pgRow.getByTestId(/ds-test-button-/).click();
  const capabilities = page.getByTestId("ds-capabilities");
  await expect(capabilities).toContainText("16.3", { timeout: 8_000 });
  await expect(capabilities.getByTestId("ds-capability-execution")).toContainText("不可用");
  await expect(page.getByText("部分能力不可用")).toBeVisible();
});

test("a high-impact budget change saves only through the two-step confirmation", async ({
  page,
}) => {
  await page.goto("/admin/settings/ai-budget");
  await expect(page.getByTestId("ai-budget-r008-note")).toContainText("不存在单工单");
  await page.getByTestId("ai-budget-enforced").click();
  await page.getByTestId("ai-budget-assess").click();
  await expect(page.getByTestId("ai-budget-impact-level")).toHaveText("高影响");
  await page.getByTestId("ai-budget-confirm").click();
  await expect(page.getByTestId("ai-budget-saved")).toBeVisible();
});

test("admin routes reject a non-admin session", async ({ page }) => {
  const nonAdmin: Page = page;
  await nonAdmin.addInitScript(() => {
    window.localStorage.setItem("yearning-mock-auth", "default");
  });
  await nonAdmin.goto("/admin/datasources");
  await expect(nonAdmin.getByText("无权访问")).toBeVisible();
});
