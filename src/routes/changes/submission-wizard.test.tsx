import { fireEvent, within, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import i18n from "@/shared/i18n";
import {
  FIXTURE_FLOW_ID,
  FIXTURE_OWNER_ID,
  fixtureRunIds,
  resetReviewFixture,
} from "@/shared/mock/review-fixture";
import { setMockAuthBehavior } from "@/shared/mock/auth-scenario-store";
import ChangesNewPage from "./changes-new-page";
import DraftWorkspacePage from "./draft-workspace-page";

/**
 * Submission wizard create-mode gates (§18.34) under the ephemeral precheck
 * contract (RCP-20261101): the AI预审 button sends the CURRENT editor SQL to
 * POST /review-runs verbatim — it never adopts a draft, never saves SQL;
 * 保存并返回 stays the only writer (adoption + SQL PUT); bulk import lands
 * SQL locally; submission posts /change-orders with {sql, run_id, metadata}.
 */

// jsdom cannot drive ProseMirror's contenteditable; the editor has its own
// unit test, so the wizard test swaps in a textarea with the same contract.
vi.mock("@/shared/components/markdown-editor", () => ({
  MarkdownEditor: ({ value, onChange, id, "data-testid": testId }: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    "data-testid"?: string;
  }) => (
    <textarea id={id} data-testid={testId} value={value} onChange={(event) => { onChange(event.target.value); }} />
  ),
}));

vi.mock("@/features/review/sql-editor-panel", () => ({
  SqlEditorPanel: ({
    value,
    onChange,
    ...rest
  }: {
    value: string;
    onChange: (sql: string) => void;
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

function renderWizard(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/changes/new" element={<ChangesNewPage />} />
            <Route path="/changes/drafts/:draftId" element={<DraftWorkspacePage />} />
            <Route path="/changes/mine" element={<p data-testid="mine-page">mine</p>} />
            <Route path="/changes/orders/:orderId" element={<p data-testid="order-detail-stub">order</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

function pickImportFile(content: string): void {
  const input = screen.getByTestId("bulk-import-input");
  const file = new File([content], "bulk.sql", { type: "text/plain" });
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input);
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

interface PrecheckCapture {
  bodies: Array<{ flow_id?: string; draft_id?: string; sql?: string }>;
  languages: Array<string | null>;
}

/** Captures POST /review-runs requests (server.use layers above the stateful
 * fixture: the override wins and progression is not needed for these tests). */
function capturePrechecks(): PrecheckCapture {
  const capture: PrecheckCapture = { bodies: [], languages: [] };
  server.use(
    http.post("*/review-runs", async ({ request }) => {
      capture.bodies.push((await request.json()) as PrecheckCapture["bodies"][number]);
      capture.languages.push(request.headers.get("Accept-Language"));
      return HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: { run_id: crypto.randomUUID(), result_ref: `/review-runs/${crypto.randomUUID()}` },
        request_id: FIXTURE_OWNER_ID,
      });
    }),
  );
  return capture;
}

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  // The review fixture answers /users/me/flows only for the admin behavior
  // (the e2e mockSession(page, "admin") equivalent).
  setMockAuthBehavior("admin");
  grantSession();
});

afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("SubmissionWizard create mode (ephemeral precheck)", () => {
  it("prechecks the current editor SQL without adopting a draft", async () => {
    const capture = capturePrechecks();
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    // One-page layout: the editor is live from the start — no draft gate.
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    // No flow picked: the acting operation surfaces the near-field error.
    fireEvent.click(screen.getByTestId("run-review"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("审核流程");

    // Flow picked: the precheck sends the editor SQL verbatim — no draft is
    // created, no SQL is written (RCP-20261101). The title gate belongs to
    // 保存并返回/提交, not to the precheck.
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    const runReview = screen.getByTestId("run-review");
    fireEvent.click(runReview);
    fireEvent.click(runReview);
    await waitFor(() => {
      expect(capture.bodies).toHaveLength(1);
    });
    expect(capture.bodies[0]).toEqual({
      flow_id: FIXTURE_FLOW_ID,
      sql: "UPDATE orders SET status = 1;",
    });
    expect(capture.languages).toEqual(["zh-CN"]);
    expect(screen.getByTestId("changes-new-page")).toBeVisible();
    // 预审绝不领养：页面不携带草稿id，草稿列表为空。
    expect(screen.getByTestId("changes-new-page").getAttribute("data-draft-id")).toBeNull();
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: unknown[] };
    };
    expect(drafts.data.items).toHaveLength(0);
  });

  it("sends the page language with the AI review request", async () => {
    await i18n.changeLanguage("en-US");
    const capture = capturePrechecks();

    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => {
      expect(capture.languages).toEqual(["en-US"]);
    });
  });

  it("keeps bulk import local — no server write on the import path", async () => {
    let sqlPutCalls = 0;
    server.use(
      http.put("*/change-drafts/:draftId/sql", () => {
        sqlPutCalls += 1;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: null,
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));

    fireEvent.click(screen.getByTestId("open-bulk-import"));
    expect(await screen.findByTestId("bulk-import-dialog")).toBeVisible();
    pickImportFile("SELECT 1;\n".repeat(1001));
    expect(await screen.findByTestId("bulk-import-ok")).toBeVisible();
    fireEvent.click(screen.getByTestId("bulk-import-confirm"));

    // The import lands in local state only: the virtualized browser reads
    // the local digest; no draft, no SQL PUT (RCP-20261101).
    expect(await screen.findByTestId("bulk-browser")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("capacity-statements")).toHaveTextContent("1001");
    });
    expect(screen.queryByTestId("sql-editor")).not.toBeInTheDocument();
    expect(sqlPutCalls).toBe(0);
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: unknown[] };
    };
    expect(drafts.data.items).toHaveLength(0);
  });

  it("submits draftless with {sql, run_id, metadata} after a passing precheck", async () => {
    const submissions: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/change-orders", async ({ request }) => {
        submissions.push((await request.json()) as Record<string, unknown>);
        // The success path only reads {id, display_number} for navigation.
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { id: "0d5e1f2b-0000-4000-8000-00000000de01", display_number: "YR-20261101-000001" },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "直提工单" },
    });
    fireEvent.change(screen.getByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1 WHERE user_id = 42;" },
    });
    // Real fixture precheck: the run reaches ready on its own timers.
    fireEvent.click(screen.getByTestId("run-review"));
    await waitFor(() => {
      expect(screen.getByTestId("submit-draft")).toBeEnabled();
    }, { timeout: 4_000 });

    fireEvent.click(screen.getByTestId("submit-draft"));
    expect(await screen.findByTestId("submit-confirm-dialog")).toBeVisible();
    fireEvent.click(screen.getByTestId("submit-confirm-accept"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-stub")).toBeVisible();
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.flow_id).toBe(FIXTURE_FLOW_ID);
    expect(submissions[0]?.sql).toBe("UPDATE orders SET status = 1 WHERE user_id = 42;");
    expect(submissions[0]?.run_id).toBe(fixtureRunIds().at(-1));
    expect(submissions[0]?.draft_id).toBeUndefined();
    expect(submissions[0]?.metadata).toEqual({ title: "直提工单" });
  });

  it("carries the desired execution time onto the implicitly created draft (§18.56)", async () => {
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "定时工单" },
    });
    // DateTimePicker（§18.56补记2 桌面选择器式）：输入框开面板→点ISO天→
    // 底部"时间"切换到时分列→选09/30→确定。
    fireEvent.click(screen.getByTestId("draft-requested-for"));
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const iso = `${String(tomorrow.getFullYear())}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    fireEvent.click(await screen.findByRole("button", { name: iso }));
    fireEvent.click(screen.getByTestId("draft-requested-for-time-toggle"));
    fireEvent.click(within(screen.getByTestId("dtp-hours")).getByRole("button", { name: "09" }));
    fireEvent.click(within(screen.getByTestId("dtp-minutes")).getByRole("button", { name: "30" }));
    fireEvent.click(screen.getByTestId("draft-requested-for-confirm"));
    expect(screen.queryByTestId("draft-requested-for-panel")).toBeNull();
    expect(screen.getByTestId("draft-requested-for")).toHaveValue("2026-10-16 09:30".replace("2026-10-16", iso));
    // 保存草稿 stays the only adopter: it opts into the draft implicitly.
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ requested_scheduled_for: string | null }> };
    };
    expect(drafts.data.items[0]?.requested_scheduled_for).not.toBeNull();
  });
});

describe("SubmissionWizard in-flight SQL saves", () => {
  it("prechecks the current editor text without saving it (预审不捎带保存)", async () => {
    // owner裁定2026-10-31+RCP-20261101：预审送当前编辑器SQL逐字评审，
    // 绝不写SQL；编辑器本地新文本原样保留。
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "运行不保存" }),
      })
    ).json()) as {
      data: {
        id: string;
        version: number;
        revision: number;
        has_sql: boolean;
        [key: string]: unknown;
      };
    };
    const draft = created.data;
    const precheckBodies: Array<{ sql?: string; draft_id?: string }> = [];
    let sqlPutCalls = 0;
    server.use(
      http.put("*/change-drafts/:draftId/sql", () => {
        sqlPutCalls += 1;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { ...draft, has_sql: true },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
      http.post("*/review-runs", async ({ request }) => {
        precheckBodies.push((await request.json()) as { sql?: string; draft_id?: string });
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { run_id: crypto.randomUUID(), result_ref: "/review-runs/x" },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => {
      expect(precheckBodies).toHaveLength(1);
    });
    // 逐字送审：请求体SQL=编辑器当前文本，且携带草稿锚定id。
    expect(precheckBodies[0]?.sql).toBe("UPDATE orders SET status = 2;");
    expect(precheckBodies[0]?.draft_id).toBe(draft.id);
    expect(sqlPutCalls).toBe(0);
    expect(editor).toHaveValue("UPDATE orders SET status = 2;");
  });

  it("disables the precheck button immediately while the start is in flight (owner priority)", async () => {
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "预审不捎带保存" }),
      })
    ).json()) as {
      data: {
        id: string;
        version: number;
        revision: number;
        has_sql: boolean;
        [key: string]: unknown;
      };
    };
    const draft = created.data;
    const runStarted = gate();
    const releaseRun = gate();
    let precheckCalls = 0;
    server.use(
      http.post("*/review-runs", async () => {
        precheckCalls += 1;
        runStarted.open();
        await releaseRun.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { run_id: crypto.randomUUID(), result_ref: "/review-runs/x" },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    const runReview = screen.getByTestId("run-review");
    fireEvent.click(runReview);

    // 运行在途（闸门未开）时按钮就必须处于pending：立即转圈+禁用，
    // 而不是呆住数秒让用户以为点击失效而重复点击。
    await runStarted.promise;
    expect(runReview).toBeDisabled();
    expect(runReview).toHaveAttribute("aria-busy", "true");
    // 窗口内的重复点击必须被吞掉：预审只允许发起一次。
    fireEvent.click(runReview);

    releaseRun.open();
    await waitFor(() => {
      expect(precheckCalls).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("run-review")).toBeEnabled();
    });
  });

  it("sends the click-time SQL from create mode and keeps text typed during the flight", async () => {
    // 创建态无草稿：预审直接送本地SQL；POST在途期间新敲入的文本保留在
    // 编辑器（不丢失、不触发任何写），但不在本次送审文本里。
    const runStarted = gate();
    const releaseRun = gate();
    const precheckBodies: Array<{ sql?: string; draft_id?: string; flow_id?: string }> = [];
    server.use(
      http.post("*/review-runs", async ({ request }) => {
        precheckBodies.push((await request.json()) as { sql?: string; draft_id?: string; flow_id?: string });
        runStarted.open();
        await releaseRun.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { run_id: crypto.randomUUID(), result_ref: "/review-runs/x" },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await runStarted.promise;
    expect(screen.getByTestId("run-review")).toBeDisabled();
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    releaseRun.open();

    await waitFor(() => {
      expect(precheckBodies).toHaveLength(1);
    });
    expect(precheckBodies[0]?.sql).toBe("UPDATE orders SET status = 1;");
    expect(precheckBodies[0]?.draft_id).toBeUndefined();
    expect(editor).toHaveValue("UPDATE orders SET status = 2;");
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: unknown[] };
    };
    expect(drafts.data.items).toHaveLength(0);
  });

  it("does not leave the editor when SQL changes while save-and-return is in flight", async () => {
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "保存并返回竞态" }),
      })
    ).json()) as {
      data: {
        id: string;
        version: number;
        revision: number;
        has_sql: boolean;
        [key: string]: unknown;
      };
    };
    const draft = created.data;
    const saveStarted = gate();
    const releaseSave = gate();
    server.use(
      http.put("*/change-drafts/:draftId/sql", async ({ request }) => {
        await request.json();
        saveStarted.open();
        await releaseSave.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            ...draft,
            state: "draft",
            version: draft.version + 1,
            revision: draft.revision + 1,
            has_sql: true,
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));

    await saveStarted.promise;
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    releaseSave.open();

    await waitFor(() => {
      expect(editor).toHaveValue("UPDATE orders SET status = 2;");
    });
    expect(screen.queryByTestId("mine-page")).not.toBeInTheDocument();
  });

  it("does not leave while metadata is saving if the editor changes again", async () => {
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "元数据保存竞态" }),
      })
    ).json()) as {
      data: {
        id: string;
        version: number;
        revision: number;
        has_sql: boolean;
        [key: string]: unknown;
      };
    };
    const draft = created.data;
    const metadataStarted = gate();
    const releaseMetadata = gate();
    server.use(
      http.patch("*/change-drafts/:draftId", async ({ request }) => {
        await request.json();
        metadataStarted.open();
        await releaseMetadata.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            ...draft,
            state: "draft",
            version: draft.version + 2,
            revision: draft.revision + 1,
            has_sql: true,
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const editor = await screen.findByTestId("sql-editor");
    await waitFor(() => {
      expect(screen.getByTestId("draft-title-input")).toHaveValue("元数据保存竞态");
    });
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));

    await metadataStarted.promise;
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    releaseMetadata.open();

    await waitFor(() => {
      expect(editor).toHaveValue("UPDATE orders SET status = 2;");
    });
    expect(screen.queryByTestId("mine-page")).not.toBeInTheDocument();
  });

  it("does not leave when metadata changes while its patch is in flight", async () => {
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "元数据 PATCH 快照" }),
      })
    ).json()) as {
      data: {
        id: string;
        version: number;
        revision: number;
        has_sql: boolean;
        [key: string]: unknown;
      };
    };
    const draft = created.data;
    const metadataStarted = gate();
    const releaseMetadata = gate();
    let patchedMetadata: { title?: string; description?: string | null } = {};
    server.use(
      http.patch("*/change-drafts/:draftId", async ({ request }) => {
        patchedMetadata = (await request.json()) as {
          title?: string;
          description?: string | null;
        };
        metadataStarted.open();
        await releaseMetadata.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            ...draft,
            state: "draft",
            version: draft.version + 1,
            revision: draft.revision + 1,
            has_sql: true,
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const title = await screen.findByTestId("draft-title-input");
    await waitFor(() => {
      expect(title).toHaveValue("元数据 PATCH 快照");
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));

    await metadataStarted.promise;
    expect(patchedMetadata.title).toBe("元数据 PATCH 快照");
    fireEvent.change(title, {
      target: { value: "PATCH 期间的新标题" },
    });
    releaseMetadata.open();

    await waitFor(() => {
      expect(title).toHaveValue("PATCH 期间的新标题");
    });
    await waitFor(() => {
      expect(screen.getByTestId("wizard-save-draft")).toBeEnabled();
    });
    expect(screen.queryByTestId("mine-page")).not.toBeInTheDocument();
  });

  it("keeps metadata edited during implicit adoption before the first draft query", async () => {
    const created = await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: FIXTURE_FLOW_ID,
          title: "adoption metadata 快照",
          description: "POST 时的说明",
        }),
      })
    ).json() as {
      data: {
        id: string;
        version: number;
        revision: number;
        title: string;
        description: string | null;
        requested_scheduled_for: string | null;
        [key: string]: unknown;
      };
    };
    const createStarted = gate();
    const releaseCreate = gate();
    let postedMetadata: {
      title?: string;
      description?: string | null;
      requested_scheduled_for?: string | null;
    } = {};
    server.use(
      http.post("*/change-drafts", async ({ request }) => {
        postedMetadata = (await request.json()) as typeof postedMetadata;
        createStarted.open();
        await releaseCreate.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: created.data,
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "adoption metadata 快照" },
    });
    fireEvent.change(screen.getByTestId("draft-description-input"), {
      target: { value: "POST 时的说明" },
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));

    await createStarted.promise;
    expect(postedMetadata.title).toBe("adoption metadata 快照");
    expect(postedMetadata.description).toBe("POST 时的说明");
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "POST 期间修改后的标题" },
    });
    fireEvent.change(screen.getByTestId("draft-description-input"), {
      target: { value: "POST 期间修改后的说明" },
    });
    fireEvent.click(screen.getByTestId("draft-requested-for"));
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const iso = `${String(tomorrow.getFullYear())}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    fireEvent.click(await screen.findByRole("button", { name: iso }));
    fireEvent.click(screen.getByTestId("draft-requested-for-time-toggle"));
    fireEvent.click(within(screen.getByTestId("dtp-hours")).getByRole("button", { name: "09" }));
    fireEvent.click(within(screen.getByTestId("dtp-minutes")).getByRole("button", { name: "30" }));
    fireEvent.click(screen.getByTestId("draft-requested-for-confirm"));
    const requestedFor = `${iso} 09:30`;
    releaseCreate.open();

    await waitFor(() => {
      expect(screen.getByTestId("draft-title-input")).toHaveValue("POST 期间修改后的标题");
    });
    expect(screen.getByTestId("draft-description-input")).toHaveValue("POST 期间修改后的说明");
    expect(screen.getByTestId("draft-requested-for")).toHaveValue(requestedFor);
    expect(screen.getByTestId("wizard-save-draft")).toBeEnabled();
    expect(screen.queryByTestId("mine-page")).not.toBeInTheDocument();
  });

  it("blocks acting actions while the adoption save is in flight (保存并返回是唯一领养方)", async () => {
    const saveStarted = gate();
    const releaseSave = gate();
    const savedBodies: string[] = [];
    server.use(
      http.put("*/change-drafts/:draftId/sql", async ({ request, params }) => {
        const body = (await request.json()) as { sql: string };
        savedBodies.push(body.sql);
        saveStarted.open();
        await releaseSave.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: String(params.draftId),
            state: "draft",
            version: 2,
            revision: 2,
            has_sql: true,
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "阻断 adoption 并发动作" },
    });
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));

    await saveStarted.promise;
    expect(screen.getByTestId("run-review")).toBeDisabled();
    expect(screen.getByTestId("wizard-save-draft")).toBeDisabled();
    expect(screen.getByTestId("open-bulk-import")).toBeDisabled();
    expect(screen.getByTestId("submit-draft")).toHaveAttribute("aria-busy", "true");

    releaseSave.open();
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
    expect(savedBodies).toEqual(["UPDATE orders SET status = 1;"]);
  });

  it("retries a failed adoption PUT against the adopted draft instead of creating another", async () => {
    let putCalls = 0;
    server.use(
      http.put("*/change-drafts/:draftId/sql", async ({ request, params }) => {
        putCalls += 1;
        if (putCalls === 1) {
          return HttpResponse.json(
            {
              err_code: 5030,
              message: "temporary save failure",
              data: null,
              request_id: FIXTURE_OWNER_ID,
            },
            { status: 500 },
          );
        }
        const body = (await request.json()) as { sql: string };
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: String(params.draftId),
            owner_user_id: FIXTURE_OWNER_ID,
            flow_id: FIXTURE_FLOW_ID,
            title: "adoption PUT 重试",
            description: null,
            requested_scheduled_for: null,
            revision: 2,
            state: "draft",
            has_sql: true,
            sql_size_bytes: body.sql.length,
            statement_count: 1,
            review_run_id: null,
            version: 2,
            created_at: "2026-08-28T08:00:00Z",
            updated_at: "2026-08-28T08:00:00Z",
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "adoption PUT 重试" },
    });
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    // 保存并返回是唯一领养方（RCP-20261101）：首次PUT失败留在页面。
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    expect(await screen.findByTestId("wizard-action-error")).toBeVisible();

    const page = screen.getByTestId("changes-new-page");
    const adoptedId = page.getAttribute("data-draft-id");
    expect(adoptedId).not.toBeNull();
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ id: string; title: string }> };
    };
    expect(drafts.data.items).toHaveLength(1);
    expect(drafts.data.items[0]).toMatchObject({
      id: adoptedId,
      title: "adoption PUT 重试",
    });

    await waitFor(() => {
      expect(screen.getByTestId("wizard-save-draft")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    await waitFor(() => {
      expect(putCalls).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
    const afterRetry = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ id: string }> };
    };
    expect(afterRetry.data.items).toHaveLength(1);
  });
});

describe("SubmissionWizard metadata completions (§18.42)", () => {
  it("serves the stage datasource metadata endpoints for the granted flow", async () => {
    // Wizard consumption needs the editor mounted with real suggestions —
    // an e2e concern; here we pin the mock contract the wizard consumes:
    // the three metadata reads answer 200 with items for the granted pair
    // and 2014 for a non-granted datasource.
    const grantedDatasource = "4f6f1a2b-0000-4000-8000-000000000002";
    const base = `/users/me/flows/${FIXTURE_FLOW_ID}/datasources/${grantedDatasource}/metadata`;
    interface MetadataPage {
      data: { items: Array<Record<string, string>> };
      err_code: number;
    }
    const schemas = (await (await fetch(`${base}/schemas`)).json()) as MetadataPage;
    expect(schemas.data.items.map((entry) => entry.name)).toContain("app");
    const tables = (await (
      await fetch(`${base}/tables?schema_name=app`)
    ).json()) as MetadataPage;
    expect(tables.data.items.map((entry) => entry.table_name)).toContain("orders");
    const columns = (await (
      await fetch(`${base}/columns?schema_name=app&table_name=orders`)
    ).json()) as MetadataPage;
    expect(columns.data.items.map((entry) => entry.column_name)).toContain("user_id");
    // A foreign datasource never becomes enumerable, even for a granted flow.
    const denied = (await (
      await fetch(
        `/users/me/flows/${FIXTURE_FLOW_ID}/datasources/99999999-0000-4000-8000-000000000009/metadata/schemas`,
      )
    ).json()) as MetadataPage;
    expect(denied.err_code).toBe(2014);
  });
});

describe("SubmissionWizard metadata catalog (§18.42 draft mode)", () => {
  it("loads stage datasource metadata while mounted in draft mode", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "元数据目录挂载" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    // Draft mode enters at step 2 with the editor mounted; the per-stage
    // metadata queries fire against the MSW handlers and merge into the
    // completion catalog (coverage: the full queryFn chain).
    const editor = await screen.findByTestId("sql-editor");
    expect(editor).toBeVisible();
    // Give the chained metadata reads (schemas → tables → columns) time to
    // settle before the test tears the tree down.
    await new Promise((resolve) => { setTimeout(resolve, 800); });
  });
});

describe("SubmissionWizard flow picker search", () => {
  it("filters flow cards by title, shows a search empty state and keeps the selection", async () => {
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();

    // Substring filter: 订单 matches only the catalog order flows.
    fireEvent.change(screen.getByTestId("wizard-flow-search"), {
      target: { value: "订单" },
    });
    const cards = screen.getAllByTestId(/^use-flow-/);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.textContent.includes("订单"))).toBe(true);

    // No match: the dedicated empty state replaces the grid.
    fireEvent.change(screen.getByTestId("wizard-flow-search"), {
      target: { value: "不存在的流程" },
    });
    expect(screen.getByTestId("wizard-flow-search-empty")).toBeVisible();

    // Clearing restores the full catalog with the selection preserved.
    fireEvent.change(screen.getByTestId("wizard-flow-search"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("wizard-flow-search"), {
      target: { value: "指标" },
    });
    fireEvent.change(screen.getByTestId("wizard-flow-search"), { target: { value: "" } });
    expect(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SubmissionWizard draft mode metadata", () => {
  it("shows the frozen flow inline and saves metadata edits in place", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "初始标题" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    // One-page layout: the frozen flow and the metadata fields share the
    // page with the editor — no step navigation to reach them.
    expect(await screen.findByTestId("sql-editor")).toBeVisible();
    expect(await screen.findByTestId("wizard-flow-frozen")).toBeVisible();
    const title = screen.getByTestId("draft-title-input");
    expect(title).toHaveValue("初始标题");

    // An empty title is rejected near-field; a real edit is persisted by
    // 保存并返回 (owner 2026-10-24: 保存信息 folded away), which then leaves
    // for the drafts list.
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    expect(screen.getByTestId("wizard-title-error")).toBeVisible();
    fireEvent.change(title, { target: { value: "改后的标题" } });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(drafts.data.items[0]?.title).toBe("改后的标题");
  });

  it("shows the saved draft title in the summary card on reopen (F-UX-001)", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "已保存标题草稿" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    // 重开草稿：摘要「标题」显示已保存标题，不是"未填写"。
    const summary = screen.getByTestId("wizard-summary");
    await waitFor(() => {
      expect(summary.textContent).toContain("已保存标题草稿");
    });
    // 仅断言标题行本身——"SQL 规模"无SQL时合法显示"未填写"。
    expect(summary.textContent).not.toContain("标题未填写");
  });

  it("keeps the summary dock blocked while no precheck exists, then leaves via 保存草稿", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "无SQL草稿" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    // The summary card is always mounted and its dock is the single
    // authority on submission readiness — no precheck result, no submit.
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).not.toBe("");

    // Editing SQL then 保存并返回: the SQL persists implicitly on the way
    // out (owner 2026-10-24: the explicit save button is gone).
    fireEvent.change(screen.getByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1 WHERE user_id = 42;" },
    });
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ has_sql: boolean }> };
    };
    expect(drafts.data.items[0]?.has_sql).toBe(true);
  });
});
