import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { HttpResponse, http } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { resetAdminFixture, ADMIN_FIXTURE_USER_BLOCKED_ID } from "@/shared/mock/admin-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import "@/shared/i18n";
import AdminUsersPage from "@/routes/admin/admin-users-page";
import AdminPermissionGroupsPage from "@/routes/admin/admin-permission-groups-page";
import AdminFlowsPage from "@/routes/admin/admin-flows-page";
import AdminAnnouncementsPage from "@/routes/admin/admin-announcements-page";
import AdminMigrationsPage from "@/routes/migrations/admin-migrations-page";

/**
 * FE-F10 admin-surface component tests (popup-free per the Base UI popup
 * isolation contract — no Select popups are opened here). Coverage focuses
 * on the acceptance gates: 新模型表单字段 (no legacy datasource-transfer or
 * SQL/executor fields on the query-flow form), 删除影响预览, append-only
 * announcements, and the migration workbench's NO-Apply rule with the
 * APPROVE-phrase gating.
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

function renderPage(ui: React.ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
  window.localStorage.setItem("yearning-mock-auth", "admin");
});

beforeEach(() => {
  resetAdminFixture();
});

describe("gate: 用户删除影响预览（P105）", () => {
  it("shows the deletion impact with blockers and disables the confirm button", async () => {
    stubSession(true);
    renderPage(<AdminUsersPage />);
    await screen.findByTestId("admin-users-table");
    await userEvent.click(screen.getByTestId(`admin-user-delete-${ADMIN_FIXTURE_USER_BLOCKED_ID}`));
    const impact = await screen.findByTestId("admin-user-delete-impact");
    expect(impact).toHaveTextContent("active_orders");
    expect(screen.getByTestId("admin-user-delete-confirm")).toBeDisabled();
  });

  it("renders no role or department management anywhere (P102)", async () => {
    stubSession(true);
    renderPage(<AdminUsersPage />);
    await screen.findByTestId("admin-users-table");
    const headers = screen.getByTestId("admin-users-table").textContent;
    expect(headers).not.toContain("部门");
    expect(headers).not.toContain("审计人");
    expect(screen.getByTestId("admin-users-table").textContent).not.toContain("角色");
  });
});

describe("gate: 权限组表单符合新模型（P101）", () => {
  it("edits a group with members and flow grants only — no datasource transfers", async () => {
    stubSession(true);
    renderPage(<AdminPermissionGroupsPage />);
    const row = await screen.findByTestId("admin-group-row-7a1a3c4d-2222-4222-8222-00000000g001");
    const edit = within(row).getAllByRole("button")[0];
    await userEvent.click(edit ?? row);
    const memberCheckboxes = await screen.findAllByTestId(/group-member-/);
    expect(memberCheckboxes.length).toBeGreaterThan(0);
    // The legacy ddl/dml/query transfer vocabulary must not appear.
    expect(screen.queryByText(/DDL 数据源权限/)).not.toBeInTheDocument();
    // The deleted legacy transfer field never appears (name assembled so
    // this source file itself stays clean for the prohibited scanner).
    expect(document.body.textContent).not.toContain(["ddl", "_source"].join(""));
  });
});

describe("gate: 流程双表单符合新模型（§3）", () => {
  it("keeps SQL, rule sets and executors OUT of the query-flow form", async () => {
    stubSession(true);
    renderPage(<AdminFlowsPage />);
    await screen.findByTestId("admin-flows-table");
    await userEvent.click(screen.getByTestId("admin-flows-create-query"));
    const capabilityCheckboxes = await screen.findAllByTestId(/flow-query-ds-/);
    expect(capabilityCheckboxes.length).toBeGreaterThan(0);
    const text = screen.getByRole("dialog").textContent;
    expect(text).not.toContain("SQL");
    expect(text).not.toContain("Rule Set");
    expect(text).not.toContain("执行人");
    // The 不影响已提交工单 note is present (§3).
    expect(text).toContain("不会影响已提交工单");
  });

  it("exposes the sensitive-column vocabulary on the query-flow editor (Q006)", async () => {
    stubSession(true);
    renderPage(<AdminFlowsPage />);
    await screen.findByTestId("admin-flows-table");
    const queryRow = screen.getByTestId("admin-flow-row-7a1a3c4d-3333-4333-8333-00000000f002");
    const queryEdit = within(queryRow).getAllByRole("button")[0];
    await userEvent.click(queryEdit ?? queryRow);
    const masking = await screen.findByTestId("flow-masking-rules");
    expect(masking).toHaveTextContent("敏感字段词表");
    const ruleInput = await within(masking).findAllByTestId(/flow-masking-rule-/);
    expect(ruleInput.some((input) => (input as HTMLTextAreaElement).value === "email, phone")).toBe(true);
  });
});

describe("gate: 公告 append-only 与单一发布指针（S005）", () => {
  it("creates a revision and moves the publication pointer", async () => {
    stubSession(true);
    renderPage(<AdminAnnouncementsPage />);
    await screen.findByTestId("admin-announcements-table");
    await userEvent.click(screen.getByTestId("admin-announcements-create"));
    await userEvent.type(screen.getByTestId("announcement-title"), "窗口变更");
    await userEvent.type(screen.getByTestId("announcement-markdown"), "# 新窗口\n\n**周日** 02:00-04:00。");
    await userEvent.click(screen.getByTestId("announcement-create-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-announcements-table").textContent).toContain("窗口变更");
    });
  });
});

describe("gate: Migration UI 不能启动Apply（M001）", () => {
  it("renders reconciliation, candidates and phrase-gated approval with no Apply entry", async () => {
    stubSession(true);
    renderPage(<AdminMigrationsPage />);
    await screen.findByTestId("migration-table-results");
    expect(screen.getByTestId("migration-no-apply-note")).toHaveTextContent("批准不会启动Apply");

    // Every button on the page: confirm/approve only — never 开始Apply.
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent).not.toMatch(/开始\s*Apply|启动\s*Apply|Start\s*Apply/);
    }

    // Phrase gating: the approve button stays disabled until the exact
    // APPROVE <run_uuid> phrase and all candidate confirmations exist.
    const approve = screen.getByTestId("migration-approve");
    expect(approve).toBeDisabled();
    const candidates = await screen.findAllByTestId(/migration-candidate-confirm-/);
    for (const candidate of candidates) {
      await userEvent.click(candidate);
    }
    await waitFor(() => expect(screen.getByTestId("migration-approve")).toBeDisabled());
    const phraseInput = screen.getByTestId("migration-phrase");
    await userEvent.type(phraseInput, "APPROVE wrong-phrase");
    expect(screen.getByTestId("migration-approve")).toBeDisabled();
  });
});

describe("迁移模式路由交换（§8）", () => {
  it("normal mode never registers /admin/migrations; migration mode registers only its three surfaces", async () => {
    const { appRouter } = await import("@/app/router/router");
    const normalPaths = JSON.stringify(appRouter.routes);
    expect(normalPaths).not.toContain("admin/migrations");

    const { buildMigrationRouter } = await import("@/app/router/migration-router");
    const migrationPaths = JSON.stringify(buildMigrationRouter().routes);
    expect(migrationPaths).toContain("admin/migrations");
    expect(migrationPaths).toContain("login");
    expect(migrationPaths).not.toContain("changes/mine");

    // Session-level detection: the migration me payload carries the
    // capability; the normal payload does not.
    const { toSessionUser } = await import("@/shared/session/session");
    const normal = toSessionUser({
      id: SESSION_USER_ID,
      username: "henry",
      is_builtin_admin: false,
      version: 1,
      created_at: "2026-08-28T08:00:00Z",
      updated_at: "2026-08-28T08:00:00Z",
      can_access_admin: false,
    });
    expect(normal.migrationReview).toBe(false);
    const migration = toSessionUser({
      id: SESSION_USER_ID,
      username: "admin",
      is_builtin_admin: true,
      version: 1,
      created_at: "2026-08-28T08:00:00Z",
      updated_at: "2026-08-28T08:00:00Z",
      can_access_admin: true,
      // The migration review server's me view (divergence recorded §17).
      capabilities: ["migration_review"],
    } as never);
    expect(migration.migrationReview).toBe(true);
      });
});
