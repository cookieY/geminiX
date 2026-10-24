import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  type FixtureOrder,
} from "@/shared/mock/review-fixture";
import ApprovalQueuePage from "./approval-queue-page";

/**
 * Approval queue gates (FE-F7): the queue narrows the relation-scoped read
 * to orders where the session user is a frozen reviewer of the active step
 * (W003), rows navigate to the order detail, and the page renders an honest
 * empty state when nothing awaits a decision. No transfer/delegation entry
 * exists on the surface (W004).
 */

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  grantSession();
});

afterEach(() => {
  resetReviewFixture();
});

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

function queueOrder(overrides: Partial<FixtureOrder> = {}): FixtureOrder {
  return {
    id: "bq6f1a2b-0000-4000-8000-00000000f801",
    display_number: "YR-20260830-000081",
    submitter_user_id: FIXTURE_OWNER_ID,
    requested_scheduled_for: null,
    title: "审批队列夹具工单",
    state: "stage_approval_active",
    current_stage_position: 1,
    stages: [
      {
        id: "bq6f1a2b-0000-4000-8000-00000000f811",
        position: 1,
        datasource_name: "prod-mysql",
        state: "approval_active",
        approval_steps: [
          {
            id: "bq6f1a2b-0000-4000-8000-00000000f821",
            position: 1,
            state: "active",
            decided_at: null,
            actors: [{ id: FIXTURE_OWNER_ID, username: "henry", display_name: "henry" }],
          },
        ],
        execution_actors: [],
      },
    ],
    has_sql: true,
    sql_hash: "hash-81",
    snapshot_hash: "snap-81",
    manually_verified: false,
    version: 1,
    submitted_at: "2026-08-30T12:00:00Z",
    terminal_at: null,
    review_run_id: null,
    sql_text: "",
    ...overrides,
  };
}

function renderQueue() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={["/approvals/changes"]}>
          <Routes>
            <Route path="/approvals/changes" element={<ApprovalQueuePage />} />
            <Route
              path="/changes/orders/:orderId"
              element={<p data-testid="order-detail-target" />}
            />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

describe("ApprovalQueuePage", () => {
  it("lists both pending and already-decided orders involving the user (§18.58)", async () => {
    seedFixtureOrder(queueOrder());
    // §18.58 owner ruling: an order whose approval step (involving the
    // session user) is already decided STAYS in the queue with its outcome —
    // this order sits in execution-pending with my step approved.
    seedFixtureOrder(
      queueOrder({
        id: "bq6f1a2b-0000-4000-8000-00000000f802",
        display_number: "YR-20260830-000082",
        state: "stage_execution_pending",
        stages: [
          {
            id: "bq6f1a2b-0000-4000-8000-00000000f812",
            position: 1,
            datasource_name: "prod-mysql",
            state: "execution_pending",
            approval_steps: [
              {
                id: "bq6f1a2b-0000-4000-8000-00000000f822",
                position: 1,
                state: "approved",
                decided_at: "2026-08-30T13:00:00Z",
                actors: [{ id: FIXTURE_OWNER_ID, username: "henry", display_name: "henry" }],
              },
            ],
            execution_actors: [],
          },
        ],
      }),
    );
    renderQueue();
    const table = await screen.findByTestId("approval-queue-table");
    expect(table.textContent).toContain("YR-20260830-000081");
    // 已审工单保留 + 新列（工单状态/提交人/是否已审批）呈现。
    expect(table.textContent).toContain("YR-20260830-000082");
    expect(table.textContent).toContain("henry");
    expect(table.textContent).toContain("是否已审批");
    // §18.60：我的步骤已带上自己的决定（approved）→ 是；
    // 仍在等待决定的 active 单 → 否。
    expect(screen.getByTestId("approval-reviewed-bq6f1a2b-0000-4000-8000-00000000f802")).toHaveTextContent("是");
    expect(screen.getByTestId("approval-reviewed-bq6f1a2b-0000-4000-8000-00000000f801")).toHaveTextContent("否");
    expect(table.textContent).toContain("等待执行");
  });

  it("searches the queue by number, title and datasource (§18.39)", async () => {
    seedFixtureOrder(queueOrder());
    renderQueue();
    await screen.findByTestId("approval-queue-table");
    fireEvent.change(screen.getByTestId("approval-queue-search"), {
      target: { value: "审批队列夹具" },
    });
    expect(screen.getByTestId("approval-queue-table").textContent).toContain("YR-20260830-000081");
    fireEvent.change(screen.getByTestId("approval-queue-search"), {
      target: { value: "prod-mysql" },
    });
    expect(screen.getByTestId("approval-queue-table").textContent).toContain("YR-20260830-000081");
    fireEvent.change(screen.getByTestId("approval-queue-search"), {
      target: { value: "YR-2099" },
    });
    expect(await screen.findByTestId("approval-queue-search-empty")).toBeVisible();
    fireEvent.change(screen.getByTestId("approval-queue-search"), { target: { value: "" } });
    expect(screen.getByTestId("approval-queue-table").textContent).toContain("YR-20260830-000081");
  });

  it("navigates a queue row to the order detail", async () => {
    const user = userEvent.setup();
    seedFixtureOrder(queueOrder());
    renderQueue();
    await user.click(await screen.findByTestId("open-approval-YR-20260830-000081"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-target")).toBeVisible();
    });
  });

  it("renders the honest empty state when the user is no frozen approver anywhere", async () => {
    // §18.58：队列语义=涉及我的工单；该单的审批人不是当前用户 → 空态。
    seedFixtureOrder(
      queueOrder({
        stages: [
          {
            id: "bq6f1a2b-0000-4000-8000-00000000f811",
            position: 1,
            datasource_name: "prod-mysql",
            state: "approval_active",
            approval_steps: [
              {
                id: "bq6f1a2b-0000-4000-8000-00000000f821",
                position: 1,
                state: "active",
                decided_at: null,
                actors: [{ id: "1111d9cc-e65d-7b9d-a8aa-3c81945f9999", username: "other", display_name: "other" }],
              },
            ],
            execution_actors: [],
          },
        ],
      }),
    );
    renderQueue();
    expect(await screen.findByTestId("approval-queue-empty")).toBeVisible();
  });

  it("keeps the surface free of transfer, add-signer or remove-signer entries (W004)", async () => {
    seedFixtureOrder(queueOrder());
    renderQueue();
    await screen.findByTestId("approval-queue-table");
    const page = screen.getByTestId("approval-queue-page");
    for (const forbidden of ["转交", "加签", "减签", "改派"]) {
      expect(page.textContent).not.toContain(forbidden);
    }
  });

  it("pages the queue client-side with the pill footer (owner ruling 2026-10-24)", async () => {
    const user = userEvent.setup();
    // 25 related orders: page 1 shows the first 20, the walk ends on a 5-row
    // second page — the queue arrives as one live package, so the footer
    // slices client-side exactly like the query result grid.
    for (let i = 0; i < 25; i += 1) {
      seedFixtureOrder(
        queueOrder({
          id: `bq6f1a2b-0000-4000-8000-1${String(i).padStart(12, "0")}`,
          display_number: `YR-20260830-0030${String(i).padStart(2, "0")}`,
        }),
      );
    }
    renderQueue();
    await screen.findByTestId("approval-queue-table");
    expect(screen.getAllByTestId("approval-queue-row")).toHaveLength(20);
    await user.click(screen.getByTestId("approval-queue-footer-next"));
    expect(await screen.findAllByTestId("approval-queue-row")).toHaveLength(5);
    expect(screen.getByTestId("approval-queue-footer-next")).toBeDisabled();
  });
});
