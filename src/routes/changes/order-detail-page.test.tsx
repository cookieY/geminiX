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
    title: "详情页夹具工单",
    state: "submitted",
    current_stage_position: 1,
    stages: [
      {
        id: "9c6f1a2b-0000-4000-8000-00000000ef11",
        position: 1,
        datasource_name: "orders-mysql",
        state: "approval_active",
        approval_steps: [{ position: 1, actors: [{ user_id: FIXTURE_OWNER_ID }], state: "pending" }],
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
