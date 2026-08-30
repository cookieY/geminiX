import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F6 acceptance gates (work package FE-F6-ORDER-SUBMIT), driven by the
// stateful order fixture over the production build with the shared MSW
// worker:
//   1. 未Ready正常UI不能提交 — the dock stays disabled without a passing
//      gate, and submission only fires after the explicit confirmation;
//   2. 后端拒绝无假成功 — a racing withdrawal keeps the dialog open with the
//      backend's state-machine rejection (1010) and no optimistic state flip;
//   3. 列表事件无重复 — the personal list updates rows in place across
//      at-least-once event delivery;
//   4. 部分执行后撤回明确提示不可回滚 — a running order warns before the
//      withdrawn_after_partial_execution transition.

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
const SQL_TEXT = "UPDATE orders SET status = 1 WHERE user_id = 42;";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
    window.localStorage.setItem("yearning-mock-scenario", "review-ready");
  });
  await mockSession(page, "admin");
});

async function createDraft(page: Page, title: string): Promise<string> {
  await page.goto("/changes/new");
  await expect(page.getByTestId("changes-new-page")).toBeVisible();
  await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
  await page.getByTestId("create-draft-dialog").getByRole("textbox").first().fill(title);
  await page.getByTestId("create-draft-confirm").click();
  await expect(page).toHaveURL(/\/changes\/drafts\//);
  await expect(page.getByTestId("draft-workspace-page")).toBeVisible();
  return page.url().split("/").at(-1) ?? "";
}

/** Types SQL, saves, runs the review explicitly and waits for Ready. */
async function reviewToReady(page: Page): Promise<void> {
  await page.getByTestId("sql-editor").click();
  await page.keyboard.type(SQL_TEXT);
  await page.getByTestId("save-sql").click();
  await expect(page.getByTestId("save-sql")).toBeDisabled();
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review-status")).toContainText("审核结果完整", {
    timeout: 8_000,
  });
}

test("a draft without a passing gate cannot be submitted from the UI", async ({ page }) => {
  await createDraft(page, "未预审草稿");
  // No SQL, no review, no gate: the dock blocks the action entirely.
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
  // Even with saved SQL, only a Ready gate unlocks submission.
  await page.getByTestId("sql-editor").click();
  await page.keyboard.type(SQL_TEXT);
  await page.getByTestId("save-sql").click();
  await expect(page.getByTestId("save-sql")).toBeDisabled();
  await expect(page.getByTestId("submit-draft")).toBeDisabled();
});

test("a racing backend rejection keeps the dialog open without faking success", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await createDraft(page, "并发撤回草稿");
  await reviewToReady(page);
  await page.getByTestId("submit-draft").click();
  await page.getByTestId("submit-confirm-accept").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 8_000 });
  const orderId = page.url().split("/").at(-1) ?? "";

  // The withdraw dialog opens; while it is open another tab withdraws the
  // order directly, so the confirm lands on an already-terminal order.
  await page.getByTestId("withdraw-order").click();
  await page.getByTestId("order-action-reason").fill("界面撤回（将被并发抢断）");
  const raced = await page.evaluate(async (id) => {
    const response = await fetch(`/change-orders/${id}/withdrawal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ reason: "并发撤回抢先成功" }),
    });
    return (await response.json()) as { err_code: number };
  }, orderId);
  expect(raced.err_code).toBe(0);

  // The state change event reaches the page; the badge already shows the
  // withdrawn terminal state before the user confirms.
  await expect(page.getByTestId("order-detail-page")).toContainText("已撤回", {
    timeout: 8_000,
  });

  // The state-change event has already re-read the fresh (withdrawn) order,
  // so confirming sends the current version and the backend rejects on the
  // state machine instead: 1010 INVALID_STATE_TRANSITION. The dialog shows
  // the rejection and never reports success — the If-Match version-conflict
  // path (1004, order_lifecycle profile) is pinned at fixture level.
  await page.getByTestId("order-action-confirm").click();
  await expect(page.getByTestId("order-action-error")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("order-action-dialog")).toBeVisible();
  await expect(page.getByTestId("order-detail-page")).toContainText("已撤回");
});

test("the personal order list updates in place without duplicate rows", async ({ page }) => {
  test.setTimeout(30_000);
  await createDraft(page, "列表去重草稿");
  await reviewToReady(page);
  await page.getByTestId("submit-draft").click();
  await page.getByTestId("submit-confirm-accept").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 8_000 });

  // SPA navigation only: a full page.goto reload would reset the in-memory
  // mock world (documented F4 limitation §11.4).
  await page.getByRole("link", { name: "我的工单" }).click();
  await expect(page.getByTestId("mine-orders-table")).toBeVisible();
  await expect(page.getByTestId("mine-order-row")).toHaveCount(1);

  const orderId = await page.evaluate(async () => {
    const response = await fetch("/change-orders");
    const body = (await response.json()) as {
      data: { items: Array<{ id: string }> };
    };
    return body.data.items[0]?.id ?? "";
  });

  // The server applies the withdrawal; the notification triggers a re-read
  // that updates the row in place (state badge, still exactly one row).
  const withdrawn = await page.evaluate(async (id) => {
    const response = await fetch(`/change-orders/${id}/withdrawal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ reason: "E2E 撤回" }),
    });
    return (await response.json()) as { err_code: number };
  }, orderId);
  expect(withdrawn.err_code).toBe(0);

  await expect(page.getByTestId("mine-order-row")).toHaveCount(1, { timeout: 8_000 });
  await expect(page.getByTestId("mine-orders-table")).toContainText("已撤回", {
    timeout: 8_000,
  });
});

test("partial execution warns that applied changes cannot roll back", async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-mock-scenario", "order-partial-execution");
  });
  await page.goto("/changes/mine");
  // Fresh world: the scenario seeds its running order on first list fetch.
  await expect(page.getByTestId("mine-orders-table")).toBeVisible();
  await expect(page.getByTestId("mine-order-row").first()).toContainText("执行中", {
    timeout: 8_000,
  });

  await page.getByTestId("mine-order-row").first().click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  // Stage 1 succeeded, stage 2 is running: the audit timeline shows the
  // partial progress and the withdraw dialog must warn before confirming.
  await expect(page.getByTestId("order-timeline-list")).toContainText("执行成功");
  await page.getByTestId("withdraw-order").click();
  await expect(page.getByTestId("partial-execution-warning")).toBeVisible();
  await expect(page.getByTestId("partial-execution-warning")).toContainText("不会自动回滚");

  await page.getByTestId("order-action-reason").fill("线上止血，终止后续阶段");
  await page.getByTestId("order-action-confirm").click();
  await expect(page.getByTestId("order-detail-page")).toContainText(
    "部分执行后撤回",
    { timeout: 8_000 },
  );
});
