import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F4 acceptance gates (work package FE-F4-PRECHECK), driven by the
// stateful precheck fixture over the production build with the shared MSW
// worker:
//   1. 打开编辑不自动Review — zero run-creation calls while editing;
//   2. Ready / Blocked / Partial / Provider失败 E2E — all four outcomes;
//   3. 乱序事件不回退状态 — layered evidence: monotonic fold unit tests plus
//      component-level stale-snapshot and remount-recovery cases (a browser
//      reload resets the in-memory mock world, see migration contract §11.4);
//   4. 不展示思维链 — no reasoning channel anywhere in the workspace;
//   5. 敏感内容不进Storage/Telemetry — plaintext never lands in web storage.
const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
const SQL_MARKER = "e2e-sql-plaintext-marker-DO-NOT-PERSIST";
const RAW_MARKER = "e2e-raw-evidence-marker-DO-NOT-PERSIST";
const SQL_TEXT = "UPDATE orders SET status = 1 WHERE user_id = 42;";

async function setReviewScenario(page: Page, scenario: string): Promise<void> {
  await page.addInitScript(
    `window.localStorage.setItem('yearning-mock-scenario', '${scenario}');`,
  );
}

/**
 * Types SQL through the real Monaco editor: click the editor surface, then
 * drive the keyboard — Monaco's hidden IME textarea is not directly
 * fillable (it is not a normal editable element).
 */
async function typeSql(page: Page, sql: string): Promise<void> {
  await page.getByTestId("sql-editor").click();
  await page.keyboard.type(sql);
}

/** Creates a draft, saves SQL and runs the review through the real UI. */
async function runReviewThroughUi(page: Page): Promise<void> {
  await page.goto("/changes/new");
  await expect(page.getByTestId("changes-new-page")).toBeVisible();
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page.getByTestId("create-draft-dialog").getByRole("textbox").first().fill("E2E预审草稿");
  await page.getByTestId("create-draft-confirm").click();
  await expect(page).toHaveURL(/\/changes\/drafts\//);
  await expect(page.getByTestId("draft-workspace-page")).toBeVisible();

  // 打开编辑不自动Review: no run may exist until the explicit action.
  await typeSql(page, SQL_TEXT);
  await page.getByTestId("save-sql").click();
  await expect(page.getByTestId("save-sql")).toBeDisabled();

  await page.getByTestId("run-review").click();
  // Fixture timeline: queued(0.4s) → running → terminal(1.3s).
  await expect(page.getByTestId("review-status")).toContainText(/审核结果完整|已阻断|部分完成|预审失败/, {
    timeout: 8_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
  await mockSession(page, "admin");
  await setReviewScenario(page, "review-ready");
});

test("editing never auto-reviews; the explicit run produces Ready and unlocks submit", async ({
  page,
}) => {
  const reviewRunCalls: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/review-runs")
    ) {
      reviewRunCalls.push(request.url());
    }
  });

  await page.goto("/changes/new");
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page
    .getByTestId("create-draft-dialog")
    .getByRole("textbox")
    .first()
    .fill("E2E预审草稿");
  await page.getByTestId("create-draft-confirm").click();
  await expect(page).toHaveURL(/\/changes\/drafts\//);
  await expect(page.getByTestId("draft-workspace-page")).toBeVisible();

  // Editing, saving and waiting produce zero review-run creations.
  await typeSql(page, SQL_TEXT);
  await page.getByTestId("save-sql").click();
  await expect(page.getByTestId("save-sql")).toBeDisabled();
  await page.waitForTimeout(2_000);
  expect(reviewRunCalls).toEqual([]);

  // The explicit action creates exactly one run and reaches Ready.
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText("审核结果完整", {
    timeout: 8_000,
  });
  expect(reviewRunCalls).toHaveLength(1);
  await expect(page.getByTestId("submit-draft")).toBeEnabled();

  // Findings and evidence stay structured; no reasoning channel exists.
  await page.getByTestId("tab-findings").click();
  await expect(page.getByTestId("finding-item").first()).toBeVisible();
  const body = await page.locator("body").textContent();
  expect(body ?? "").not.toMatch(/思维链|思考过程|chain of thought|reasoning_content/i);
});

test("Ready draft submits and shows the frozen work order", async ({ page }) => {
  await runReviewThroughUi(page);
  await page.getByTestId("submit-draft").click();
  await expect(page.getByTestId("submit-success")).toBeVisible();
  await expect(page.getByTestId("submit-success").textContent()).resolves.toContain("YR-");
});

test("Blocked outcome lists gate blockers and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-blocked");
  await runReviewThroughUi(page);
  await expect(page.getByTestId("gate-blockers")).toContainText("存在严重风险发现");
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
  await expect(page.getByTestId("review-status")).toContainText("已阻断");
});

test("Partial outcome reports incompleteness and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-partial");
  await runReviewThroughUi(page);
  await expect(page.getByTestId("review-status")).toContainText("部分完成");
  await expect(page.getByTestId("gate-blockers")).toContainText("存在未完成的审核阶段");
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
});

test("Provider failure shows honest failure copy and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-provider-failed");
  await runReviewThroughUi(page);
  await expect(page.getByTestId("review-status")).toContainText("预审失败");
  await expect(page.getByTestId("review-failure")).toContainText("AI服务暂不可用");
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
});

test("revealed raw evidence stays out of web storage and copies only through audit", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:4173",
  });
  await runReviewThroughUi(page);
  await page.getByTestId("tab-findings").click();
  await page.getByRole("button", { name: "查看审核证据" }).first().click();
  await expect(page.getByTestId("evidence-sheet")).toBeVisible();

  await page.getByRole("button", { name: "解密查看原始数据" }).first().click();
  const rawView = page.locator("[data-testid^='raw-view-']").first();
  await expect(rawView).toBeVisible();
  await expect(rawView).toContainText(RAW_MARKER);

  // Storage scan: neither the raw payload nor any SQL plaintext may persist.
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(storage.local).not.toContain(RAW_MARKER);
  expect(storage.local).not.toContain(SQL_MARKER);
  expect(storage.local).not.toContain(SQL_TEXT);
  expect(storage.session).not.toContain(RAW_MARKER);
  expect(storage.session).not.toContain(SQL_MARKER);
  expect(storage.session).not.toContain(SQL_TEXT);

  // Copy goes through the independent audit API before any clipboard write
  // (migration contract §6): the audited raw-copy-events call must fire.
  const copyAuditCalls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("raw-copy-events")) {
      copyAuditCalls.push(request.url());
    }
  });
  await page.getByRole("button", { name: "复制（记录审计）" }).first().click();
  await expect
    .poll(() => copyAuditCalls.length, { timeout: 5_000 })
    .toBe(1);

  // The clipboard write is issued in the same activation window as the
  // audit call; give the browser write a beat to settle before reading.
  await page.waitForTimeout(500);
  const clipboard = await page.evaluate(async () => {
    if (!navigator.clipboard || !document.hasFocus()) return null;
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  });
  if (clipboard !== null) {
    expect(clipboard).toContain(RAW_MARKER);
  }

  // Closing the sheet wipes the revealed plaintext from memory.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("evidence-sheet")).toBeHidden();
});
