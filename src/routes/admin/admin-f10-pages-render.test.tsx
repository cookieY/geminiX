import { render, screen, within } from "@testing-library/react";
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
import AdminAiBudgetPage from "@/routes/admin/admin-ai-budget-page";
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
  it("renders all four constrained sections", async () => {
    stubSession(false);
    renderPage(<ProfilePage />);
    expect(await screen.findByTestId("profile-tab-identity")).toBeVisible();
    expect(screen.getByTestId("profile-tab-security")).toBeVisible();
    expect(screen.getByTestId("profile-tab-appearance")).toBeVisible();
    // §18.69：通知分栏移除（个人维度零可配置项不占位）。
    expect(screen.queryByTestId("profile-tab-notifications")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-tab-display")).toBeVisible();
    // §18.52: the security tab now renders the self-service password form
    // for local accounts (mock identities are always local).
    await userEvent.click(screen.getByTestId("profile-tab-security"));
    expect(await screen.findByTestId("profile-old-password")).toBeVisible();
    expect(screen.getByTestId("profile-new-password")).toBeVisible();
    expect(screen.getByTestId("profile-confirm-password")).toBeVisible();
    expect(screen.getByTestId("profile-change-password-submit")).toBeVisible();
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

  it("saving a high-impact toggle directly succeeds via the auto assess retry (§18.47)", async () => {
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
    const approval = await screen.findByTestId("settings-query-approval");
    expect(approval).toBeChecked();
    // The owner journey: toggle the high-impact knob and hit 保存 WITHOUT
    // the manual 评估影响 ceremony — the first PUT answers 1011 and the
    // page must run assess → retry with the fresh token by itself.
    await userEvent.click(approval);
    await userEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByTestId("settings-saved-note", {}, { timeout: 4000 })).toBeVisible();
    // The auto-generated assessment renders, so the effects are still shown.
    expect(screen.getByTestId("settings-assessment")).toBeVisible();
  });
});


describe("settings tabs (§18.47)", () => {
  it("the AI-budget page carries the shared settings tab bar", async () => {
    stubSession(true);
    renderPage(<AdminAiBudgetPage />);
    expect(await screen.findByTestId("admin-settings-ai-budget")).toBeVisible();
    // The five namespace tabs render with ai-budget active — the bar no
    // longer disappears on the standalone page.
    for (const label of ["通用", "查询", "执行", "品牌", "AI预算"]) {
      expect(screen.getByRole("tab", { name: label })).toBeVisible();
    }
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
  it("renders the announcement and platform statistics for a granted user (§18.71)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    renderPage(<WorkspacePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();
    // RCP-20261020: the announcement card mounts immediately as a
    // minimum-height placeholder, so the content itself needs a wait.
    await screen.findByText("季度维护窗口公告");
    expect(screen.getByTestId("workspace-announcement")).toHaveTextContent("季度维护窗口公告");
    // The release banner reads the backend snapshot endpoint (mock base
    // fixture): tag and excerpt render, details link points at the
    // same-origin fixture path. Default world is up-to-date (current ==
    // latest) — no "update now" tag. (The sidebar badge lives in the app
    // shell, outside this page-level mount — shell.spec covers it.)
    const banner = await screen.findByTestId("workspace-release-banner");
    expect(within(banner).getByTestId("release-tag")).toHaveTextContent("v4.1.0");
    expect(within(banner).queryByTestId("release-update-now")).toBeNull();
    // §18.71 (owner ruling 2026-10-16): platform statistics are an
    // authenticated-session surface — non-admin sessions render the same
    // operations trend + stat cards block the admin home shows.
    expect(await screen.findByTestId("workspace-admin-dashboards")).toBeVisible();
    expect(screen.getByTestId("admin-order-total")).toBeVisible();
    expect(screen.getByTestId("admin-query-total")).toBeVisible();
  });

  it("renders the trend chart and stat cards for the admin session", async () => {
    seedQueryScenario("query-flow");
    stubSession(true);
    renderPage(<WorkspacePage />);
    expect(await screen.findByTestId("workspace-admin-dashboards")).toBeVisible();
    expect(screen.getByTestId("admin-order-total")).toBeVisible();
    expect(screen.getByTestId("admin-query-total")).toBeVisible();
    // Owner ruling 2026-09-02: nothing renders below the stat-card row.
    expect(screen.queryByTestId("dashboard-draft-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-admin-quality")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-admin-health")).not.toBeInTheDocument();
  });

  it("renders minimum-height placeholders for the release banner and announcement without data (RCP-20261020)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    server.use(
      http.get("*/releases/latest", () =>
        HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: "req-release-null" }),
      ),
      http.get("*/announcements/current", () =>
        HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: "req-release-null" }),
      ),
    );
    renderPage(<WorkspacePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();
    // Owner ruling 2026-10-20: no snapshot still renders the slots — the
    // banner shows the label row with an em-dash and the unavailable hint,
    // the announcement card keeps its frame with an empty hint.
    const banner = screen.getByTestId("workspace-release-banner");
    expect(banner).toBeVisible();
    expect(within(banner).getByTestId("release-tag")).toHaveTextContent("—");
    expect(within(banner).getByTestId("release-notes-excerpt")).toHaveTextContent("暂无版本信息");
    expect(within(banner).queryByRole("link", { name: "更新内容详情" })).toBeNull();
    // The card lives inside the dashboard section, which mounts once the
    // session resolves — wait for the placeholder to appear.
    const announcement = await screen.findByTestId("workspace-announcement");
    expect(announcement).toBeVisible();
    expect(await screen.findByTestId("workspace-announcement-empty")).toHaveTextContent("暂无公告");
  });

  it("renders the green update-now tag when the installed reference differs from upstream latest (owner ruling 2026-10-20)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    server.use(
      http.get("*/releases/latest", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            tag_name: "v4.2.0",
            name: "Yearning v4.2.0",
            html_url: "/mock/github-releases/latest/v4.2.0",
            body: " newer release notes",
            published_at: "2026-10-19T08:00:00Z",
            fetched_at: "2026-10-20T00:00:00Z",
            current_version: "v4.0.0",
          },
          request_id: "req-release-mismatch",
        }),
      ),
    );
    renderPage(<WorkspacePage />);
    const banner = await screen.findByTestId("workspace-release-banner");
    // The card mounts instantly as the placeholder and release-tag exists
    // in that state too — wait for the snapshot CONTENT to arrive.
    const updateNow = await within(banner).findByTestId("release-update-now");
    expect(within(banner).getByTestId("release-tag")).toHaveTextContent("v4.2.0");
    // Green tag beside the latest tag; links to the release page in a new
    // tab. First install (current_version null) renders none — covered by
    // the placeholder test above (data:null → no banner content at all).
    expect(updateNow).toHaveTextContent("立即更新");
    expect(updateNow).toHaveAttribute("href", "/mock/github-releases/latest/v4.2.0");
    expect(updateNow).toHaveAttribute("target", "_blank");
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
