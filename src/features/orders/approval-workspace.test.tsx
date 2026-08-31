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
  FIXTURE_FLOW_ID,
  FIXTURE_OWNER_ID,
  resetReviewFixture,
  seedFixtureOrder,
  type FixtureOrder,
} from "@/shared/mock/review-fixture";
import OrderDetailPage from "@/routes/changes/order-detail-page";

/**
 * Approval decision gates (work package FE-F7): the decision card renders
 * for the frozen reviewer of the active step, any rejection immediately
 * rejects the whole order, the final approve only enters execution-pending,
 * and a concurrent conflict surfaces inside the dialog while the page
 * refetches — no fake success (W003; gate: 并发冲突可恢复).
 */

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

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

function approvalOrder(overrides: Partial<FixtureOrder> = {}): FixtureOrder {
  return {
    id: "ad6f1a2b-0000-4000-8000-00000000f701",
    display_number: "YR-20260830-000071",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "审批夹具工单",
    state: "stage_approval_active",
    current_stage_position: 1,
    stages: [
      {
        id: "ad6f1a2b-0000-4000-8000-00000000f711",
        position: 1,
        datasource_name: "orders-mysql",
        state: "approval_active",
        approval_steps: [
          {
            id: "ad6f1a2b-0000-4000-8000-00000000f721",
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
    sql_hash: "hash-71",
    snapshot_hash: "snap-71",
    manually_verified: false,
    version: 1,
    submitted_at: "2026-08-30T11:00:00Z",
    terminal_at: null,
    review_run_id: null,
    sql_text: "UPDATE orders SET status = 1 WHERE user_id = 42;",
    ...overrides,
  };
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

interface SubmittedFixture {
  id: string;
  review_run_id: string;
}

/** Drives the real fixture path to a submitted order: create → SQL → run →
 * ready → submit. The run plants findings; the order freezes the run link
 * so the approval page has a genuine frozen snapshot to project. */
async function submitReadyDraft(): Promise<string> {
  const created = (await (
    await fetch("/change-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "审批夹具提交流" }),
    })
  ).json()) as { data: { id: string } };
  const draftId = created.data.id;
  await fetch(`/change-drafts/${draftId}/sql`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "UPDATE orders SET status = 1 WHERE user_id = 42;" }),
  });
  await fetch(`/change-drafts/${draftId}/review-runs`, { method: "POST" });
  await waitFor(
    async () => {
      const response = (await (await fetch(`/change-drafts/${draftId}`)).json()) as {
        data: { state: string };
      };
      if (response.data.state !== "ready") throw new Error("run not finished yet");
      return response.data;
    },
    { timeout: 4_000 },
  );
  const submitted = (await (
    await fetch(`/change-drafts/${draftId}/submission`, { method: "POST" })
  ).json()) as { data: SubmittedFixture };
  return submitted.data.id;
}

describe("approval decision on the order detail page", () => {
  it("renders the decision card for the frozen reviewer and rejects the whole order immediately", async () => {
    const user = userEvent.setup();
    seedFixtureOrder(approvalOrder());
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    const card = await screen.findByTestId("approval-decision-card");
    expect(card).toBeVisible();

    await user.click(screen.getByTestId("approval-reject"));
    const dialog = screen.getByTestId("approval-decision-dialog");
    // The propagation rule is restated before confirming (W003).
    expect(dialog.textContent).toContain("立即拒绝整单");
    await user.type(screen.getByTestId("approval-decision-comment"), "语句风险不可接受");
    await user.click(screen.getByTestId("approval-decision-confirm"));
    await waitFor(() => {
      expect(screen.queryByTestId("approval-decision-card")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain("已拒绝");
    });
  });

  it("the final approve leaves the order at execution-pending and removes the decision card", async () => {
    const user = userEvent.setup();
    seedFixtureOrder(approvalOrder());
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    await user.click(await screen.findByTestId("approval-approve"));
    await user.click(screen.getByTestId("approval-decision-confirm"));
    await waitFor(() => {
      expect(screen.queryByTestId("approval-decision-card")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain("待执行");
    });
  });

  it("recovers from a concurrent conflict: error inside the dialog, then the refetched real state", async () => {
    const user = userEvent.setup();
    const orderId = "ad6f1a2b-0000-4000-8000-00000000f701";
    seedFixtureOrder(approvalOrder());
    // Observe the recovery path directly: count detail-GET fetches via a
    // manual wrapper in front of the MSW-patched fetch, while the decision
    // itself always answers 1004.
    let detailGets = 0;
    const originalFetch = window.fetch.bind(window);
    const countingFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.includes(`/change-orders/${orderId}`) && method === "GET") detailGets += 1;
      return originalFetch(input, init);
    }) as typeof window.fetch;
    window.fetch = countingFetch;
    try {
      server.use(
        http.post("*/change-orders/:orderId/approval-decisions", () =>
          HttpResponse.json({
            err_code: 1004,
            message: "order changed elsewhere",
            data: null,
            request_id: REQUEST_ID,
            retryable: false,
          }),
        ),
      );
      renderDetail(orderId);
      await screen.findByTestId("approval-decision-card");
      const readsBeforeConfirm = detailGets;
      await user.click(screen.getByTestId("approval-approve"));
      await user.click(screen.getByTestId("approval-decision-confirm"));
      const error = await screen.findByTestId("approval-decision-error");
      expect(error.textContent).toContain("资源正在被其他人修改");
      expect(error.textContent).toContain(REQUEST_ID);
      // Recovery: the dialog stays open, no success state is faked, and the
      // card's onRecover has re-read the aggregate (kept in approval state).
      expect(screen.getByTestId("approval-decision-dialog")).toBeVisible();
      expect(screen.getByTestId("order-detail-page").textContent).not.toContain("已拒绝");
      await waitFor(() => {
        expect(detailGets).toBeGreaterThan(readsBeforeConfirm);
      });
    } finally {
      window.fetch = originalFetch;
    }
  });

  it("offers no transfer, add-signer or remove-signer affordance anywhere (W004)", async () => {
    seedFixtureOrder(approvalOrder());
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    await screen.findByTestId("approval-decision-card");
    const page = screen.getByTestId("order-detail-page");
    for (const forbidden of ["转交", "加签", "减签", "改派"]) {
      expect(page.textContent).not.toContain(forbidden);
    }
    expect(screen.queryByTestId(/transfer|delegate|reassign/i)).toBeNull();
  });

  it("shows the invalid notice for a W008-invalidated order", async () => {
    seedFixtureOrder(approvalOrder({ state: "invalid" }));
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    const alert = await screen.findByTestId("invalid-order-alert");
    expect(alert.textContent).toContain("冻结审核人已被移除");
    // The decision card cannot render for an invalid order.
    expect(screen.queryByTestId("approval-decision-card")).toBeNull();
  });
});

describe("frozen review and comments on the order detail page", () => {
  it("serves the frozen submission findings with evidence through the full submission flow", async () => {
    const user = userEvent.setup();
    // Drive the real fixture flow: review-ready plants a medium finding on
    // the run, submission freezes it onto the order, and the approval page
    // projects it as a pure read (no review-run request is ever issued —
    // asserted in E2E).
    const orderId = await submitReadyDraft();
    renderDetail(orderId);
    await screen.findByTestId("frozen-review-card");
    const items = await screen.findAllByTestId("finding-item");
    expect(items.length).toBeGreaterThan(0);
    // Evidence opens through the same controlled sheet as the submission
    // workspace.
    const evidenceButtons = screen.getAllByRole("button", { name: "查看审核证据" });
    const firstEvidenceButton = evidenceButtons[0];
    if (firstEvidenceButton === undefined) throw new Error("no evidence button found");
    await user.click(firstEvidenceButton);
    await waitFor(() => {
      expect(screen.getAllByTestId("evidence-item").length).toBeGreaterThan(0);
    });
  });

  it("reads an empty frozen snapshot as the honest empty state", async () => {
    seedFixtureOrder(
      approvalOrder({
        review_run_id: "cd6f1a2b-0000-4000-8000-00000000re01",
      }),
    );
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    await screen.findByTestId("frozen-review-card");
    await waitFor(() => {
      expect(screen.getByTestId("frozen-review-card").textContent).toContain(
        "不会重新运行AI审核",
      );
    });
    // A review_run_id that resolves to no planted findings reads as the
    // honest empty state from the shared finding list.
    await waitFor(() => {
      expect(screen.getByTestId("findings-empty")).toBeVisible();
    });
  });

  it("reveals the frozen SQL plaintext with watermark and audits copies, keeping it out of storage", async () => {
    const user = userEvent.setup();
    seedFixtureOrder(approvalOrder({ sql_text: "UPDATE orders SET status = 1;" }));
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    await user.click(await screen.findByTestId("reveal-order-sql"));
    const view = await screen.findByTestId("order-sql-view");
    expect(view.textContent).toContain("UPDATE orders SET status = 1;");
    expect(view.textContent).toContain("Yearning SQL Viewer: henry @");
    // Memory-only: plaintext never touches web storage.
    expect(JSON.stringify(localStorage)).not.toContain("UPDATE orders SET status = 1;");
    expect(sessionStorage.length).toBe(0);
    // Copy is audited before the clipboard write (audit endpoint observed).
    let copyAudited = false;
    server.use(
      http.post("*/change-orders/:orderId/sql-copy-events", () => {
        copyAudited = true;
        return HttpResponse.json({ err_code: 0, message: "ok", data: { recorded: true }, request_id: REQUEST_ID });
      }),
    );
    await user.click(screen.getByTestId("copy-order-sql"));
    await waitFor(() => {
      expect(copyAudited).toBe(true);
    });
    // Closing the viewer wipes the plaintext from memory.
    await user.click(screen.getByTestId("close-order-sql"));
    expect(screen.queryByTestId("order-sql-view")).toBeNull();
  });

  it("posts a comment and lists it, keeping backend errors inline", async () => {
    const user = userEvent.setup();
    seedFixtureOrder(approvalOrder());
    renderDetail("ad6f1a2b-0000-4000-8000-00000000f701");
    await screen.findByTestId("order-comments");
    await user.type(screen.getByTestId("order-comment-input"), "请补充回滚说明");
    await user.click(screen.getByTestId("order-comment-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("order-comment-item").textContent).toContain("请补充回滚说明");
    });

    server.use(
      http.post("*/change-orders/:orderId/comments", () =>
        HttpResponse.json({
          err_code: 1010,
          message: "comment is not legal from this state",
          data: null,
          request_id: REQUEST_ID,
          retryable: false,
        }),
      ),
    );
    await user.type(screen.getByTestId("order-comment-input"), "第二条");
    await user.click(screen.getByTestId("order-comment-submit"));
    const error = await screen.findByTestId("order-comment-error");
    expect(error.textContent).toContain("当前状态不允许该操作。");
    expect(error.textContent).toContain(REQUEST_ID);
  });
});
