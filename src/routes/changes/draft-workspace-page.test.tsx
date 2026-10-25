import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import type {
  GetReviewRun200,
  ReviewFinding,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  FIXTURE_FLOW_ID,
  FIXTURE_OWNER_ID,
  resetReviewFixture,
} from "@/shared/mock/review-fixture";
import { getReviewEventClient } from "@/shared/events/review-event-client";
import DraftWorkspacePage from "./draft-workspace-page";
import OrderDetailPage from "./order-detail-page";

/**
 * Workspace behavior gates (work package FE-F4-PRECHECK):
 * - 打开编辑不自动Review — mounting the page never creates a review run;
 * - SQL变化立即失效 — an unsaved edit voids a ready result locally;
 * - events stay notification-only: a flow.updated event blocks submission.
 * Monaco is stubbed with a plain textarea: the editor internals have their
 * own lifecycle guarantees, the page tests target draft/gate behavior.
 */

const OWNER = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

function findingFixture(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "4f6f1a2b-0000-4000-8000-00000000f101",
    stage_position: 1,
    fingerprint_group_id: null,
    category: "performance",
    severity: "low",
    title: "索引缺失",
    message: "语句 `UPDATE orders SET status = 1` 无法命中索引。",
    suggestion: "补充索引。",
    model_confidence: 0.9,
    evidence_ids: [],
    ...overrides,
  };
}

// jsdom lacks ResizeObserver; the resizable panels need it for layout.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/features/review/sql-editor-panel", () => ({
  SqlEditorPanel: ({
    value,
    onChange,
    ...rest
  }: {
    value: string;
    onChange: (sql: string) => void;
    readOnly?: boolean;
    loadValue?: unknown;
    onLocate?: unknown;
    "data-testid"?: string;
  }) => (
    <textarea
      aria-label="SQL 编辑器替身"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      data-testid={rest["data-testid"]}
    />
  ),
}));

interface FixtureDraft {
  id: string;
  revision: number;
  state: string;
  version: number;
  review_run_id: string | null;
}

async function createReadyDraft(): Promise<FixtureDraft> {
  const create = (await (
    await fetch("/change-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "预检E2E草稿" }),
    })
  ).json()) as { data: { id: string } };
  const draftId = create.data.id;
  await fetch(`/change-drafts/${draftId}/sql`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "UPDATE orders SET status = 1 WHERE user_id = 42;" }),
  });
  await fetch(`/change-drafts/${draftId}/review-runs`, { method: "POST" });
  // The fixture advances queued→running→ready on 400ms/900ms timers.
  await waitFor(
    async () => {
      const response = (await (
        await fetch(`/change-drafts/${draftId}`)
      ).json()) as { data: FixtureDraft };
      if (response.data.state !== "ready") throw new Error("run not finished yet");
      return response.data;
    },
    { timeout: 4000 },
  );
  const final = (await (await fetch(`/change-drafts/${draftId}`)).json()) as {
    data: FixtureDraft;
  };
  return final.data;
}

function renderWorkspace(draftId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
      <MemoryRouter initialEntries={[`/changes/drafts/${draftId}`]}>
        <Routes>
          <Route path="/changes/drafts/:draftId" element={<DraftWorkspacePage />} />
          <Route path="/changes/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

async function serveTerminalReview(
  draft: FixtureDraft,
  state: "failed" | "partial" | "blocked",
  findings: ReviewFinding[] = [],
): Promise<void> {
  if (draft.review_run_id === null) throw new Error("review run id missing");
  const snapshot = (await (
    await fetch(`/review-runs/${draft.review_run_id}`)
  ).json()) as GetReviewRun200;
  server.use(
    http.get("*/review-runs/:runId", () =>
      HttpResponse.json({
        ...snapshot,
        data: { ...snapshot.data, state },
      }),
    ),
    http.get("*/review-runs/:runId/findings", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          items: findings,
          page: { next_cursor: null, has_more: false },
        },
        request_id: OWNER,
      }),
    ),
  );
}

/** One-page layout (owner ruling 2026-10-24): the summary card and its
 * submission dock are always mounted next to the form — there is no step
 * navigation to walk anymore. Kept as a named no-op so the tests that used
 * to "advance to step 3" read the same at their call sites. */
function gotoStep3(): void {
  /* the dock is present from mount */
}

/** Forces the run query to re-read through the current MSW handlers. */
async function refetchRunQuery(
  queryClient: QueryClient,
  draftId: string,
  reviewRunId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["review-run", reviewRunId] });
  await queryClient.refetchQueries({ queryKey: ["review-run", reviewRunId] });
  void draftId;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

describe("DraftWorkspacePage", () => {
  it("mounts, loads draft state and never auto-creates a review run", async () => {
    const draft = await createReadyDraft();
    let reviewRunCalls = 0;
    server.use(
      http.post("*/review-runs", () => {
        reviewRunCalls += 1;
        return HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: OWNER });
      }),
    );
    renderWorkspace(draft.id);
    // The workspace presents the persisted result without any new run.
    expect(await screen.findByTestId("review-status")).toBeVisible();
    expect(screen.getByTestId("run-review")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(reviewRunCalls).toBe(0);
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
  });

  it("voids a ready result the instant the SQL changes locally", async () => {
    const draft = await createReadyDraft();
    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    // userEvent.type does not reliably synthesize input events through the
    // full page tree in jsdom; the gate is the page's reaction to a SQL
    // change, which fireEvent exercises directly.
    fireEvent.change(screen.getByTestId("sql-editor"), { target: { value: "SELECT 2" } });
    await waitFor(() => {
      expect(screen.getByTestId("review-status").textContent).toContain("结果已失效");
    });
    // The step-2 continue saves the edited SQL before advancing; the dock on
    // step 3 then blocks because the finished run no longer matches the new
    // revision (review outdated).
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("distinguishes terminal findings loading from an empty review", async () => {
    const draft = await createReadyDraft();
    const requestStarted = deferred();
    const releaseRequest = deferred();
    server.use(
      http.get("*/review-runs/:runId/findings", async () => {
        requestStarted.resolve();
        await releaseRequest.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            items: [],
            page: { next_cursor: null, has_more: false },
          },
          request_id: OWNER,
        });
      }),
    );

    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    fireEvent.click(screen.getByTestId("tab-findings"));
    await requestStarted.promise;

    expect(screen.getByTestId("findings-loading")).toHaveTextContent("正在加载风险发现");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();

    releaseRequest.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("findings-empty-all")).toBeVisible();
    });
  });

  it("loads every finding page before applying the severity filter", async () => {
    const user = userEvent.setup();
    const draft = await createReadyDraft();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      findingFixture({
        id: `4f6f1a2b-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: `低风险发现 ${String(index + 1)}`,
      }),
    );
    const secondPageFinding = findingFixture({
      id: "4f6f1a2b-0000-4000-8000-000000000051",
      severity: "critical",
      title: "第二页严重发现",
      message: "仅从第二页返回的严重风险。",
    });
    const requestedCursors: Array<string | null> = [];
    const requestedLimits: Array<string | null> = [];
    server.use(
      http.get("*/review-runs/:runId/findings", ({ request }) => {
        const url = new URL(request.url);
        const after = url.searchParams.get("after");
        requestedCursors.push(after);
        requestedLimits.push(url.searchParams.get("limit"));
        const isSecondPage = after === "cursor-page-2";
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            items: isSecondPage ? [secondPageFinding] : firstPage,
            page: isSecondPage
              ? { next_cursor: null, has_more: false }
              : { next_cursor: "cursor-page-2", has_more: true },
          },
          request_id: OWNER,
        });
      }),
    );

    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    fireEvent.click(screen.getByTestId("tab-findings"));
    await waitFor(() => {
      expect(requestedCursors).toEqual([null, "cursor-page-2"]);
    });
    expect(requestedLimits).toEqual(["200", "200"]);

    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("第二页严重发现")).toBeInTheDocument();
  });

  it("never presents a run read failure as an idle or empty review", async () => {
    const draft = await createReadyDraft();
    server.use(
      http.get("*/review-runs/:runId", () =>
        HttpResponse.json(
          {
            err_code: 5000,
            message: "review run temporarily unavailable",
            data: null,
            request_id: OWNER,
          },
          { status: 500 },
        ),
      ),
    );

    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status-error")).toHaveTextContent("请求失败");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(await screen.findByTestId("findings-error")).toHaveTextContent("请求失败");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("keeps run loading distinct from a draft that never started a review", async () => {
    const draft = await createReadyDraft();
    const snapshot = (await (
      await fetch(`/review-runs/${draft.review_run_id ?? ""}`)
    ).json()) as GetReviewRun200;
    const requestStarted = deferred();
    const releaseRequest = deferred();
    server.use(
      http.get("*/review-runs/:runId", async () => {
        requestStarted.resolve();
        await releaseRequest.promise;
        return HttpResponse.json(snapshot);
      }),
    );

    renderWorkspace(draft.id);
    await requestStarted.promise;
    expect(screen.getByTestId("review-status-loading")).toHaveTextContent("正在读取审核状态");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(screen.getByTestId("findings-loading")).toHaveTextContent("正在加载风险发现");
    expect(screen.queryByTestId("findings-idle")).not.toBeInTheDocument();

    releaseRequest.resolve();
    fireEvent.click(screen.getByTestId("tab-overview"));
    expect(await screen.findByTestId("review-counts")).toBeVisible();
  });

  it("keeps the findings tab in a waiting state while the review is queued", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "等待中的风险发现" }),
      })
    ).json()) as { data: { id: string } };
    const draftId = create.data.id;
    await fetch(`/change-drafts/${draftId}/sql`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "UPDATE orders SET status = 1 WHERE user_id = 42;" }),
    });
    const started = (await (
      await fetch(`/change-drafts/${draftId}/review-runs`, { method: "POST" })
    ).json()) as { data: { result_ref: string } };
    const runId = started.data.result_ref.split("/").pop();
    if (runId === undefined) throw new Error("review run reference missing");
    const queuedSnapshot = (await (
      await fetch(`/review-runs/${runId}`)
    ).json()) as GetReviewRun200;
    server.use(
      http.get("*/review-runs/:runId", () => HttpResponse.json(queuedSnapshot)),
    );

    renderWorkspace(draftId);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    fireEvent.click(screen.getByTestId("tab-findings"));

    const waiting = screen.getByTestId("findings-waiting");
    expect(waiting).toHaveAttribute("role", "status");
    expect(waiting).toHaveTextContent("风险发现将在所有审核阶段完成后显示");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("shows a retryable findings error instead of claiming no risks", async () => {
    const draft = await createReadyDraft();
    server.use(
      http.get("*/review-runs/:runId/findings", () =>
        HttpResponse.json(
          {
            err_code: 5000,
            message: "findings temporarily unavailable",
            data: null,
            request_id: OWNER,
          },
          { status: 500 },
        ),
      ),
    );

    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    fireEvent.click(screen.getByTestId("tab-findings"));

    expect(await screen.findByTestId("findings-error")).toHaveTextContent("请求失败");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
    });
  });

  it.each(["failed", "partial", "blocked"] as const)(
    "does not claim no risks when a %s review has no findings",
    async (state) => {
      const draft = await createReadyDraft();
      await serveTerminalReview(draft, state, []);

      renderWorkspace(draft.id);
      expect(await screen.findByTestId("review-status")).toBeVisible();
      fireEvent.click(screen.getByTestId("tab-findings"));

      const incomplete = await screen.findByTestId("findings-incomplete");
      expect(incomplete).toHaveTextContent("审核未完整完成");
      expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
      expect(screen.getByTestId("submit-draft")).toBeDisabled();
    },
  );

  it("treats a flow.updated domain event as a submission blocker", async () => {
    const draft = await createReadyDraft();
    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    getReviewEventClient().ingest({
      specversion: "1.0",
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f9901",
      type: "io.yearning.v4.flow.updated",
      source: "yearning://control-plane",
      subject: `flows/${FIXTURE_FLOW_ID}`,
      time: "2026-08-30T00:00:00Z",
      sequence: 1,
      data: {
        resource_id: FIXTURE_FLOW_ID,
        action: "updated",
        aggregate_version: 2,
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId("flow-updated-banner")).toBeVisible();
    });
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("recovers the finished run on remount without creating a new one (页面刷新后可以恢复Run)", async () => {
    const draft = await createReadyDraft();
    let reviewRunCalls = 0;
    server.use(
      http.post("*/review-runs", () => {
        reviewRunCalls += 1;
        return HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: OWNER });
      }),
    );
    const first = renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    first.unmount();
    renderWorkspace(draft.id);
    // The fresh page instance re-reads the persisted run via HTTP and folds
    // it straight to the terminal phase — no new run, no regressed state.
    expect(await screen.findByTestId("review-status")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    });
    expect(reviewRunCalls).toBe(0);
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
  });

  it("a stale HTTP snapshot never walks the phase backwards (乱序事件不回退状态)", async () => {
    const draft = await createReadyDraft();
    const { queryClient } = renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    });
    // Simulate an interleaved stale snapshot: the next run refetch answers
    // an older running state (e.g. a CDN/cacheaged response). The fold must
    // keep the presented terminal phase and the submission unlock.
    server.use(
      http.get("*/review-runs/:runId", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: "4f6f1a2b-0000-4000-8000-0000000057a1",
            draft_id: draft.id,
            draft_revision: draft.revision,
            state: "running",
            statement_count: 1,
            fingerprint_group_count: 1,
            stage_results: [],
            gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
            failure_code: null,
            version: 1,
            created_at: "2026-08-30T00:00:00Z",
            started_at: "2026-08-30T00:00:01Z",
            finished_at: null,
          },
          request_id: OWNER,
        }),
      ),
    );
    const freshDraft = (await (await fetch(`/change-drafts/${draft.id}`)).json()) as {
      data: { review_run_id: string | null };
    };
    await refetchRunQuery(queryClient, draft.id, freshDraft.data.review_run_id as string);
    // The monotonic fold keeps the presented phase terminal (no backwards
    // walk); the gate, however, re-evaluates against whatever snapshot the
    // query last returned, so submission stays conservatively locked until
    // the next fresh read reconciles — never a fake unlock.
    expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("survives a draft fetch failure with the shared error state", async () => {
    server.use(
      http.get("*/change-drafts/unknown-draft", () =>
        HttpResponse.json({
          err_code: 1002,
          message: "not found",
          data: null,
          request_id: OWNER,
          retryable: false,
        }),
      ),
    );
    renderWorkspace("unknown-draft");
    expect(await screen.findByRole("alert")).toBeVisible();
  });

  it("renders a bulk draft in the virtualized browser, never in the editor", async () => {
    // 2000 similar statements + one no-WHERE anomaly: the fixture digests the
    // bulk draft into two shape groups and the anomaly blocks the gate.
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "批量预检草稿" }),
      })
    ).json()) as { data: { id: string } };
    const draftId = create.data.id;
    const parts: string[] = [];
    for (let i = 1; i <= 2000; i += 1) {
      parts.push(
        `UPDATE orders SET status = 'processed', updated_at = '2026-08-25' WHERE id = ${String(i)};\n`,
      );
    }
    // Deterministic single anomaly at ordinal 432.
    parts[431] = "UPDATE orders SET status = 'processed';\n";
    await fetch(`/change-drafts/${draftId}/sql`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: parts.join("") }),
    });
    await fetch(`/change-drafts/${draftId}/review-runs`, { method: "POST" });
    await waitFor(async () => {
      const response = (await (
        await fetch(`/change-drafts/${draftId}`)
      ).json()) as { data: FixtureDraft };
      if (response.data.state !== "blocked") throw new Error("run not finished yet");
    }, { timeout: 4000 });

    renderWorkspace(draftId);
    // Bulk mode loads SQL only on explicit reveal (memory discipline) — the
    // browser appears after the local digest is derived from the plaintext.
    expect(await screen.findByTestId("bulk-digest-pending")).toBeVisible();
    expect(screen.queryByTestId("sql-editor")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reveal-sql"));
    expect(await screen.findByTestId("bulk-browser")).toBeVisible();
    // Capacity summary reflects the server-run counts.
    await waitFor(() => {
      expect(screen.getByTestId("capacity-statements").textContent).toBe("2000");
      expect(screen.getByTestId("capacity-groups").textContent).toContain("2");
    });
    // The anomalous statement is a finding on its own fingerprint group —
    // visible outside the aggregate (单条异常不被聚合隐藏).
    fireEvent.click(screen.getByTestId("tab-findings"));
    const findings = await screen.findAllByTestId("finding-item");
    const anomalyFinding = findings.find((node) =>
      node.textContent.includes("无 WHERE 条件的批量 DML"),
    );
    expect(anomalyFinding).not.toBeUndefined();
    if (anomalyFinding === undefined) throw new Error("anomaly finding missing");
    expect(anomalyFinding.textContent).toContain("#432");
    expect(anomalyFinding.textContent).toContain("指纹组 #2");
  });

  it("requires the explicit submit confirmation and lands on the order detail (F6)", async () => {
    const draft = await createReadyDraft();
    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    gotoStep3();
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();

    // The dock click only opens the confirmation; no submission fires yet.
    fireEvent.click(screen.getByTestId("submit-draft"));
    expect(await screen.findByTestId("submit-confirm-dialog")).toBeVisible();
    expect(screen.getByTestId("submit-confirm-gate").textContent).toContain("全部阶段审核通过");

    // Confirming submits and navigates to the immutable order detail.
    fireEvent.click(screen.getByTestId("submit-confirm-accept"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page")).toBeVisible();
    });
    const order = (await (
      await fetch("/change-orders")
    ).json()) as { data: { items: Array<{ display_number: string }> } };
    expect(order.data.items).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page").textContent).toContain(
        order.data.items[0]?.display_number ?? "",
      );
    });
  });

  it("keeps the confirm dialog open with the backend rejection on a failed submit (后端拒绝无假成功)", async () => {
    const draft = await createReadyDraft();
    // Simulate a gate change between the dock's presentation and the
    // submission transaction: the backend answers 2013 through MSW.
    server.use(
      http.post("*/change-drafts/:draftId/submission", () =>
        HttpResponse.json({
          err_code: 2013,
          message: "submission gate failed",
          data: null,
          request_id: OWNER,
          retryable: false,
        }),
      ),
    );
    renderWorkspace(draft.id);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    gotoStep3();
    await screen.findByTestId("wizard-summary");
    fireEvent.click(screen.getByTestId("submit-draft"));
    expect(await screen.findByTestId("submit-confirm-dialog")).toBeVisible();
    fireEvent.click(screen.getByTestId("submit-confirm-accept"));
    const error = await screen.findByTestId("submit-confirm-error");
    expect(error.textContent.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("order-detail-page")).toBeNull();
    // The draft stays unsubmitted — no fake success anywhere.
    expect(screen.getByTestId("submit-confirm-dialog")).toBeVisible();
  });
});
