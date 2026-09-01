import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { HttpResponse, http } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { resetAdminFixture } from "@/shared/mock/admin-fixture";
import { resetQueryFixture, seedQueryScenario } from "@/shared/mock/query-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import "@/shared/i18n";
import AuditRecordsPage from "@/routes/records/audit-records-page";
import ProfilePage from "@/routes/profile/profile-page";
import AdminSettingsNamespacePage from "@/routes/admin/admin-settings-page";
import AdminIdentityProvidersPage from "@/routes/admin/admin-identity-providers-page";
import AdminNotificationsPage from "@/routes/admin/admin-notifications-page";
import WorkspacePage from "@/routes/workspace/workspace-page";
import { QueryOrdersTab } from "@/routes/changes/query-orders-tab";

/**
 * FE-F10 remaining surfaces (render + state coverage; popup-free). These
 * complement the gate-focused admin-f10-pages tests with the pages not yet
 * asserted: records (admin read face + non-admin empty state), profile
 * five-tab layout, the generic settings namespaces, identity providers,
 * notification channels, the workspace dashboard and the query-orders tab.
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
});

beforeEach(() => {
  window.localStorage.setItem("yearning-mock-auth", "admin");
  resetAdminFixture();
  resetQueryFixture();
});

describe("audit records page", () => {
  it("renders the admin read face with detail sheet", async () => {
    stubSession(true);
    renderPage(<AuditRecordsPage />);
    await screen.findByTestId("records-table");
    const rows = screen.getAllByTestId(/records-row-/);
    expect(rows.length).toBeGreaterThan(0);
    const firstRow = rows[0];
    if (firstRow !== undefined) await userEvent.click(firstRow);
    expect(await screen.findByTestId("records-detail")).toBeVisible();
    expect(screen.getByTestId("records-detail").textContent).toContain("auth.login");
  });

  it("shows the honest no-scope state for non-admin sessions", async () => {
    stubSession(false);
    renderPage(<AuditRecordsPage />);
    expect(await screen.findByTestId("records-no-scope")).toBeTruthy();
  });
});

describe("profile page", () => {
  it("renders all five constrained sections", async () => {
    stubSession(false);
    renderPage(<ProfilePage />);
    expect(await screen.findByTestId("profile-tab-identity")).toBeVisible();
    expect(screen.getByTestId("profile-tab-security")).toBeVisible();
    expect(screen.getByTestId("profile-tab-appearance")).toBeVisible();
    expect(screen.getByTestId("profile-tab-notifications")).toBeVisible();
    expect(screen.getByTestId("profile-tab-display")).toBeVisible();
    // The security tab states the no-self-service-password boundary.
    await userEvent.click(screen.getByTestId("profile-tab-security"));
    expect(await screen.findByText(/未声明自助改密端点/)).toBeVisible();
  });
});

describe("settings namespaces", () => {
  it("renders the query namespace without any limit fields (Q005)", async () => {
    stubSession(true);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SessionProvider>
          <MemoryRouter initialEntries={["/admin/settings/query"]}>
            <Routes>
              <Route path="/admin/settings/:namespace" element={<AdminSettingsNamespacePage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("admin-settings-query")).toBeVisible();
    const approval = await screen.findByTestId("settings-query-approval");
    expect(approval).toBeChecked();
    expect(await screen.findByTestId("settings-query-no-limit")).toBeTruthy();
    expect(screen.getByTestId("admin-settings-query").textContent).not.toContain("最大返回行数");
  });
});

describe("identity providers page", () => {
  it("shows LDAP singleton state and secret presence without echoing", async () => {
    stubSession(true);
    renderPage(<AdminIdentityProvidersPage />);
    const ldapText = (await screen.findAllByTestId(/admin-idp-row-/))
      .map((row) => row.textContent)
      .join(" ");
    expect(ldapText).toContain("ldaps");
    expect(document.body.textContent).not.toContain("ldapsec-1");
    expect(screen.getByTestId("admin-idp-create-ldap")).toBeDisabled();
  });
});

describe("notification channels page", () => {
  it("lists channels with secret presence and the Outbox deliveries", async () => {
    stubSession(true);
    renderPage(<AdminNotificationsPage />);
    await screen.findByTestId("admin-notifications-table");
    expect(screen.getByTestId("admin-notifications-table").textContent).toContain("ops-mail");
    const deliveries = await screen.findByTestId("admin-deliveries-table");
    expect(deliveries.textContent).toContain("smtp_timeout");
  });
});

describe("workspace dashboard", () => {
  it("renders metric cards and the announcement for a granted user", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    renderPage(<WorkspacePage />);
    expect(await screen.findByTestId("workspace-dashboard-cards")).toBeVisible();
    expect(screen.getByTestId("dashboard-grant-count")).toBeVisible();
    expect(await screen.findByTestId("workspace-announcement")).toHaveTextContent("季度维护窗口公告");
    // Non-admin sessions never see the administration statistics block.
    expect(screen.queryByTestId("workspace-admin-dashboards")).not.toBeInTheDocument();
  });

  it("renders the administration statistics for the admin session", async () => {
    seedQueryScenario("query-flow");
    stubSession(true);
    renderPage(<WorkspacePage />);
    expect(await screen.findByTestId("workspace-admin-dashboards")).toBeVisible();
    expect(screen.getByTestId("admin-order-total")).toBeVisible();
  });
});

describe("query orders tab", () => {
  it("shows the seeded request/grant/session rows with the revocation reason detail", async () => {
    seedQueryScenario("query-session");
    stubSession(false);
    window.localStorage.setItem("yearning-mock-auth", "default");
    renderPage(<QueryOrdersTab />);
    await screen.findByTestId("orders-query-table");
    const rows = screen.getAllByTestId(/orders-query-row-/);
    // Own access request (grant_active) + own session; the other user's
    // session is relation-scoped away server-side.
    expect(rows.length).toBe(2);
    const firstRow = rows[0];
    if (firstRow !== undefined) await userEvent.click(firstRow);
    expect(await screen.findByTestId("orders-query-detail")).toBeVisible();
    expect(screen.getByTestId("orders-query-detail").textContent).toContain("数据源冻结集合");
  });
});
