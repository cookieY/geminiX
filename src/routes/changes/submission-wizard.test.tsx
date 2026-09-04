import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
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

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  // The review fixture answers /users/me/flows only for the admin behavior
  // (the e2e mockSession(page, "admin") equivalent).
  setMockAuthBehavior("admin");
  grantSession();
});

describe("SubmissionWizard create mode", () => {
  it("requires a flow and a title before creating the draft", async () => {
    renderWizard("/changes/new");
    expect(await screen.findByTestId("wizard-flow-picker")).toBeVisible();

    // No flow picked: continue is blocked with the inline error.
    fireEvent.click(screen.getByTestId("wizard-continue"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("审核流程");

    // Flow picked but the title is empty: the title error replaces it.
    fireEvent.click(screen.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`));
    fireEvent.click(screen.getByTestId("wizard-continue"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("标题");

    // Title filled: continue creates the draft and moves to the SQL step.
    fireEvent.change(screen.getByTestId("draft-title-input"), {
      target: { value: "向导创建草稿" },
    });
    fireEvent.click(screen.getByTestId("wizard-continue"));
    await waitFor(() => {
      expect(screen.getByTestId("draft-workspace-page")).toBeVisible();
    });
    // The draft workspace enters at step 2 (SQL), not at the info step
    // (findBy: the fixture's draft read carries mock latency).
    expect(await screen.findByTestId("sql-editor")).toBeVisible();
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(drafts.data.items[0]?.title).toBe("向导创建草稿");
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

describe("SubmissionWizard draft mode step 1", () => {
  it("shows the frozen flow and saves metadata edits before advancing", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "初始标题" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    // Back to step 1: the frozen flow card and the prefilled metadata.
    fireEvent.click(screen.getByTestId("wizard-back"));
    expect(await screen.findByTestId("wizard-flow-frozen")).toBeVisible();
    const title = screen.getByTestId("draft-title-input");
    expect(title).toHaveValue("初始标题");

    // An empty title is rejected; a real edit is persisted on continue.
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("wizard-continue"));
    expect(screen.getByTestId("wizard-title-error")).toBeVisible();
    fireEvent.change(title, { target: { value: "改后的标题" } });
    fireEvent.click(screen.getByTestId("wizard-continue"));
    await waitFor(() => {
      expect(screen.getByTestId("sql-editor")).toBeVisible();
    });
    const drafts = (await (await fetch("/change-drafts")).json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(drafts.data.items[0]?.title).toBe("改后的标题");
  });

  it("blocks the step-2 continue until SQL exists, then advances to the confirm step", async () => {
    const create = (await (
      await fetch("/change-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "无SQL草稿" }),
      })
    ).json()) as { data: { id: string } };

    renderWizard(`/changes/drafts/${create.data.id}`);
    expect(await screen.findByTestId("sql-editor")).toBeVisible();

    fireEvent.click(screen.getByTestId("wizard-continue"));
    expect(screen.getByTestId("wizard-step-error").textContent).toContain("SQL");

    // Saving the SQL unblocks the continue; the confirm step shows the summary.
    fireEvent.change(screen.getByTestId("sql-editor"), {
      target: { value: "UPDATE orders SET status = 1 WHERE user_id = 42;" },
    });
    fireEvent.click(screen.getByTestId("save-sql"));
    await waitFor(() => {
      expect(screen.getByTestId("save-sql")).toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("wizard-continue"));
    expect(await screen.findByTestId("wizard-summary")).toBeVisible();

    // 保存草稿 leaves the wizard for the personal drafts list.
    fireEvent.click(screen.getByTestId("wizard-save-draft"));
    await waitFor(() => {
      expect(screen.getByTestId("mine-page")).toBeVisible();
    });
  });
});
