import { expect, test, type Page } from "@playwright/test";
import { mockSession } from "./helpers/auth";

// FE-F7 acceptance gates (审批Workspace), driven by the stateful order
// fixture over the production build with the shared MSW worker:
//   1. 打开操作审批页不创建Review Run — the queue and the decision surface
//      only ever read the frozen submission review (R003);
//   2. 任一拒绝立即整单拒绝 — a reviewer rejection terminates the whole
//      order and removes it from the queue (W003);
//   3. 并发冲突可恢复 — a racing approval surfaces the state-machine
//      rejection inside the dialog while the page converges on the real
//      aggregate state, never a fake success;
//   4. 无转交加签减签入口 — the frozen order offers no delegation surface
//      anywhere (W004).
//
// The mock world's single session user is also the frozen reviewer of the
// submitted order, so one browser session exercises the reviewer side; the
// backend keeps the authoritative frozen-actor checks (3001/3002).

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
const SQL_TEXT = "UPDATE orders SET status = 1 WHERE user_id = 42;";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
    window.localStorage.setItem("yearning-mock-scenario", "review-ready");
  });
  await mockSession(page, "admin");
});

/** Submits a ready draft through the UI and lands on the order detail. */
async function submitOrder(page: Page, title: string): Promise<void> {
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
}

test("opening and operating the approval workspace never creates a Review Run", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await submitOrder(page, "零重跑审批草稿");

  // From here on the user acts as a reviewer: every request must stay on
  // the frozen review reads — not one Review Run creation.
  const reviewRunPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/review-runs")) {
      reviewRunPosts.push(request.url());
    }
  });

  // SPA navigation only: a full page.goto reload would reset the in-memory
  // mock world (documented F4 limitation §11.4).
  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByTestId("approval-queue-table")).toBeVisible();
  await page.getByTestId("approval-queue-row").first().click();
  await expect(page.getByTestId("approval-decision-card")).toBeVisible();
  // The frozen review card renders from the submission snapshot.
  await expect(page.getByTestId("frozen-review-card")).toContainText(
    "不会重新运行AI审核",
  );

  await page.getByTestId("approval-approve").click();
  await page.getByTestId("approval-decision-confirm").click();
  await expect(page.getByTestId("order-detail-page")).toContainText("等待执行", {
    timeout: 8_000,
  });
  expect(reviewRunPosts).toEqual([]);
});

test("any rejection immediately rejects the whole order and empties the queue", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await submitOrder(page, "审批拒绝草稿");

  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByTestId("approval-queue-table")).toBeVisible();
  await page.getByTestId("approval-queue-row").first().click();
  await page.getByTestId("approval-reject").click();
  const dialog = page.getByTestId("approval-decision-dialog");
  await expect(dialog).toContainText("立即拒绝整单");
  await page.getByTestId("approval-decision-comment").fill("语句风险不可接受");
  await page.getByTestId("approval-decision-confirm").click();
  await expect(page.getByTestId("order-detail-page")).toContainText("已拒绝", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("order-timeline")).toContainText("审批拒绝", {
    timeout: 8_000,
  });

  // The rejected order no longer awaits any decision.
  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByTestId("approval-queue-empty")).toBeVisible({ timeout: 8_000 });
});

test("a concurrent peer decision is recoverable: the UI converges on the real state", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await submitOrder(page, "并发审批草稿");
  const orderId = page.url().split("/").at(-1) ?? "";

  await page.getByTestId("approval-approve").click();
  await expect(page.getByTestId("approval-decision-dialog")).toBeVisible();
  // While the dialog is open, a peer reviewer approves from another tab:
  // the fixture's winning decision advances the order to execution-pending.
  const raced = await page.evaluate(async (id) => {
    const response = await fetch(`/change-orders/${id}/approval-decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ decision: "approve", comment: "并发审批抢先成功" }),
    });
    return (await response.json()) as { err_code: number };
  }, orderId);
  expect(raced.err_code).toBe(0);

  // The decision event reaches the page; the UI converges on the true
  // aggregate state — the decision surface removes itself (nothing left to
  // decide) and no success state is ever faked for the interrupted dialog.
  await expect(page.getByTestId("order-detail-page")).toContainText("等待执行", {
    timeout: 8_000,
  });
  await expect(page.getByTestId("approval-decision-dialog")).toHaveCount(0);
  await expect(page.getByTestId("approval-decision-card")).toHaveCount(0);
  // The step shows its approved decision in the frozen stages card.
  await expect(page.getByTestId("stage-step-1")).toContainText("已通过", {
    timeout: 8_000,
  });
  // Back on the queue the order no longer awaits anyone's decision.
  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByTestId("approval-queue-empty")).toBeVisible({ timeout: 8_000 });
});

test("the approval surface offers no transfer, add-signer or remove-signer entry", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await submitOrder(page, "冻结工单草稿");

  await page.getByRole("link", { name: "工单审批" }).click();
  await expect(page.getByTestId("approval-queue-table")).toBeVisible();
  const queueText = await page.getByTestId("approval-queue-page").textContent();
  for (const forbidden of ["转交", "加签", "减签", "改派"]) {
    expect(queueText).not.toContain(forbidden);
  }

  await page.getByTestId("approval-queue-row").first().click();
  await expect(page.getByTestId("approval-decision-card")).toBeVisible();
  const detailText = await page.getByTestId("order-detail-page").textContent();
  for (const forbidden of ["转交", "加签", "减签", "改派"]) {
    expect(detailText).not.toContain(forbidden);
  }
});
