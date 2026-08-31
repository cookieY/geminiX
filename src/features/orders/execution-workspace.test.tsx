import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import {
  FIXTURE_OWNER_ID,
  resetReviewFixture,
  seedFixtureOrder,
  type FixtureOrder,
} from "@/shared/mock/review-fixture";
import OrderDetailPage from "@/routes/changes/order-detail-page";

/**
 * Execution workspace gates (work package FE-F8): the executor area renders
 * only for the frozen executors of the execution_pending stage and always
 * shows the frozen SQL hash as identical to the approved snapshot (W006;
 * gate: 批准与执行SQL Hash一致展示), there is no rollback entry anywhere
 * (E003), unknown statement results are never rendered as not-executed
 * (E005), and a sent-boundary fate only offers copy-to-new-draft (E004).
 */

// The terminal attempt facts reach this page through the order-subject event
// feed (the attempt query only polls while live), so the component tests run
// the real fixture transport — exactly what the browser MSW worker does.
vi.stubEnv("VITE_ENABLE_MOCK", "true");

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  grantSession();
  window.localStorage.setItem("yearning-mock-scenario", "ready");
  window.localStorage.setItem("yearning-mock-auth", "admin");
  void startReviewEvents();
});

afterEach(() => {
  stopReviewEvents();
  resetReviewFixture();
  window.localStorage.removeItem("yearning-mock-scenario");
  window.localStorage.removeItem("yearning-mock-auth");
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

function executionOrder(overrides: Partial<FixtureOrder> = {}): FixtureOrder {
  return {
    id: "ee6f1a2b-0000-4000-8000-00000000f901",
    display_number: "YR-20260830-000301",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "执行夹具工单",
    state: "stage_execution_pending",
    current_stage_position: 1,
    stages: [
      {
        id: "ee6f1a2b-0000-4000-8000-00000000f911",
        position: 1,
        datasource_name: "orders-mysql",
        state: "execution_pending",
        approval_steps: [
          {
            id: "ee6f1a2b-0000-4000-8000-00000000f921",
            position: 1,
            state: "approved",
            decided_at: "2026-08-30T10:00:00Z",
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
    sql_hash: "hash-exec-901",
    snapshot_hash: "snap-exec-901",
    manually_verified: false,
    version: 2,
    submitted_at: "2026-08-30T11:00:00Z",
    terminal_at: null,
    review_run_id: null,
    sql_text: "UPDATE orders SET status = 1 WHERE user_id = 42; UPDATE orders SET status = 2 WHERE user_id = 43;",
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

describe("execution workspace rendering", () => {
  it("shows the frozen-executor area with the hash-consistency marker and no rollback entry", async () => {
    const order = executionOrder();
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-action-card")).toBeVisible();
    });
    expect(screen.getByTestId("execution-hash-line")).toHaveTextContent("hash-exec-901");
    expect(screen.getByTestId("execution-hash-consistent")).toHaveTextContent("与批准快照一致");
    // E003: no rollback affordance (action entry) anywhere on the surface —
    // the word itself legitimately appears in the semantics note.
    expect(screen.queryByRole("button", { name: /回滚/ })).toBeNull();
  });

  it("hides the executor area when the current user is not a frozen executor", async () => {
    const base = executionOrder();
    const baseStage = base.stages[0];
    if (baseStage === undefined) throw new Error("seed stage missing");
    const order = executionOrder({
      stages: [
        {
          ...baseStage,
          execution_actors: [
            {
              id: "1111d9cc-e65d-7b9d-a8aa-3c81945f99ac",
              username: "other",
              display_name: "other",
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
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page")).toBeVisible();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("execution-action-card")).toBeNull();
    });
  });
});

describe("execution run interactions", () => {
  it("runs the happy path: execute → preflight hash confirmation → succeeded statements", async () => {
    const user = userEvent.setup();
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f902" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));

    // The attempt card appears and settles at succeeded with committed rows.
    await waitFor(
      () => {
        expect(screen.getByTestId("execution-attempt-card")).toHaveTextContent("成功");
      },
      { timeout: 5_000 },
    );
    await waitFor(() => {
      expect(screen.getByTestId("execution-statement-1")).toHaveTextContent("成功");
      expect(screen.getByTestId("execution-statement-2")).toHaveTextContent("成功");
    });
    // Preflight confirmed the executed SQL equals the approved SQL.
    expect(screen.getByTestId("execution-attempt-card")).toHaveTextContent("执行SQL与批准SQL一致");
    // The order completed — the executor area is gone.
    await waitFor(() => {
      expect(screen.queryByTestId("execution-action-card")).toBeNull();
    });
  }, 15_000);

  it("keeps unknown statements visually distinct from not-executed and verifies manually", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-unknown");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f903" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));

    // Statement #2 is unknown — its badge reads 结果未知, never 未执行.
    await waitFor(
      () => {
        expect(screen.getByTestId("execution-statement-2")).toHaveTextContent("结果未知");
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("execution-statement-2")).not.toHaveTextContent("未执行");

    // Verification form: the fixed verdict plus evidence are mandatory. The
    // form mounts once the terminal event lands and the order refetches.
    await waitFor(
      () => {
        expect(screen.getByTestId("verification-form")).toBeVisible();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("verification-submit")).toBeDisabled();
    await user.click(screen.getByTestId("verification-result-confirmed_succeeded"));
    expect(screen.getByTestId("verification-submit")).toBeDisabled();
    await user.type(screen.getByTestId("verification-reason"), "从库复制无延迟，行数一致");
    expect(screen.getByTestId("verification-submit")).toBeDisabled();
    await user.type(screen.getByTestId("verification-evidence-content-0"), "SELECT COUNT(*) 复核通过");
    expect(screen.getByTestId("verification-submit")).toBeEnabled();
    await user.click(screen.getByTestId("verification-submit"));

    // The order completes with the manual-verification marker shown in the
    // frozen facts card.
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page")).toHaveTextContent("已完成");
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-facts")).toHaveTextContent("是");
    });
  }, 20_000);

  it("offers only copy-to-new-draft after a partial DDL fate", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-partial");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f904" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));

    // partial_failed facts: succeeded / failed / skipped rows.
    await waitFor(
      () => {
        expect(screen.getByTestId("execution-statement-1")).toHaveTextContent("成功");
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("execution-statement-2")).toHaveTextContent("失败");
    expect(screen.getByTestId("execution-statement-3")).toHaveTextContent("已跳过");

    // No re-execute; the only forward path is the copied draft (E004). The
    // copy card mounts when the terminal event lands and the order refetches.
    await waitFor(() => {
      expect(screen.queryByTestId("execution-start")).toBeNull();
    });
    await waitFor(
      () => {
        expect(screen.getByTestId("copy-draft-card")).toBeVisible();
      },
      { timeout: 5_000 },
    );
  }, 15_000);
});

describe("execution cancellation and recovery paths", () => {
  it("cancels a gh-ost run and surfaces residuals with the copy-only path", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-ghost");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f905" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));

    // The gh-ost surface shows phase, progress and rows copied while copying.
    await waitFor(
      () => {
        expect(screen.getByTestId("execution-osc")).toBeVisible();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("execution-osc-progress")).toBeVisible();

    // Any frozen executor may request cancellation; the outcome is a
    // request, not a promise — the attempt first moves to cancelling.
    await waitFor(() => {
      expect(screen.getByTestId("execution-cancel")).toBeEnabled();
    }, { timeout: 5_000 });
    await user.click(screen.getByTestId("execution-cancel"));
    expect(screen.getByTestId("execution-cancel-dialog")).toBeVisible();
    expect(screen.getByTestId("execution-cancel-confirm")).toBeDisabled();
    await user.type(screen.getByTestId("execution-cancel-reason"), "业务窗口关闭");
    await user.click(screen.getByTestId("execution-cancel-confirm"));

    // gh-ost cancellation surfaces leftover resources for cleanup and the
    // order terminalizes into the copy-only path (E006).
    await waitFor(
      () => {
        expect(screen.getByTestId("execution-osc")).toHaveTextContent("需要清理");
      },
      { timeout: 5_000 },
    );
    await waitFor(
      () => {
        expect(screen.getByTestId("copy-draft-card")).toBeVisible();
      },
      { timeout: 5_000 },
    );
  }, 20_000);

  it("surfaces a preflight failure inside the dialog and allows re-execution", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-preflight");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f906" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));

    // The 3006 business error renders in place — no attempt is persisted, no
    // fake progress, and the executor may simply click again (not_started).
    await waitFor(() => {
      expect(screen.getByTestId("execution-action-error")).toBeVisible();
    }, { timeout: 5_000 });
    expect(screen.getByTestId("execution-action-error")).toHaveTextContent("执行前校验未通过");
    expect(screen.queryByTestId("execution-attempt-card")).toBeNull();
    expect(screen.getByTestId("execution-confirm-cancel")).toBeEnabled();
  }, 15_000);

  it("copies a terminal order to a new draft through the dialog", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-partial");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f907" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));
    await waitFor(
      () => {
        expect(screen.getByTestId("copy-draft-card")).toBeVisible();
      },
      { timeout: 8_000 },
    );

    await user.click(screen.getByTestId("copy-draft-open"));
    expect(screen.getByTestId("copy-draft-dialog")).toBeVisible();
    // The flow catalog loads and the title is prefilled from the order.
    expect(screen.getByTestId("copy-draft-flow")).toBeVisible();
    const titleValue = screen.getByTestId<HTMLInputElement>("copy-draft-title").value;
    expect(titleValue).toContain("执行夹具工单");
    // The confirm enables once the flow catalog resolves and a flow is picked.
    await waitFor(() => {
      expect(screen.getByTestId("copy-draft-confirm")).toBeEnabled();
    });
  }, 20_000);
});

describe("execution error and evidence branches", () => {
  it("renders a rejected cancellation inside the dialog and converges on refetch", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-ghost");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f908" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));
    await waitFor(() => {
      expect(screen.getByTestId("execution-cancel")).toBeEnabled();
    }, { timeout: 5_000 });

    // Force a lost race on the cancellation endpoint: the dialog shows the
    // backend rejection and the page refetches — no fake success.
    server.use(
      http.post("*/execution-attempts/:attemptId/cancellation", () =>
        HttpResponse.json(
          {
            err_code: 1004,
            message: "attempt changed elsewhere",
            data: null,
            request_id: "33333333-3333-4333-8333-333333333333",
            retryable: false,
          },
        ),
      ),
    );
    await user.click(screen.getByTestId("execution-cancel"));
    await user.type(screen.getByTestId("execution-cancel-reason"), "业务窗口关闭");
    await user.click(screen.getByTestId("execution-cancel-confirm"));
    expect(screen.getByTestId("execution-cancel-error")).toBeVisible();
    expect(screen.getByTestId("execution-cancel-error")).toHaveTextContent(/资源正在被其他人修改/);
    await user.click(screen.getByTestId("execution-cancel-cancel"));
  }, 20_000);

  it("shows the statement ledger read failure in place", async () => {
    const user = userEvent.setup();
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f909" });
    seedFixtureOrder(order);
    server.use(
      http.get("*/execution-attempts/:attemptId/statements", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "internal error",
            status: 500,
            request_id: "33333333-3333-4333-8333-333333333333",
          },
          { status: 500 },
        ),
      ),
    );
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));
    await waitFor(() => {
      expect(screen.getByText("逐语句结果读取失败。")).toBeVisible();
    }, { timeout: 5_000 });
  }, 15_000);

  it("keeps the order blocked on still_unknown and supports evidence editing", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("yearning-mock-scenario", "execution-unknown");
    const order = executionOrder({ id: "ee6f1a2b-0000-4000-8000-00000000f910" });
    seedFixtureOrder(order);
    renderDetail(order.id);

    await waitFor(() => {
      expect(screen.getByTestId("execution-start")).toBeEnabled();
    });
    await user.click(screen.getByTestId("execution-start"));
    await user.click(screen.getByTestId("execution-confirm-run"));
    await waitFor(
      () => {
        expect(screen.getByTestId("verification-form")).toBeVisible();
      },
      { timeout: 5_000 },
    );

    // Evidence rows can be added and removed, but never down to zero.
    await user.click(screen.getByTestId("verification-evidence-add"));
    expect(screen.getByTestId("verification-evidence-content-1")).toBeVisible();
    const secondRow = screen.getByTestId("verification-evidence-content-1").parentElement;
    const removeButton = secondRow?.querySelector('button[aria-label="移除证据"]');
    if (!(removeButton instanceof HTMLButtonElement)) throw new Error("remove button missing");
    await user.click(removeButton);
    expect(screen.queryByTestId("verification-evidence-content-1")).toBeNull();

    // still_unknown leaves the block in place — the order stays result_unknown.
    await user.click(screen.getByTestId("verification-result-still_unknown"));
    await user.type(screen.getByTestId("verification-reason"), "主从数据不一致，需DBA现场复核");
    await user.type(screen.getByTestId("verification-evidence-content-0"), "SHOW SLAVE STATUS 延迟未知");
    expect(screen.getByTestId("verification-submit")).toBeEnabled();
    await user.click(screen.getByTestId("verification-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("verification-form")).toBeVisible();
    }, { timeout: 5_000 });
    expect(screen.getByTestId("verification-result-still_unknown")).toHaveAttribute("aria-checked", "true");
  }, 20_000);
});
