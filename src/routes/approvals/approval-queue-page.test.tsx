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
  it("lists orders awaiting the session user's decision with stage context", async () => {
    seedFixtureOrder(queueOrder());
    // A decided step of the same aggregate shape must NOT re-enter the
    // queue: this order sits in execution-pending.
    seedFixtureOrder(
      queueOrder({
        id: "bq6f1a2b-0000-4000-8000-00000000f802",
        display_number: "YR-20260830-000082",
        state: "stage_execution_pending",
      }),
    );
    renderQueue();
    const table = await screen.findByTestId("approval-queue-table");
    expect(table.textContent).toContain("YR-20260830-000081");
    expect(table.textContent).not.toContain("YR-20260830-000082");
    expect(table.textContent).toContain("prod-mysql");
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

  it("renders the honest empty state when no decision is pending", async () => {
    seedFixtureOrder(
      queueOrder({
        state: "stage_execution_pending",
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
});
