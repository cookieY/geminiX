import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

/**
 * FE-F10 acceptance gates (work package acceptance_gates):
 *
 * 1. 查询仅单SELECT且无限总量分页 — the server's 4007 refusal renders
 *    inline; result footers report rows ALREADY READ from the cursor and
 *    never a fabricated total.
 * 2. admin撤销用户可感知且admin不能查看查询 — revocation flips the
 *    workspace into the non-dismissible blocked notice with the reason;
 *    the builtin admin identity sees no query objects (admin_is_not_
 *    business_override) and another user's session URL is refused.
 * 3. 流程/数据源/权限组表单字段符合新模型 — the query-flow form carries
 *    no SQL/rule-set/executor fields; permission groups grant flows only.
 * 4. Migration UI不能启动Apply — the migration workbench gates approval
 *    behind per-candidate confirmation and the APPROVE phrase and never
 *    offers an Apply entry (verified at component level; the route swap
 *    itself is unit-tested — migration mode needs the dedicated server).
 * 5. 旧核心页面无未处置项 — every remaining §2 nav target renders a real
 *    page and the prohibited scan keeps AutoTask/legacy transfers out.
 */

async function useScenario(page: Page, scenario: string): Promise<void> {
  await page.addInitScript(
    (value) => {
      window.localStorage.setItem("yearning-mock-scenario", value);
    },
    scenario,
  );
}

/** Types SQL through the real Monaco surface (precheck.spec precedent). */
async function typeSql(page: Page, sql: string): Promise<void> {
  // Click the editor's top-left surface: a previous inline run error
  // renders below the editor and would otherwise intercept the pointer.
  await page.getByTestId("query-sql-editor").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(sql);
}

test.beforeEach(async ({ page }) => {
  // Chinese assertion vocabulary, pinned like the other specs (headless
  // Chromium reports en-US).
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
  await mockSession(page, "default");
});

test("gate 1: single-SELECT only and cursor pagination without totals", async ({ page }) => {
  await useScenario(page, "query-session");
  await page.goto("/query/sessions/qs-fixture-active");
  await expect(page.getByTestId("query-workspace")).toBeVisible();

  // A write statement is refused by the server's safety check (4007) and
  // renders inline — the client hint never replaces server validation.
  await page.getByTestId("query-schema-input").fill("app");
  await typeSql(page, "delete from app.users");
  await page.getByTestId("query-run").click();
  await expect(page.getByTestId("query-run-error")).toContainText("仅允许执行单条SELECT");

  // A legal SELECT streams the first cursor page; the footer states rows
  // already read and offers continuation — no total anywhere.
  await typeSql(page, "select id from app.users");
  await page.getByTestId("query-run").click();
  const loaded = page.locator("[data-testid^='query-result-loaded-']").first();
  await expect(loaded).toContainText("已读取 500 行");
  await expect(page.getByTestId("query-workspace")).not.toContainText("共 ");
  await page.getByTestId("query-result-load-more").click();
  await expect(loaded).toContainText("已读取 1000 行");

  // Masked vocabulary columns render the unified masking badge.
  await typeSql(page, "select id, email from app.users");
  await page.getByTestId("query-run").click();
  await expect(page.getByText("已按敏感字段策略脱敏").first()).toBeVisible();
});

test("gate 2: revocation is perceivable and the admin has no query read face", async ({ page }) => {
  await useScenario(page, "query-session");
  await page.goto("/query/sessions/qs-fixture-active");
  await expect(page.getByTestId("query-workspace")).toBeVisible();

  // The session user is the frozen flow reviewer. A full page reload would
  // reset the in-memory mock world (F4-recorded limitation), so the
  // revocation command runs through the page's own fetch — the same module
  // world the workspace poll reads; the approvals-page revocation UI is
  // covered by component tests.
  await page.evaluate(async () => {
    const grants = await (await fetch("/api/v4/query-grants")).json();
    const grant = grants.data.items.find((row: { state: string }) => row.state === "active");
    const response = await fetch(`/api/v4/query-grants/${grant.id}/revocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": `"${String(grant.version)}"`, "Idempotency-Key": "e2e-revoke-1" },
      body: JSON.stringify({ reason: "e2e rotation" }),
    });
    const envelope = await response.json();
    if (envelope.err_code !== 0) throw new Error(`revoke failed: ${JSON.stringify(envelope)}`);
  });

  // The workspace poll flips into the non-dismissible blocked notice with
  // the reason (Q004 撤销必须向查询人可见).
  await expect(page.getByTestId("query-revoked-notice")).toContainText("访问资格已被撤销", { timeout: 10_000 });
  await expect(page.getByTestId("query-revoked-notice")).toContainText("e2e rotation");
  await expect(page.getByTestId("query-run")).toBeDisabled();

  // Another user's session is refused for every identity — including the
  // builtin admin (Q004 grants revocation, never reads). A fresh load is
  // fine here: the world reset only restores the seeded other-user session.
  await page.goto("/query/sessions/qs-fixture-other");
  await expect(page.getByTestId("query-workspace-error")).toBeVisible();

});

test("gate 2b: the builtin admin identity owns no query objects", async ({ page }) => {
  await useScenario(page, "query-session");
  await mockSession(page, "admin");
  await page.goto("/query");
  await expect(page.getByTestId("query-entry")).toBeVisible();
  // admin_is_not_business_override: the admin reads no query flows, grants
  // or sessions — the fresh admin session sees the honest empty page.
  await expect(page.getByTestId("query-entry")).not.toContainText("进行中的会话");
  await expect(page.getByTestId("query-entry")).toContainText("暂无可用查询流程");
});

test("gate 3: flow and permission-group forms follow the new model", async ({ page }) => {
  await useScenario(page, "query-session");
  // The admin surfaces render under the admin capability from the start —
  // no mid-test identity flip needed here.
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-mock-auth", "admin");
  });
  await page.goto("/admin/flows");
  await expect(page.getByTestId("admin-flows-table")).toBeVisible();

  await page.getByTestId("admin-flows-create-query").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const text = await dialog.textContent();
  // §3: query flows carry no SQL, rule set or executor fields.
  expect(text).not.toContain("Rule Set");
  expect(text).not.toContain("执行人");
  expect(text).toContain("不会影响已提交工单");
  await page.keyboard.press("Escape");

  // Permission groups grant flows (both kinds) — the legacy datasource
  // transfers have no v4 surface anywhere on the page.
  await page.goto("/admin/permission-groups");
  await expect(page.getByTestId("admin-groups-table")).toBeVisible();
  const bodyText = await page.locator("body").textContent();
  expect(bodyText).not.toContain("ddl_source");
  expect(bodyText).not.toContain("dml_source");
  expect(bodyText).not.toContain("query_source");
  expect(bodyText).not.toContain("自动化任务");
});

test("gate 5: the remaining core pages render real content", async ({ page }) => {
  await useScenario(page, "query-session");
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-dashboard-cards")).toBeVisible();
  await expect(page.getByTestId("dashboard-draft-count")).toBeVisible();
  await expect(page.getByTestId("workspace-announcement")).toBeVisible();

  // 我的工单-查询工单 tab shows the unified query view.
  await page.goto("/changes/mine");
  await page.getByTestId("tab-query-orders").click();
  await expect(page.getByTestId("orders-query-table")).toBeVisible();
  const row = page.locator("[data-testid^='orders-query-row-']").first();
  await row.click();
  await expect(page.getByTestId("orders-query-detail")).toBeVisible();

});

test("gate 5b: audit records render for the admin read face", async ({ page }) => {
  await useScenario(page, "query-session");
  await mockSession(page, "admin");
  await page.goto("/records");
  await expect(page.getByTestId("records-table")).toBeVisible();
  const row = page.locator("[data-testid^='records-row-']").first();
  await row.click();
  await expect(page.getByTestId("records-detail")).toBeVisible();
});
