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

/** Opens the composer, submits SQL and runs the review through the real UI. */
async function runReviewThroughUi(page: Page): Promise<void> {
  await page.goto("/changes/new");
  await expect(page.getByTestId("changes-new-page")).toBeVisible();
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page.getByTestId("draft-title-input").fill("E2E预审草稿");

  // 打开编辑不自动Review: no run may exist until the explicit action.
  await typeSql(page, SQL_TEXT);

  await page.getByTestId("run-review").click();
  // Fixture timeline: queued(0.4s) → running → terminal(1.3s).
  await expect(page.getByTestId("review-status")).toContainText(/审核结果完整|已阻断|部分完成|预审失败/, {
    timeout: 8_000,
  });
  // Running the review is the acting operation that adopts the implicit
  // draft and exposes its id on the page root.
  await expect(page.getByTestId("changes-new-page")).toHaveAttribute(
    "data-draft-id",
    /.+/,
  );
}


/** One-page layout (owner ruling 2026-10-24): the summary card and its
 * submission dock are mounted from the start — nothing to walk to. */
async function gotoConfirmStep(page: Page): Promise<void> {
  await expect(page.getByTestId("wizard-summary")).toBeVisible();
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
  await page.getByTestId("draft-title-input").fill("E2E预审草稿");

  // Editing and waiting produce zero review-run creations.
  await typeSql(page, SQL_TEXT);
  await page.waitForTimeout(2_000);
  expect(reviewRunCalls).toEqual([]);

  // The explicit action creates exactly one run and reaches Ready.
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText("审核结果完整", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("changes-new-page")).toHaveAttribute(
    "data-draft-id",
    /.+/,
  );
  await expect(page.getByTestId("review-summary")).toContainText(
    "AI 审核已完成，结论已与当前阶段快照冻结。",
  );
  expect(reviewRunCalls).toHaveLength(1);
  await gotoConfirmStep(page);
  await expect(page.getByTestId("submit-draft")).toBeEnabled();

  // One-page layout: findings and evidence stay structured on the same
  // page; no reasoning channel exists.
  await expect(page.getByTestId("tab-findings")).toBeVisible();
  await page.getByTestId("tab-findings").click();
  await expect(page.getByTestId("finding-item").first()).toBeVisible();
  const body = await page.locator("body").textContent();
  expect(body ?? "").not.toMatch(/思维链|思考过程|chain of thought|reasoning_content/i);
});

test("Ready draft submits through the confirmation and lands on the order detail", async ({
  page,
}) => {
  await runReviewThroughUi(page);
  await gotoConfirmStep(page);
  // F6: the dock click opens the explicit confirmation; the submission only
  // fires on accept and lands on the immutable order detail.
  await page.getByTestId("submit-draft").click();
  await expect(page.getByTestId("submit-confirm-dialog")).toBeVisible();
  await expect(page.getByTestId("submit-confirm-gate")).toContainText("全部阶段审核通过");
  await page.getByTestId("submit-confirm-accept").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 8_000 });
  // The order number follows the contract display_number pattern
  // YR-YYYYMMDD-NNNNNN (OpenAPI ChangeOrder.display_number; the mock was
  // normalized to it in FE-F12 batch 2 — the real backend emits the same).
  await expect(page.getByTestId("order-detail-page")).toContainText(
    /YR-\d{8}-\d{6}/,
  );
  await expect(page.getByTestId("order-timeline")).toBeVisible();
});

test("Blocked outcome lists gate blockers and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-blocked");
  await runReviewThroughUi(page);
  await page.getByTestId("tab-findings").click();
  await expect(page.getByTestId("finding-item").first()).toBeVisible();
  await expect(page.getByTestId("findings-incomplete")).toHaveCount(0);
  await expect(page.getByTestId("findings-empty-all")).toHaveCount(0);
  await gotoConfirmStep(page);
  await expect(page.getByTestId("gate-blockers")).toContainText("存在严重风险发现");
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
  await expect(page.getByTestId("review-status")).toContainText("已阻断");
});

for (const locale of ["zh-CN", "en-US"] as const) {
  test(`review progress is neutral and freezes the selected ${locale} request language`, async ({ page }) => {
    await setReviewScenario(page, "review-blocked");
    await page.goto("/changes/new");
    await page.getByTestId("locale-toggle").click();
    await page.getByTestId(`locale-option-${locale}`).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
    await page.getByTestId("draft-title-input").fill("Review feedback regression");
    await typeSql(page, SQL_TEXT);

    const request = page.waitForRequest((entry) =>
      entry.method() === "POST" && entry.url().endsWith("/review-runs"),
    );
    await page.getByTestId("run-review").click();
    expect((await request).headers()["accept-language"]).toBe(locale);
    const progress = page.getByTestId("review-in-progress");
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("role", "status");
    await expect(progress).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("gate-blockers")).toHaveCount(0);
    await expect(page.getByTestId("submit-draft")).toBeDisabled();

    // Switching to findings during queued/running must say that the review is
    // still in progress, never "no findings".
    await page.getByTestId("tab-findings").click();
    await expect(page.getByTestId("findings-waiting")).toBeVisible();
    await expect(page.getByTestId("findings-waiting")).toHaveAttribute("role", "status");
    await expect(page.getByTestId("findings-empty")).toHaveCount(0);
    await expect(page.getByTestId("findings-empty-all")).toHaveCount(0);
    if (locale === "zh-CN") {
      await page.getByTestId("findings-waiting").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "../artifacts/development/FE-F4-REVIEW-FEEDBACK/tests/review-findings-waiting-zh-CN.png",
        fullPage: true,
      });
    }

    await page.getByTestId("tab-overview").click();
    await expect(page.getByTestId("review-status")).toContainText(
      locale === "zh-CN" ? "预审中" : "Reviewing",
      { timeout: 4_000 },
    );
    await page.getByTestId("tab-findings").click();
    await expect(page.getByTestId("findings-waiting")).toBeVisible();

    await expect(page.getByTestId("gate-blockers")).toBeVisible({ timeout: 8_000 });
    await expect(progress).toHaveCount(0);
    await expect(page.getByTestId("findings-waiting")).toHaveCount(0);
    await expect(page.getByTestId("findings-empty-all")).toHaveCount(0);
    await expect(page.getByTestId("submit-draft")).toBeDisabled();

    await page.getByTestId("tab-overview").click();
    const frozenSummary = page.getByTestId("review-summary").locator("dd").first();
    await expect(frozenSummary).toHaveAttribute("lang", locale);
    await expect(frozenSummary).toHaveText(
      locale === "zh-CN"
        ? "AI 审核已完成，结论已与当前阶段快照冻结。"
        : "The AI review is complete. This result is frozen to the current stage snapshot.",
    );

    const frozenSummaryText = await frozenSummary.textContent();
    const otherLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    await page.getByTestId("locale-toggle").click();
    await page.getByTestId(`locale-option-${otherLocale}`).click();
    await expect(page.locator("html")).toHaveAttribute("lang", otherLocale);
    await expect(page.getByTestId("review-summary").locator("dd").first()).toHaveText(
      frozenSummaryText ?? "",
    );
    await expect(page.getByTestId("review-summary").locator("dd").first()).toHaveAttribute(
      "lang",
      locale,
    );
  });
}

test("Partial outcome reports incompleteness and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-partial");
  await runReviewThroughUi(page);
  await expect(page.getByTestId("review-status")).toContainText("部分完成");
  await page.getByTestId("tab-findings").click();
  await expect(page.getByTestId("findings-incomplete")).toBeVisible();
  await expect(page.getByTestId("finding-item").first()).toBeVisible();
  await expect(page.getByTestId("findings-empty-all")).toHaveCount(0);
  await gotoConfirmStep(page);
  await expect(page.getByTestId("gate-blockers")).toContainText("存在未完成的审核阶段");
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
});

test("Provider failure shows honest failure copy and keeps submit disabled", async ({ page }) => {
  await setReviewScenario(page, "review-provider-failed");
  await runReviewThroughUi(page);
  await expect(page.getByTestId("review-status")).toContainText("预审失败");
  await expect(page.getByTestId("review-failure")).toContainText("AI服务暂不可用");
  await page.getByTestId("tab-findings").click();
  await expect(page.getByTestId("findings-incomplete")).toBeVisible();
  await expect(page.getByTestId("findings-empty-all")).toHaveCount(0);
  await gotoConfirmStep(page);
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
});

test("revealed raw evidence stays out of web storage and copies only through audit", async ({
  page,
}) => {
  await runReviewThroughUi(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
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
