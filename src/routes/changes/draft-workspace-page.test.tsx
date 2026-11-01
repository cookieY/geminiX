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
  ReviewRun,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  FIXTURE_FLOW_ID,
  FIXTURE_OWNER_ID,
  fixtureRunIds,
  resetReviewFixture,
} from "@/shared/mock/review-fixture";
import { getReviewEventClient } from "@/shared/events/review-event-client";
import DraftWorkspacePage from "./draft-workspace-page";
import OrderDetailPage from "./order-detail-page";

/**
 * Workspace behavior gates (work package FE-F4-PRECHECK, RCP-20261101
 * ephemeral precheck):
 * - 打开编辑不自动Review — mounting the page never starts a run;
 * - 预审只送当前编辑器SQL — the run id lives in client state only;
 * - SQL变化立即失效 — a local edit voids a ready result (staleness is the
 *   editor text vs the text sent for the last precheck);
 * - remount loses the ephemeral result (in-memory run, no draft linkage);
 * - events stay notification-only: a flow.updated event blocks submission.
 * Monaco is stubbed with a plain textarea: the editor internals have their
 * own lifecycle guarantees, the page tests target draft/gate behavior.
 */

const OWNER = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";
const WORKSPACE_SQL = "UPDATE orders SET status = 1 WHERE user_id = 42;";

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

async function createDraftWithSql(title = "预检E2E草稿"): Promise<string> {
  const create = (await (
    await fetch("/change-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title }),
    })
  ).json()) as { data: { id: string } };
  await fetch(`/change-drafts/${create.data.id}/sql`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: WORKSPACE_SQL }),
  });
  return create.data.id;
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

/** Loads the server SQL into the editor (memory discipline: explicit reveal)
 * so a UI precheck has text to send. */
async function revealEditor(): Promise<HTMLElement> {
  // Owner ruling 2026-11-01：草稿进入即自动装载全文（读取SQL门槛已撤）。
  const editor = await screen.findByTestId("sql-editor");
  await waitFor(() => {
    expect(editor).toHaveValue(WORKSPACE_SQL);
  });
  return editor;
}

/** Drives the real fixture path: reveal → AI预审 → wait for ready. Returns
 * the started run id (client state; the draft row never carries it). */
async function precheckToReady(): Promise<string> {
  await revealEditor();
  fireEvent.click(screen.getByTestId("run-review"));
  await waitFor(
    () => {
      expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    },
    { timeout: 4_000 },
  );
  const runId = fixtureRunIds().at(-1);
  if (runId === undefined) throw new Error("fixture carries no review run");
  return runId;
}

/** A full UI-driven ready workspace: draft + SQL + precheck through the
 * page (the only writer of the run is the AI预审 click). */
async function renderReadyWorkspace(): Promise<{
  utils: ReturnType<typeof renderWorkspace>;
  draftId: string;
  runId: string;
}> {
  const draftId = await createDraftWithSql();
  const utils = renderWorkspace(draftId);
  expect(await screen.findByTestId("review-status")).toBeVisible();
  const runId = await precheckToReady();
  return { utils, draftId, runId };
}

/** Forces the run query to re-read through the current MSW handlers. */
async function refetchRunQuery(
  queryClient: ReturnType<typeof renderWorkspace>["queryClient"],
  reviewRunId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["review-run", reviewRunId] });
  await queryClient.refetchQueries({ queryKey: ["review-run", reviewRunId] });
}

/** A frozen queued snapshot the wizard polls instead of the live timers. */
function frozenQueuedRun(runId: string): ReviewRun {
  return {
    id: runId,
    draft_id: FIXTURE_FLOW_ID,
    draft_revision: 0,
    state: "queued",
    statement_count: 1,
    fingerprint_group_count: 1,
    stage_results: [],
    gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
    failure_code: null,
    version: 1,
    created_at: "2026-08-30T00:00:00Z",
    started_at: null,
    finished_at: null,
  };
}

/** A frozen terminal run snapshot for freeze-then-precheck drives. */
function frozenTerminalRun(runId: string, state: "failed" | "partial" | "blocked"): ReviewRun {
  return {
    ...frozenQueuedRun(runId),
    state,
    finished_at: "2026-08-30T00:00:02Z",
    failure_code: state === "blocked" ? "risk_blocked" : "coverage_incomplete",
    gate: { passed: false, reason_codes: [state === "blocked" ? "critical_severity_finding" : "stage_review_incomplete"] },
  };
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
    const draftId = await createDraftWithSql();
    renderWorkspace(draftId);
    // The workspace mounts idle — no run exists until the explicit click.
    expect(await screen.findByTestId("review-status")).toBeVisible();
    expect(screen.getByTestId("run-review")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(fixtureRunIds()).toHaveLength(0);
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("prechecks the current editor SQL and unlocks submit on a passing gate", async () => {
    const { runId } = await renderReadyWorkspace();
    // The precheck run exists in the ephemeral world and passed the gate.
    const run = (await (
      await fetch(`/review-runs/${runId}`)
    ).json()) as GetReviewRun200;
    expect(run.err_code).toBe(0);
    expect(run.data?.state).toBe("ready");
    expect(run.data?.gate.passed).toBe(true);
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
  });

  it("voids a ready result the instant the SQL changes locally", async () => {
    await renderReadyWorkspace();
    // userEvent.type does not reliably synthesize input events through the
    // full page tree in jsdom; the gate is the page's reaction to a SQL
    // change, which fireEvent exercises directly.
    fireEvent.change(screen.getByTestId("sql-editor"), { target: { value: "SELECT 2" } });
    await waitFor(() => {
      expect(screen.getByTestId("review-status").textContent).toContain("SQL已修改");
    });
    // The dock blocks: the editor text no longer matches the prechecked text
    // (staleness is a pure local comparison, RCP-20261101).
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(await screen.findByTestId("findings-stale")).toHaveTextContent("SQL已修改");
  });

  it("presents the expired state when the precheck run disappears (TTL/重启)", async () => {
    // 过期在轮询窗口内发生（运行中404）：冻结404后发起预审，首个
    // 轮询即命中 → 过期呈现，提交保持锁定（派生语义，RCP-20261101）。
    const draftId = await createDraftWithSql("过期态预审");
    server.use(
      http.get("*/review-runs/:runId", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            detail: "review run expired",
            request_id: OWNER,
          },
          { status: 404 },
        ),
      ),
    );
    renderWorkspace(draftId);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    await revealEditor();
    fireEvent.click(screen.getByTestId("run-review"));
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(await screen.findByTestId("findings-expired")).toHaveTextContent("预审结果已过期");
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("distinguishes terminal findings loading from an empty review", async () => {
    // 首次fetch就挂起：run终态瞬间findings查询发起（renderReady等的是
    // review-status，不依赖发现）——加载中就是首拉未完成的呈现。
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

    await renderReadyWorkspace();
    await requestStarted.promise;
    fireEvent.click(screen.getByTestId("tab-findings"));

    expect(await screen.findByTestId("findings-loading")).toHaveTextContent("正在加载风险发现");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();

    releaseRequest.resolve();
    expect(await screen.findByTestId("findings-empty-all")).toBeVisible();
  });

  it("loads every finding page before applying the severity filter", async () => {
    const user = userEvent.setup();
    // 分页处理器先装好：run终态瞬间的首拉即吃到两页游标。
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

    await renderReadyWorkspace();
    fireEvent.click(screen.getByTestId("tab-findings"));
    await waitFor(() => {
      // 首拉即完整翻页：null → cursor-page-2，翻页limit恒为200。
      expect(requestedCursors).toEqual([null, "cursor-page-2"]);
    });
    expect(requestedLimits).toEqual(["200", "200"]);

    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("第二页严重发现")).toBeInTheDocument();
  });

  it("never presents a run read failure as an idle or empty review", async () => {
    const { utils, runId } = await renderReadyWorkspace();
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
    await refetchRunQuery(utils.queryClient, runId);

    expect(await screen.findByTestId("review-status-error")).toHaveTextContent("请求失败");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(await screen.findByTestId("findings-error")).toHaveTextContent("请求失败");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("keeps run loading distinct from a draft that never started a review", async () => {
    const { utils, runId } = await renderReadyWorkspace();
    const snapshot = (await (
      await fetch(`/review-runs/${runId}`)
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
    // fire-and-forget：重取被deferred挂起正是要断言的中间态，await会死锁。
    void refetchRunQuery(utils.queryClient, runId);

    await requestStarted.promise;
    expect(await screen.findByTestId("review-status-loading")).toHaveTextContent("正在读取审核状态");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-findings"));
    expect(await screen.findByTestId("findings-loading")).toHaveTextContent("正在加载风险发现");
    expect(screen.queryByTestId("findings-idle")).not.toBeInTheDocument();

    releaseRequest.resolve();
    fireEvent.click(screen.getByTestId("tab-overview"));
    expect(await screen.findByTestId("review-counts")).toBeVisible();
  });

  it("keeps the findings tab in a waiting state while the review is queued", async () => {
    const draftId = await createDraftWithSql("等待中的风险发现");
    // Freeze every run read at queued: the wizard never observes a terminal
    // snapshot no matter how the fixture timers advance.
    server.use(
      http.get("*/review-runs/:runId", ({ params }) =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: frozenQueuedRun(String(params.runId)),
          request_id: OWNER,
        }),
      ),
    );

    renderWorkspace(draftId);
    expect(await screen.findByTestId("review-status")).toBeVisible();
    await revealEditor();
    fireEvent.click(screen.getByTestId("run-review"));
    fireEvent.click(screen.getByTestId("tab-findings"));

    const waiting = await screen.findByTestId("findings-waiting");
    expect(waiting).toHaveAttribute("role", "status");
    expect(waiting).toHaveTextContent("风险发现将在所有审核阶段完成后显示");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("shows a retryable findings error instead of claiming no risks", async () => {
    // 首拉即500：run终态瞬间查询发起并失败——错误态直显、可重试。
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
    await renderReadyWorkspace();
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
      // freeze-then-precheck：终态从首拍就冻结（瞬态流下同一Run的
      // 状态不会回退——ready→failed的服务器行为不存在，单调fold正确
      // 拒绝；要断言终态呈现，就让预审从头到尾只见到该终态）。
      const draftId = await createDraftWithSql(state + "态无发现");
      server.use(
        http.get("*/review-runs/:runId", ({ params }) =>
          HttpResponse.json({
            err_code: 0,
            message: "ok",
            data: frozenTerminalRun(String(params.runId), state),
            request_id: OWNER,
          }),
        ),
        http.get("*/review-runs/:runId/findings", () =>
          HttpResponse.json({
            err_code: 0,
            message: "ok",
            data: { items: [], page: { next_cursor: null, has_more: false } },
            request_id: OWNER,
          }),
        ),
      );
      renderWorkspace(draftId);
      expect(await screen.findByTestId("review-status")).toBeVisible();
      await revealEditor();
      fireEvent.click(screen.getByTestId("run-review"));
      fireEvent.click(screen.getByTestId("tab-findings"));

      const incomplete = await screen.findByTestId("findings-incomplete");
      expect(incomplete).toHaveTextContent("审核未完整完成");
      expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
      expect(screen.getByTestId("submit-draft")).toBeDisabled();
    },
  );

  it("treats a flow.updated domain event as a submission blocker", async () => {
    await renderReadyWorkspace();
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
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("loses the ephemeral result on remount and requires a re-precheck (瞬态Run不落库)", async () => {
    const { utils, draftId } = await renderReadyWorkspace();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
    utils.unmount();

    renderWorkspace(draftId);
    // The fresh page instance has no client-state run id: the precheck
    // result is gone (in-memory run, no draft.review_run_id linkage) — the
    // workspace honestly presents 未预审 and never fabricates a result.
    expect(await screen.findByTestId("review-status")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("review-status").textContent).toContain("未预审");
    });
    expect(fixtureRunIds().length).toBeGreaterThan(0);
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    // A fresh precheck restores the result through the same UI path.
    await precheckToReady();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
  });

  it("a stale HTTP snapshot never walks the phase backwards (乱序事件不回退状态)", async () => {
    const { utils, runId } = await renderReadyWorkspace();
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
            ...frozenQueuedRun(runId),
            state: "running",
            started_at: "2026-08-30T00:00:01Z",
          },
          request_id: OWNER,
        }),
      ),
    );
    await refetchRunQuery(utils.queryClient, runId);
    // The monotonic fold keeps the presented phase terminal (no backwards
    // walk); the gate, however, re-evaluates against whatever snapshot the
    // query last returned, so submission stays conservatively locked until
    // the next fresh read reconciles — never a fake unlock.
    expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    // 终态呈现保持；提交侧按最后快照保守锁定（running快照的gate未过）。
    await waitFor(() => {
      expect(screen.getByTestId("submit-draft")).toBeDisabled();
    });
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
    // 2000 similar statements + one no-WHERE anomaly: the precheck digests
    // the bulk SQL into two shape groups and the anomaly blocks the gate.
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
    const bulkSql = parts.join("");
    await fetch(`/change-drafts/${draftId}/sql`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: bulkSql }),
    });

    renderWorkspace(draftId);
    // Owner ruling 2026-11-01（读取SQL门槛是过度设计）：草稿进入即
    // 自动装载全文——浏览器直接出现，编辑器永不挂载，预审载荷有文。
    expect(await screen.findByTestId("bulk-browser")).toBeVisible();
    expect(screen.queryByTestId("sql-editor")).not.toBeInTheDocument();
    // The precheck sends the editor SQL verbatim; the run mirrors its counts.
    fireEvent.click(screen.getByTestId("run-review"));
    await waitFor(() => {
      expect(screen.getByTestId("capacity-statements").textContent).toBe("2000");
      expect(screen.getByTestId("capacity-groups").textContent).toContain("2");
    }, { timeout: 4_000 });
    // 终态后再开发现Tab（capacity计数来自本地digest，可早于run终态）。
    await waitFor(() => {
      expect(screen.getByTestId("submit-draft")).toBeDisabled();
    }, { timeout: 4_000 });
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
    await renderReadyWorkspace();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();

    // The dock click only opens the confirmation; no submission fires yet.
    fireEvent.click(screen.getByTestId("submit-draft"));
    expect(await screen.findByTestId("submit-confirm-dialog")).toBeVisible();
    expect(screen.getByTestId("submit-confirm-gate").textContent).toContain("全部阶段审核通过");

    // Confirming submits (POST /change-orders carries the editor SQL plus
    // the precheck run id) and navigates to the immutable order detail.
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
    await renderReadyWorkspace();
    // Simulate a gate change between the dock's presentation and the
    // submission transaction: the backend answers 2013 through MSW.
    server.use(
      http.post("*/change-orders", () =>
        HttpResponse.json({
          err_code: 2013,
          message: "submission gate failed",
          data: null,
          request_id: OWNER,
          retryable: false,
        }),
      ),
    );
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
