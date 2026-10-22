import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import {
  FIXTURE_OWNER_ID,
  resetReviewFixture,
  seedFixtureOrder,
} from "@/shared/mock/review-fixture";
import OrderDetailPage from "./order-detail-page";

/**
 * Order detail gates (work package FE-F6-ORDER-SUBMIT): withdraw/void mirror
 * the change_order state machine, the partial-execution consequence is
 * spelled out before confirming (W007), and a backend rejection renders as
 * an error inside the dialog — never a success state.
 */

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  resetReviewFixture();
});

function seedOrder(overrides: Record<string, unknown> = {}): string {
  const id = (overrides.id as string | undefined) ?? "9c6f1a2b-0000-4000-8000-00000000ef01";
  seedFixtureOrder({
    id,
    display_number: "YR-20260830-000021",
    submitter_user_id: FIXTURE_OWNER_ID,
    requested_scheduled_for: null,
    title: "详情页夹具工单",
    state: "submitted",
    current_stage_position: 1,
    stages: [
      {
        id: "9c6f1a2b-0000-4000-8000-00000000ef11",
        position: 1,
        datasource_name: "orders-mysql",
        state: "approval_active",
        approval_steps: [
          {
            id: "9c6f1a2b-0000-4000-8000-00000000ef21",
            position: 1,
            state: "pending",
            decided_at: null,
            actors: [{ id: FIXTURE_OWNER_ID, username: "henry", display_name: "henry" }],
          },
        ],
        execution_actors: [
          {
            id: FIXTURE_OWNER_ID,
            username: "henry",
            display_name: "henry",
            email: null,
            is_builtin_admin: true,
            version: 1,
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          },
        ],
      },
    ],
    has_sql: true,
    sql_hash: "hash-1",
    snapshot_hash: "snap-1",
    manually_verified: false,
    version: 1,
    submitted_at: "2026-08-30T10:00:00Z",
    terminal_at: null,
    review_run_id: null,
    sql_text: "SELECT 1;",
    ...overrides,
  });
  return id;
}

function renderDetail(orderId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
      <MemoryRouter initialEntries={[`/changes/orders/${orderId}`]}>
        <Routes>
          <Route path="/changes/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  grantSession();
});


/** The order pages gate lifecycle buttons on the session identity; plant an
 * authenticated /users/me whose id matches the fixture submitter (guards
 * test precedent). */
function grantSession(): void {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: FIXTURE_OWNER_ID,
          username: "henry",
          display_name: "henry",
          email: null,
          is_builtin_admin: true,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: true,
        },
        request_id: FIXTURE_OWNER_ID,
      }),
    ),
  );
}

describe("OrderDetailPage", () => {
  it("renders the frozen stages, snapshot facts and the audit timeline", async () => {
    const id = seedOrder();
    // A lifecycle fact first, so the timeline has a real entry to project.
    await fetch(`/change-orders/${id}/withdrawal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ reason: "产生一条时间线事件" }),
    });
    renderDetail(id);
    expect(await screen.findByTestId("order-stages")).toBeVisible();
    expect(screen.getByTestId("order-facts").textContent).toContain("hash-1");
    expect(await screen.findByTestId("order-timeline-list")).toBeVisible();
    // A withdrawn order is terminal: no withdraw or void affordance remains.
    expect(screen.queryByTestId("withdraw-order")).toBeNull();
    expect(screen.queryByTestId("void-order")).toBeNull();
  });

  it("projects approval decision comments on timeline entries only (BUG-004)", async () => {
    // The backend timeline projection carries approval_decisions.comment as
    // its own field (NEW-FE-01); empty or absent comments must not render a
    // comment container at all.
    const id = seedOrder();
    server.use(
      http.get("*/change-orders/:orderId/timeline", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            items: [
              {
                id: "b1a7c2d4-0000-4000-8000-00000000aa01",
                event_type: "change_order.approval_decided",
                occurred_at: "2026-09-01T09:30:00Z",
                actor_kind: "user",
                actor_user_id: "b1a7c2d4-0000-4000-8000-00000000aa09",
                actor_display_name: "reviewer",
                summary: "审批拒绝，工单终止",
                comment: "语句风险不可接受，请拆分后重新提交",
                stage_position: 1,
                state: "rejected",
              },
              {
                id: "b1a7c2d4-0000-4000-8000-00000000aa02",
                event_type: "change_order.submitted",
                occurred_at: "2026-09-01T09:00:00Z",
                actor_kind: "user",
                actor_user_id: FIXTURE_OWNER_ID,
                actor_display_name: "henry",
                summary: "工单提交并冻结流程快照",
                stage_position: 1,
                state: "submitted",
              },
              {
                id: "b1a7c2d4-0000-4000-8000-00000000aa03",
                event_type: "change_order.approval_decided",
                occurred_at: "2026-09-01T09:10:00Z",
                actor_kind: "user",
                actor_user_id: "b1a7c2d4-0000-4000-8000-00000000aa09",
                actor_display_name: "reviewer",
                summary: "审批通过",
                comment: "",
                stage_position: 1,
                state: null,
              },
            ],
            page: { next_cursor: null, has_more: false },
          },
          request_id: REQUEST_ID,
        }),
      ),
    );
    renderDetail(id);
    expect(await screen.findByTestId("order-timeline-list")).toBeVisible();
    const comments = screen.getAllByTestId("order-timeline-comment");
    // Only the rejected decision renders its comment; the commentless
    // decision and the submitted entry render no comment container.
    expect(comments).toHaveLength(1);
    expect(comments[0]?.textContent).toContain("语句风险不可接受");
    expect(screen.getByTestId("order-timeline-list").textContent).toContain("工单提交并冻结流程快照");
  });

  it("withdraws a submitted order after confirmation, without a partial warning", async () => {
    const user = userEvent.setup();
    const id = seedOrder();
    renderDetail(id);
    await user.click(await screen.findByTestId("withdraw-order"));
    const dialog = screen.getByTestId("order-action-dialog");
    expect(dialog.textContent).toContain("撤回后工单终止为「已撤回」");
    expect(screen.queryByTestId("partial-execution-warning")).toBeNull();
    // The confirm stays disabled until the mandatory reason is typed.
    expect(screen.getByTestId("order-action-confirm")).toBeDisabled();
    await user.type(screen.getByTestId("order-action-reason"), "不再需要该变更");
    await user.click(screen.getByTestId("order-action-confirm"));
    await waitFor(() => {
      expect(screen.queryByTestId("order-action-dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain("已撤回");
    });
  });

  it("warns that partial execution cannot roll back before withdrawing (部分执行后撤回)", async () => {
    const user = userEvent.setup();
    const id = seedOrder({ state: "running", version: 3 });
    renderDetail(id);
    await user.click(await screen.findByTestId("withdraw-order"));
    expect(screen.getByTestId("partial-execution-warning")).toBeVisible();
    expect(screen.getByTestId("partial-execution-warning").textContent).toContain(
      "不会自动回滚",
    );
    await user.type(screen.getByTestId("order-action-reason"), "线上止血");
    await user.click(screen.getByTestId("order-action-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain(
        "部分执行后撤回",
      );
    });
  });

  it("shows the backend rejection inside the dialog and never fakes success (后端拒绝无假成功)", async () => {
    const user = userEvent.setup();
    const id = seedOrder();
    server.use(
      http.post("*/change-orders/:orderId/withdrawal", () =>
        HttpResponse.json({
          err_code: 1010,
          message: "withdraw is not legal from state stage_approval_active",
          data: null,
          request_id: REQUEST_ID,
          retryable: false,
        }),
      ),
    );
    renderDetail(id);
    await user.click(await screen.findByTestId("withdraw-order"));
    await user.type(screen.getByTestId("order-action-reason"), "测试拒绝路径");
    await user.click(screen.getByTestId("order-action-confirm"));
    const error = await screen.findByTestId("order-action-error");
    // The rejection is the localized business-error message plus the
    // request id — the dialog never invents a success state.
    expect(error.textContent).toContain("当前状态不允许该操作。");
    expect(error.textContent).toContain(REQUEST_ID);
    // The dialog stays open and the aggregate state is untouched.
    expect(screen.getByTestId("order-action-dialog")).toBeVisible();
    expect(screen.getByTestId("order-detail-page").textContent).not.toContain("已撤回");
  });

  it("offers voidance only for voidable states and voids with a reason", async () => {
    const user = userEvent.setup();
    const id = seedOrder({ state: "result_unknown" });
    renderDetail(id);
    expect(await screen.findByTestId("void-order")).toBeVisible();
    await user.click(screen.getByTestId("void-order"));
    await user.type(screen.getByTestId("order-action-reason"), "结果未知，终止");
    await user.click(screen.getByTestId("order-action-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain("已作废");
    });
  });
});

describe("execution wait note for non-executors (§18.57)", () => {
  const OTHER_ID = "1111d9cc-e65d-7b9d-a8aa-3c81945f9999";

  function executionPendingOrder(executorId: string): string {
    return seedOrder({
      state: "stage_execution_pending",
      stages: [
        {
          id: "9c6f1a2b-0000-4000-8000-00000000ef11",
          position: 1,
          datasource_name: "orders-mysql",
          state: "execution_pending",
          approval_steps: [
            {
              id: "9c6f1a2b-0000-4000-8000-00000000ef21",
              position: 1,
              state: "approved",
              decided_at: "2026-08-30T10:30:00Z",
              actors: [{ id: "0198d9cc-e65d-7b9d-a8aa-3c81945fa001", username: "reviewer-a", display_name: "reviewer-a" }],
            },
          ],
          execution_actors: [
            {
              id: executorId,
              username: executorId === FIXTURE_OWNER_ID ? "henry" : "executor-a",
              display_name: executorId === FIXTURE_OWNER_ID ? "henry" : "executor-a",
              email: null,
              is_builtin_admin: false,
              version: 1,
              created_at: "2026-08-01T00:00:00Z",
              updated_at: "2026-08-01T00:00:00Z",
            },
          ],
        },
      ],
    });
  }

  it("explains who may execute when the viewer is not the frozen executor", async () => {
    const id = executionPendingOrder(OTHER_ID);
    renderDetail(id);
    const note = await screen.findByTestId("execution-wait-note");
    expect(note.textContent).toContain("executor-a");
    expect(note.textContent).toContain("等待执行");
  });

  it("shows no wait note for the frozen executor (the action card owns the view)", async () => {
    const id = executionPendingOrder(FIXTURE_OWNER_ID);
    renderDetail(id);
    await screen.findByTestId("execution-action-card");
    expect(screen.queryByTestId("execution-wait-note")).toBeNull();
  });
});
