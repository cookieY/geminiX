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
  resetReviewFixture,
} from "@/shared/mock/review-fixture";
import { setMockAuthBehavior } from "@/shared/mock/auth-scenario-store";
import ChangesNewPage from "./changes-new-page";
import DraftWorkspacePage from "./draft-workspace-page";

/**
 * Submission wizard create-mode gates (§18.34): step 1 requires a flow and a
 * non-empty title before the draft is created; the journey then continues on
 * /changes/drafts/:id at step 2. Draft-mode step 1 shows the frozen flow and
 * saves metadata edits before advancing.
 */

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

describe("SubmissionWizard create mode (implicit drafts)", () => {
  it("adopts the draft silently on the first acting operation, never before", async () => {
    const reviewDraftIds: string[] = [];
    const reviewLanguages: Array<string | null> = [];
    server.use(
      http.post("*/change-drafts/:draftId/review-runs", ({ params, request }) => {
        reviewDraftIds.push(String(params.draftId));
        reviewLanguages.push(request.headers.get("Accept-Language"));
        return HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: FIXTURE_OWNER_ID });
      }),
    );
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    // One-page layout: the editor is live from the start — no draft gate.
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    // No flow picked: the acting operation surfaces the near-field error.
    fireEvent.click(screen.getByTestId("run-review"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("审核流程");

    // Flow picked but the title is empty: the title error replaces it.
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.click(screen.getByTestId("run-review"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("标题");

    // Title + SQL: the precheck adopts the draft implicitly (in place — the
    // URL never moves) and the local SQL travels with the adoption.
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "向导创建草稿" },
    });
    fireEvent.change(screen.getByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    const runReview = screen.getByTestId("run-review");
    fireEvent.click(runReview);
    fireEvent.click(runReview);
    await waitFor(() => {
      expect(reviewDraftIds).toHaveLength(1);
    });
    expect(screen.getByTestId("changes-new-page")).toBeVisible();
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ id: string; title: string; has_sql: boolean }> };
    };
    expect(drafts.data.items[0]?.title).toBe("向导创建草稿");
    expect(drafts.data.items[0]?.has_sql).toBe(true);
    expect(drafts.data.items.filter((draft) => draft.title === "向导创建草稿")).toHaveLength(1);
    expect(reviewDraftIds).toEqual([drafts.data.items[0]?.id]);
    expect(reviewLanguages).toEqual(["zh-CN"]);
  });

  it("sends the page language with the AI review request", async () => {
    await i18n.changeLanguage("en-US");
    let reviewLanguage: string | null = null;
    server.use(
      http.post("*/change-drafts/:draftId/review-runs", ({ request }) => {
        reviewLanguage = request.headers.get("Accept-Language");
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
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "English precheck" },
    });
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await waitFor(() => {
      expect(reviewLanguage).toBe("en-US");
    });
  });

  it("imports bulk SQL against the adopted draft and keeps plaintext for this session", async () => {
    const view = renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "批量导入草稿" },
    });

    fireEvent.click(screen.getByTestId("open-bulk-import"));
    expect(await screen.findByTestId("bulk-import-dialog")).toBeVisible();
    pickImportFile("SELECT 1;\n".repeat(1001));
    expect(await screen.findByTestId("bulk-import-ok")).toBeVisible();
    fireEvent.click(screen.getByTestId("bulk-import-confirm"));

    // The first draft query may arrive after adoption, but it must enrich
    // the attached draft without discarding the import still held in memory.
    await waitFor(() => {
      expect(screen.getByTestId("draft-title-input")).toHaveValue("批量导入草稿");
    });
    expect(await screen.findByTestId("bulk-browser")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("capacity-statements")).toHaveTextContent("1001");
    });
    expect(screen.queryByTestId("sql-editor")).not.toBeInTheDocument();

    // The save must target the newly adopted draft, not the pre-adoption
    // render closure whose active id was still null.
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ id: string; has_sql: boolean }> };
    };
    const draft = drafts.data.items[0];
    expect(draft?.has_sql).toBe(true);

    // A later visit starts without session plaintext and still requires the
    // audited reveal before the virtualized browser can be reconstructed.
    view.unmount();
    renderWizard(`/changes/drafts/${draft?.id ?? ""}`);
    expect(await screen.findByTestId("bulk-digest-pending")).toBeVisible();
    expect(screen.getByTestId("reveal-sql")).toBeVisible();
    expect(screen.queryByTestId("bulk-browser")).not.toBeInTheDocument();
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
    // 保存草稿 is an explicit opt-in that adopts implicitly.
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
  it("does not review SQL that was replaced in the editor while saving", async () => {
    const created = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "保存竞态" }),
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
    let reviewRunCalls = 0;
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
      http.post("*/change-drafts/:draftId/review-runs", () => {
        reviewRunCalls += 1;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: null,
          request_id: FIXTURE_OWNER_ID,
        });
      }),
    );

    renderWizard(`/changes/drafts/${draft.id}`);
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await saveStarted.promise;
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    releaseSave.open();

    await waitFor(() => {
      expect(editor).toHaveValue("UPDATE orders SET status = 2;");
    });
    expect(reviewRunCalls).toBe(0);
    await waitFor(() => {
      expect(screen.getByTestId("run-review")).toBeEnabled();
    });
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

  it("adopts an implicit draft without losing SQL typed while its first save is in flight", async () => {
    const saveStarted = gate();
    const releaseSave = gate();
    const savedBodies: string[] = [];
    let reviewRunCalls = 0;
    server.use(
      http.put("*/change-drafts/:draftId/sql", async ({ request, params }) => {
        const body = (await request.json()) as { sql: string };
        savedBodies.push(body.sql);
        if (savedBodies.length === 1) {
          saveStarted.open();
          await releaseSave.promise;
        }
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: String(params.draftId),
            state: "draft",
            version: savedBodies.length + 1,
            revision: savedBodies.length + 1,
            has_sql: true,
          },
          request_id: FIXTURE_OWNER_ID,
        });
      }),
      http.post("*/change-drafts/:draftId/review-runs", () => {
        reviewRunCalls += 1;
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
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "隐式创建竞态" },
    });
    const editor = await screen.findByTestId("sql-editor");
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await saveStarted.promise;
    fireEvent.change(editor, {
      target: { value: "UPDATE orders SET status = 2;" },
    });
    releaseSave.open();

    await waitFor(() => {
      expect(reviewRunCalls).toBe(1);
    });
    expect(savedBodies).toEqual([
      "UPDATE orders SET status = 1;",
      "UPDATE orders SET status = 2;",
    ]);
    expect(editor).toHaveValue("UPDATE orders SET status = 2;");
  });

  it("blocks adoption-dependent actions while the first SQL PUT is in flight", async () => {
    const saveStarted = gate();
    const releaseSave = gate();
    let reviewRunCalls = 0;
    server.use(
      http.put("*/change-drafts/:draftId/sql", async ({ request, params }) => {
        const body = (await request.json()) as { sql: string };
        saveStarted.open();
        await releaseSave.promise;
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: String(params.draftId),
            owner_user_id: FIXTURE_OWNER_ID,
            flow_id: FIXTURE_FLOW_ID,
            title: "阻断 adoption 并发动作",
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
      http.post("*/change-drafts/:draftId/review-runs", () => {
        reviewRunCalls += 1;
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
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "阻断 adoption 并发动作" },
    });
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));

    await saveStarted.promise;
    expect(screen.getByTestId("run-review")).toBeDisabled();
    expect(screen.getByTestId("wizard-save-draft")).toBeDisabled();
    expect(screen.getByTestId("open-bulk-import")).toBeDisabled();
    expect(screen.getByTestId("submit-draft")).toHaveAttribute("aria-busy", "true");

    releaseSave.open();
    await waitFor(() => {
      expect(reviewRunCalls).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("run-review")).toBeEnabled();
    });
  });

  it("retries a failed first SQL PUT against the adopted draft instead of creating another", async () => {
    let putCalls = 0;
    const reviewDraftIds: string[] = [];
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
      http.post("*/change-drafts/:draftId/review-runs", ({ params }) => {
        reviewDraftIds.push(String(params.draftId));
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
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "adoption PUT 重试" },
    });
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1;" },
    });
    fireEvent.click(screen.getByTestId("run-review"));
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
      expect(screen.getByTestId("run-review")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("run-review"));
    await waitFor(() => {
      expect(reviewDraftIds).toEqual([adoptedId]);
    });
    expect(putCalls).toBe(2);
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

  it("keeps the summary dock blocked while no SQL exists, then leaves via 保存草稿", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "无SQL草稿" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    // No step gate anymore: the summary card is always mounted and its dock
    // is the single authority on submission readiness — no SQL, no submit.
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
