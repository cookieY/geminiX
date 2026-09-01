import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
// jsdom cannot host the lazy Monaco chunk; the established stub swaps in a
// controlled textarea (draft-workspace test precedent).
vi.mock("@/features/review/sql-editor-panel", () => ({
  SqlEditorPanel: ({ value, onChange, ...rest }: { value: string; onChange: (sql: string) => void; readOnly?: boolean; "data-testid"?: string }) => (
    <textarea
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      readOnly={rest.readOnly === true}
      data-testid={rest["data-testid"] ?? "sql-editor-stub"}
    />
  ),
}));
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { HttpResponse, http } from "msw";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { resetQueryFixture, seedQueryScenario } from "@/shared/mock/query-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import "@/shared/i18n";
import QueryEntryPage from "@/routes/query/query-entry-page";
import QueryWorkspacePage from "@/routes/query/query-workspace-page";
import QueryAccessApprovalsPage from "@/routes/approvals/query-access-page";

/**
 * Query-domain component tests (popup-free). Gates covered: 查询仅单SELECT
 * （服务端4007就地渲染，客户端提示不替代校验）、无限总量分页（已读行数而非
 * 总数）、Grant撤销不可关闭阻断、admin无查询读面（授权撤销操作面）与查询
 * 工单统一视图的关键状态。
 */

const SESSION_USER_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

function stubSession(admin: boolean): void {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: SESSION_USER_ID,
          username: "henry",
          display_name: "henry",
          email: null,
          is_builtin_admin: admin,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: admin,
        },
        request_id: SESSION_USER_ID,
      }),
    ),
  );
}

function renderAt(path: string): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/query" element={<QueryEntryPage />} />
            <Route path="/query/sessions/:sessionId" element={<QueryWorkspacePage />} />
            <Route path="/approvals/query-access" element={<QueryAccessApprovalsPage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

beforeEach(() => {
  window.localStorage.setItem("yearning-mock-auth", "default");
  resetQueryFixture();
});

describe("gate: 查询仅单SELECT且无限总量分页", () => {
  it("renders the server's 4007 refusal inline and never blocks client-side only", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    renderAt("/query/sessions/qs-fixture-active");
    await screen.findByTestId("query-workspace");
    await userEvent.type(screen.getByTestId("query-schema-input"), "app");
    // The editor is a lazy Monaco chunk in jsdom; set the SQL through the
    // textarea the SqlEditorPanel renders as its fallback area.
    const textarea = screen.getByTestId("query-sql-editor");
    await userEvent.type(textarea, "update app.users set username = 'x'");
    await userEvent.click(screen.getByTestId("query-run"));
    expect(await screen.findByTestId("query-run-error")).toHaveTextContent("仅允许执行单条SELECT");
  });

  it("reports rows loaded from the cursor, never a fabricated total", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    renderAt("/query/sessions/qs-fixture-active");
    await screen.findByTestId("query-workspace");
    await userEvent.type(screen.getByTestId("query-schema-input"), "app");
    const textarea = screen.getByTestId("query-sql-editor");
    await userEvent.type(textarea, "select id from app.users");
    await userEvent.click(screen.getByTestId("query-run"));
    const loaded = await screen.findByTestId(/query-result-loaded-/);
    expect(loaded).toHaveTextContent("已读取 500 行");
    // No total-row display anywhere on the workspace (Q005).
    expect(screen.getByTestId("query-workspace").textContent).not.toContain("共 ");
  });

  it("marks vocabulary columns as masked in the result header", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    renderAt("/query/sessions/qs-fixture-active");
    await screen.findByTestId("query-workspace");
    await userEvent.type(screen.getByTestId("query-schema-input"), "app");
    const textarea = screen.getByTestId("query-sql-editor");
    await userEvent.type(textarea, "select id, email from app.users");
    await userEvent.click(screen.getByTestId("query-run"));
    await screen.findByTestId(/query-result-loaded-/);
    expect(await screen.findByText("已按敏感字段策略脱敏")).toBeVisible();
  });
});

describe("gate: admin撤销用户可感知且admin不能查看查询", () => {
  it("shows the non-dismissible revocation notice with the reason after the grant is revoked", async () => {
    seedQueryScenario("query-revoked");
    stubSession(false);
    renderAt("/query/sessions/qs-fixture-active");
    const notice = await screen.findByTestId("query-revoked-notice", undefined, { timeout: 8000 });
    expect(notice).toHaveTextContent("访问资格已被撤销");
    expect(notice).toHaveTextContent("least-privilege rotation");
    // The blocked workspace disables running and exits remain the only path.
    expect(screen.getByTestId("query-run")).toBeDisabled();
  });

  it("renders the reviewer revocation surface with the terminating semantics copy", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    renderAt("/approvals/query-access");
    const grantsTable = await screen.findByTestId("query-access-grants-table");
    const revoke = within(grantsTable).getByTestId(/query-access-revoke-/);
    await userEvent.click(revoke);
    const dialog = await screen.findByTestId("query-access-revoke-dialog");
    expect(dialog).toHaveTextContent("终止该授权下全部查询会话");
    // Revocation is terminating access, never reading it.
    expect(dialog.textContent).not.toContain("查看查询");
  });

  it("serves the admin identity no query objects (admin_is_not_business_override)", async () => {
    seedQueryScenario("query-session");
    stubSession(true);
    renderAt("/query");
    await screen.findByTestId("query-entry");
    await waitFor(() => {
      expect(screen.getByTestId("query-entry").textContent).not.toContain("进行中的会话");
    });
  });
});

describe("query entry mode branches (server-driven)", () => {
  it("converts QUERY_GRANT_REQUIRED into the access-request guidance", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    renderAt("/query");
    const flow = await screen.findByTestId(/query-flow-enter-/);
    await userEvent.click(flow);
    expect(await screen.findByTestId("query-needs-access-hint")).toHaveTextContent("需要访问审批");
  });

  it("opens the access-request dialog without any SQL input (Q001)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    renderAt("/query");
    await userEvent.click(await screen.findByTestId(/query-flow-apply-/));
    const dialog = await screen.findByTestId("query-access-request-dialog");
    expect(dialog).toBeInTheDocument();
    // No SQL input exists on the application form (Q001) — the reason
    // textarea is the only multiline input.
    expect(dialog.querySelectorAll("textarea")).toHaveLength(1);
    expect(dialog.textContent).toContain("不审批具体SQL");
  });
});

describe("review R1 fixes", () => {
  it("H-1: editing an OIDC provider without retyping the secret keeps it (no empty replacement)", async () => {
    const AdminIdentityProvidersPage = (
      await import("@/routes/admin/admin-identity-providers-page")
    ).default;
    const { resetAdminFixture } = await import("@/shared/mock/admin-fixture");
    resetAdminFixture();
    window.localStorage.setItem("yearning-mock-auth", "admin");
    // Seed an OIDC provider so the table carries a real OIDC row.
    const seedResponse = await fetch("/admin/identity-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_key: "corp-oidc",
        provider_kind: "oidc",
        display_name: "Corp OIDC",
        enabled: false,
        configuration: {
          issuer_url: "https://idp.corp.test",
          client_id: "yearning",
          scopes: ["openid"],
          username_claim: "preferred_username",
          display_name_claim: "name",
          email_claim: "email",
          connect_timeout_ms: 5000,
          request_timeout_ms: 10000,
        },
        client_secret: { value: "oidcsec-1" },
      }),
    });
    const seeded = (await seedResponse.json()) as { err_code: number; data: { id: string } };
    expect(seeded.err_code).toBe(0);
    stubSession(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    cleanup();
    render(
      <QueryClientProvider client={client}>
        <SessionProvider>
          <MemoryRouter>
            <AdminIdentityProvidersPage />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    );
    const oidcRow = await screen.findByTestId(`admin-idp-row-${seeded.data.id}`);
    // OIDC table rows: [edit, test, delete] — edit is first.
    const editButton = within(oidcRow).getAllByRole("button")[0];
    await userEvent.click(editButton ?? oidcRow);
    const secret = await screen.findByTestId("idp-secret");
    expect((secret as HTMLInputElement).value).toBe("");
    // Save without retyping the secret: the replace payload omits
    // client_secret (keep) and the fixture would reject {value:""} outright.
    await userEvent.click(screen.getByTestId("idp-form-submit"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // The provider survived with its secret still configured.
    const after = (await (
      await fetch(`/admin/identity-providers/${seeded.data.id}`)
    ).json()) as { err_code: number; data: { secret_configured: boolean } };
    expect(after.err_code).toBe(0);
    expect(after.data.secret_configured).toBe(true);
    expect(JSON.stringify(after.data)).not.toContain("oidcsec-1");
  });

  it("H-2: deciding a pending request removes it from the queue via cache invalidation", async () => {
    seedQueryScenario("query-approval");
    stubSession(false);
    window.localStorage.setItem("yearning-mock-auth", "default");
    renderAt("/approvals/query-access");
    const row = await screen.findByTestId("query-access-pending-qar-fixture-pending");
    await userEvent.click(within(row).getByTestId("query-access-approve-qar-fixture-pending"));
    await userEvent.click(screen.getByTestId("query-access-decision-confirm"));
    // The invalidated list re-reads: the pending row disappears without a
    // remount (the invalidation prefix matches the actor-scoped read key).
    await waitFor(
      () => {
        expect(screen.queryByTestId("query-access-pending-qar-fixture-pending")).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });
});

describe("review R2 fix L-8: export dialog reset at the component level", () => {
  it("runs a second export after closing the dialog on the same page mount", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    renderAt("/query/sessions/qs-fixture-active");
    await screen.findByTestId("query-workspace");
    await userEvent.type(screen.getByTestId("query-schema-input"), "app");

    const downloads: string[] = [];
    const downloadSpy = vi.spyOn(
      await import("@/features/query/xlsx-export"),
      "downloadXlsx",
    );
    downloadSpy.mockImplementation((_bytes, filename) => {
      downloads.push(filename);
    });

    const type = async (sql: string) => {
      const editor = screen.getByTestId("query-sql-editor");
      await userEvent.clear(editor);
      await userEvent.type(editor, sql);
    };
    await type("select id from app.users limit 1");
    await userEvent.click(screen.getByTestId("query-run"));
    await screen.findByTestId(/query-result-loaded-/);

    // First export completes and downloads.
    await userEvent.click(screen.getByTestId("query-export"));
    await screen.findByTestId("query-export-done", undefined, { timeout: 8000 });
    expect(downloads).toHaveLength(1);

    // Close, then export again on the SAME mount: the reset effect must
    // let the second run start (the R2/L-8 regression the pure-function
    // test could not lock).
    await userEvent.click(screen.getByTestId("query-export-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("query-export-dialog")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("query-export"));
    await screen.findByTestId("query-export-done", undefined, { timeout: 8000 });
    expect(downloads).toHaveLength(2);

    downloadSpy.mockRestore();
  });
});
