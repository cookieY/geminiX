import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import {
  FIXTURE_FLOW_ID,
  resetReviewFixture,
} from "@/shared/mock/review-fixture";
import { getReviewEventClient } from "@/shared/events/review-event-client";
import DraftWorkspacePage from "./draft-workspace-page";

/**
 * Workspace behavior gates (work package FE-F4-PRECHECK):
 * - 打开编辑不自动Review — mounting the page never creates a review run;
 * - SQL变化立即失效 — an unsaved edit voids a ready result locally;
 * - events stay notification-only: a flow.updated event blocks submission.
 * Monaco is stubbed with a plain textarea: the editor internals have their
 * own lifecycle guarantees, the page tests target draft/gate behavior.
 */

const OWNER = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

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
      <MemoryRouter initialEntries={[`/changes/drafts/${draftId}`]}>
        <Routes>
          <Route path="/changes/drafts/:draftId" element={<DraftWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
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

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
});

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
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("未保存");
  });

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
            id: "4f6f1a2b-0000-4000-8000-00000000stale",
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
    expect(screen.getByTestId("review-status").textContent).toContain("审核结果完整");
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
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
});
