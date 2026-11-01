import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F5 acceptance gates (work package FE-F5-BULK), driven by the stateful
// precheck fixture over the production build with the shared MSW worker:
//   1. 100k模拟数据页面可交互 — a 100,000-statement draft stays scrollable
//      with a bounded DOM window;
//   2. 不渲染全量语句或复制多份SQL — Monaco never mounts for bulk drafts,
//      visible rows stay bounded, and no SQL text reaches web storage;
//   3. 单条异常不被聚合隐藏 — the no-WHERE anomaly is its own fingerprint
//      group with a high finding and a jumpable statement row;
//   4. 取消和断线恢复E2E — import cancel and mid-run reload recovery.

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
const ANOMALY_INDEX = 54321;
/** Distinct substring of the generated bulk SQL for storage scans. */
const BULK_SENTINEL = "updated_at = '2026-08-25 00:00:00' WHERE id = 7;";
/** Statement padding that widens the cancel window to ~28 chunk iterations
 * while keeping the file safely under the 32 MiB limit (~28 MB). */
const CANCEL_PADDING = "/* padding-for-cancel-window */".repeat(6);

function buildBulkSql(statementCount: number, padding = ""): string {
  const parts: string[] = [];
  for (let i = 1; i <= statementCount; i += 1) {
    parts.push(
      i === ANOMALY_INDEX
        ? "UPDATE orders SET status = 'processed';\n"
        : `UPDATE orders SET status = 'processed', updated_at = '2026-08-25 00:00:00' WHERE id = ${i};${padding}\n`,
    );
  }
  return parts.join("");
}

async function openDraftComposer(page: Page, title: string): Promise<void> {
  await page.goto("/changes/new");
  await expect(page.getByTestId("changes-new-page")).toBeVisible();
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page.getByTestId("draft-title-input").fill(title);
}

/** Imports a SQL file through the real dialog. The import is purely local
 * (RCP-20261101): the text lands in the page's create-mode state and the
 * browser-side digest drives the bulk view — no draft is created. */
async function importSqlFile(page: Page, sql: string, name: string): Promise<void> {
  await page.getByTestId("open-bulk-import").click();
  await expect(page.getByTestId("bulk-import-dialog")).toBeVisible();
  await page.getByTestId("bulk-import-input").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(sql, "utf-8"),
  });
  await expect(page.getByTestId("bulk-import-ok")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("bulk-import-confirm").click();
  // 导入只在本地落SQL：页面根保持无草稿id，草稿仅由 保存并返回 创建。
  await expect(page.getByTestId("changes-new-page")).not.toHaveAttribute(
    "data-draft-id",
    /.+/,
  );
}

function visibleRowCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[data-testid="bulk-statement-row"]').length,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
    window.localStorage.setItem("yearning-mock-scenario", "review-ready");
  });
  await mockSession(page, "admin");
});

test("100k-statement draft stays interactive in the virtualized browser", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDraftComposer(page, "十万语句批量草稿");
  await importSqlFile(page, buildBulkSql(100000), "bulk-100k.sql");

  // The draft is bulk: the Monaco editor must not exist anywhere in the DOM.
  await expect(page.getByTestId("bulk-browser")).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".monaco-editor").count()).toBe(0);
  // Pre-review the figures come from the local digest (RCP-20261101: import
  // is local-only); the group figure carries the browser-side estimate label.
  await expect(page.getByTestId("capacity-statements")).toHaveText("100000", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("capacity-groups")).toHaveText("2（浏览器端预估）");

  // Bounded virtual window, not 100k rows.
  expect(await visibleRowCount(page)).toBeLessThanOrEqual(60);

  // Scrolling stays interactive: the window advances to the bottom of the
  // list and the row count stays bounded.
  await page.getByTestId("bulk-groups-tab").click();
  await expect(page.getByTestId("bulk-group-row")).toHaveCount(2);
  await page.getByTestId("bulk-statements-tab").click();
  await page.getByTestId("bulk-scroll").evaluate((element) => {
    (element as HTMLElement).scrollTop = 9_000_000;
  });
  await expect
    .poll(async () => {
      const rows = await page.getByTestId("bulk-statement-row").evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("data-statement-index"))),
      );
      return rows.length === 0 ? 0 : Math.max(...rows);
    })
    .toBeGreaterThan(99_000);
  expect(await visibleRowCount(page)).toBeLessThanOrEqual(60);

  // No SQL text reaches web storage (敏感边界).
  const storageDump = await page.evaluate(() =>
    JSON.stringify([localStorage, sessionStorage].map((storage) => ({ ...storage }))),
  );
  expect(storageDump).not.toContain(BULK_SENTINEL);
});

test("the single anomaly is visible outside the aggregate and jumpable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDraftComposer(page, "异常可见性草稿");
  await importSqlFile(page, buildBulkSql(100000), "bulk-anomaly.sql");
  await expect(page.getByTestId("capacity-statements")).toHaveText("100000", {
    timeout: 15_000,
  });

  // The anomaly (no-WHERE UPDATE) blocks the gate with its own fingerprint
  // group finding — the ready scenario cannot swallow it.
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText("已阻断", { timeout: 60_000 });
  await page.getByTestId("tab-findings").click();
  const finding = page
    .getByTestId("finding-item")
    .filter({ hasText: "无 WHERE 条件的批量 DML" });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText("#54321");

  // Locate jumps the virtualized browser to the anomalous statement row.
  await finding.getByRole("button", { name: "在SQL中定位" }).click();
  await expect(
    page.locator('[data-testid="bulk-statement-row"][data-highlighted]'),
  ).toHaveAttribute("data-statement-index", "54321", { timeout: 10_000 });
});

test("import can be cancelled mid-read without touching the draft", async ({ page }) => {
  test.setTimeout(60_000);
  await openDraftComposer(page, "取消导入草稿");
  await page.getByTestId("open-bulk-import").click();
  await expect(page.getByTestId("bulk-import-dialog")).toBeVisible();
  // ~30 MiB of SQL → ~30 chunk iterations, each yielding to the event loop,
  // so the cancel click deterministically lands inside the reading window.
  await page
    .getByTestId("bulk-import-input")
    .setInputFiles({
      name: "bulk-cancel.sql",
      mimeType: "text/plain",
      buffer: Buffer.from(buildBulkSql(100000, CANCEL_PADDING), "utf-8"),
    });
  await page.getByTestId("bulk-import-cancel").click();
  await expect(page.getByTestId("bulk-import-cancelled")).toBeVisible();
  await page.getByRole("button", { name: "重新选择" }).click();
  await expect(page.getByTestId("bulk-import-dialog")).toBeVisible();
  await page.getByTestId("bulk-import-dialog").press("Escape");

  // The draft is untouched: still editor-mode with no SQL content.
  await expect(page.getByTestId("sql-editor")).toBeVisible();
  await expect(page.getByTestId("bulk-browser")).toHaveCount(0);
  await expect(page.getByTestId("changes-new-page")).not.toHaveAttribute(
    "data-draft-id",
    /.+/,
  );
});

test("leaving loses the ephemeral review; re-entry never re-runs and auto-reveals the bulk draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDraftComposer(page, "断线恢复草稿");
  await importSqlFile(page, buildBulkSql(100000), "bulk-recovery.sql");
  await expect(page.getByTestId("capacity-statements")).toHaveText("100000", {
    timeout: 15_000,
  });

  // Exactly one run creation call across the whole flow.
  const runCreationCalls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/review-runs")) {
      runCreationCalls.push(request.url());
    }
  });

  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText(/已阻断|运行中|队列中/, {
    timeout: 15_000,
  });

  // 保存并返回 is the single adoption path (RCP-20261101): it creates the
  // server draft envelope, PUTs the bulk SQL and leaves to 我的工单.
  await page.getByTestId("wizard-save-draft").click();
  const draftRow = page.getByTestId("mine-draft-row").filter({ hasText: "断线恢复草稿" });
  await expect(draftRow).toBeVisible({ timeout: 30_000 });

  // Re-entry: the ephemeral run lived only in the left page's client state —
  // the fresh workspace honestly presents 未预审 and never fabricates a
  // result (瞬态Run不落库; remount semantics pinned at component level).
  await draftRow.click();
  await expect(page).toHaveURL(/\/changes\/drafts\/[0-9a-f-]+$/);
  await expect(page.getByTestId("review-status")).toContainText("未预审", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("submit-draft")).toBeDisabled();

  // Owner ruling 2026-11-01: entering a draft with SQL auto-reveals the
  // audited plaintext — the bulk browser rebuilds without any manual click.
  await expect(page.getByTestId("bulk-browser")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capacity-statements")).toHaveText("100000", { timeout: 30_000 });

  // Nothing re-ran on its own: re-precheck stays an explicit user action.
  expect(runCreationCalls).toHaveLength(1);
});
