import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F8 acceptance gates (执行结果与调度), driven by the stateful execution
// fixture over the production build with the shared MSW worker:
//   1. 批准与执行SQL Hash一致展示 — the executor area and the attempt card
//      both bind the executed SQL to the approved hash (preflight);
//   2. 无新回滚入口 — no rollback affordance exists anywhere (E003);
//   3. 非not_started只复制新草稿 — after a sent-boundary fate the only
//      forward path is the copied draft (E004);
//   4. 预约授权与到点语义正确 — only the frozen executor schedules, the due
//      claim is the system's, and a missed schedule never catches up (E007);
//   5. Unknown绝不显示成未执行 — unknown statement results render in their
//      own high-risk wording and resolve only through manual verification
//      (E005).
//
// The mock session user is the frozen executor of every scenario order, so
// one browser session exercises the executor side; the backend keeps the
// authoritative checks (3001/3003/3004).

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
const SEEDED_EXECUTION_ORDER = "/changes/orders/7e6f1a2b-0000-4000-8000-00000000f801";
const SQL_TEXT = "UPDATE orders SET status = 1 WHERE user_id = 42;";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
    window.localStorage.setItem("yearning-mock-scenario", "ready");
  });
  await mockSession(page, "admin");
});

/** Sets the mock scenario before any app code runs. */
async function useScenario(page: Page, scenario: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("yearning-mock-scenario", value);
  }, scenario);
}

/** Submits a ready draft through the UI, approves it as the frozen reviewer
 * and lands on the execution-pending order detail. */
async function submitAndApprove(page: Page, title: string): Promise<void> {
  await page.goto("/changes/new");
  await expect(page.getByTestId("changes-new-page")).toBeVisible();
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page.getByTestId("create-draft-dialog").getByRole("textbox").first().fill(title);
  await page.getByTestId("create-draft-confirm").click();
  await expect(page).toHaveURL(/\/changes\/drafts\//);
  await page.getByTestId("sql-editor").click();
  await page.keyboard.type(SQL_TEXT);
  await page.getByTestId("save-sql").click();
  await expect(page.getByTestId("save-sql")).toBeDisabled();
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText("审核结果完整", {
    timeout: 8_000,
  });
  await page.getByTestId("submit-draft").click();
  await page.getByTestId("submit-confirm-accept").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 8_000 });

  // Final approval as the frozen reviewer of step 1 — approval never
  // auto-executes, the executor area only appears afterwards (W006).
  await page.getByTestId("approval-approve").click();
  await page.getByTestId("approval-decision-confirm").click();
  await expect(page.getByTestId("execution-action-card")).toBeVisible({ timeout: 8_000 });
}

/** Asserts the execution surface carries no rollback affordance (E003). */
async function expectNoRollbackEntry(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /回滚/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /回滚/ })).toHaveCount(0);
  await expect(page.getByTestId("rollback-entry")).toHaveCount(0);
}

test("shows the approved hash as the executed hash, with no rollback entry", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await submitAndApprove(page, "哈希一致展示草稿");

  // The executor area binds execution to the approved SQL hash.
  await expect(page.getByTestId("execution-hash-line")).toContainText("与批准快照一致");
  const hashLine = await page.getByTestId("execution-hash-line").textContent();
  expect(hashLine).toContain("hash-");

  await expectNoRollbackEntry(page);

  // Execute: preflight confirms the identical hash on the attempt card.
  await page.getByTestId("execution-start").click();
  await expect(page.getByTestId("execution-confirm-dialog")).toBeVisible();
  await page.getByTestId("execution-confirm-run").click();
  await expect(page.getByTestId("execution-attempt-card")).toContainText(
    "执行SQL与批准SQL一致",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("execution-attempt-card")).toContainText("成功", {
    timeout: 10_000,
  });
  await expect(page).not.toHaveURL(/rollback/);
  await expectNoRollbackEntry(page);
});

test("after a partial DDL fate only copy-to-new-draft remains", async ({ page }) => {
  test.setTimeout(40_000);
  await useScenario(page, "execution-partial");
  await page.goto(SEEDED_EXECUTION_ORDER);
  await expect(page.getByTestId("execution-action-card")).toBeVisible({ timeout: 8_000 });

  await page.getByTestId("execution-start").click();
  await page.getByTestId("execution-confirm-run").click();

  // partial_failed facts: succeeded / failed / skipped rows.
  await expect(page.getByTestId("execution-statement-1")).toContainText("成功", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("execution-statement-2")).toContainText("失败");
  await expect(page.getByTestId("execution-statement-3")).toContainText("已跳过");

  // The order terminalizes; no retry, no rollback — the copied draft only.
  await expect(page.getByTestId("copy-draft-card")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("execution-start")).toHaveCount(0);
  await expectNoRollbackEntry(page);
});

test("schedules are executor-created and missed schedules never catch up", async ({
  page,
}) => {
  test.setTimeout(40_000);

  // Authorization: the seeded order's frozen executor can create a schedule;
  // the due semantics land the order in `scheduled` awaiting the system
  // claim — never an immediate execution (E007). The window check is real:
  // a due time beyond 30 days would keep the button disabled.
  await useScenario(page, "execution-partial");
  await page.goto(SEEDED_EXECUTION_ORDER);
  await expect(page.getByTestId("execution-action-card")).toBeVisible({ timeout: 8_000 });
  const due = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const dueLocal = `${String(due.getFullYear())}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
  await page.getByTestId("execution-schedule-input").fill(dueLocal);
  await page.getByTestId("execution-schedule-submit").click();
  // The success note lives on the action card, which unmounts once the order
  // refetches into `scheduled` — assert the persisted surfaces instead: the
  // scheduled badge and the audit timeline entry.
  await expect(page.getByTestId("order-timeline")).toContainText("不自动补跑", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("order-detail-page")).toContainText("已预约", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("execution-action-card")).toHaveCount(0);

  // A missed schedule is terminal: the seeded order shows the missed badge
  // and the copy-only path — no catch-up button anywhere.
  await useScenario(page, "schedule-missed");
  await page.goto(SEEDED_EXECUTION_ORDER);
  await expect(page.getByTestId("order-detail-page")).toContainText("错过", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("copy-draft-card")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("execution-start")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /补跑|重新执行|重试/ })).toHaveCount(0);
});

test("unknown statement results are never not-executed and verify manually", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await useScenario(page, "execution-unknown");
  await page.goto(SEEDED_EXECUTION_ORDER);
  await expect(page.getByTestId("execution-action-card")).toBeVisible({ timeout: 8_000 });

  await page.getByTestId("execution-start").click();
  await page.getByTestId("execution-confirm-run").click();

  // Statement #2 reads 结果未知 — a distinct high-risk state, never 未执行.
  await expect(page.getByTestId("execution-statement-2")).toContainText("结果未知", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("execution-statement-2")).not.toContainText("未执行");

  // The manual verification form: fixed verdicts, reason and evidence all
  // mandatory; the backend keeps 3012 authoritative.
  await expect(page.getByTestId("verification-form")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("verification-submit")).toBeDisabled();
  await page.getByTestId("verification-result-confirmed_succeeded").click();
  await page.getByTestId("verification-reason").fill("从库复制无延迟，行数与预期一致");
  await page.getByTestId("verification-evidence-content-0").fill("SELECT COUNT(*) 复核通过");
  await page.getByTestId("verification-submit").click();

  // The order completes and the manual-confirmation marker persists.
  await expect(page.getByTestId("order-detail-page")).toContainText("已完成", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("order-facts")).toContainText("人工核验");
});
