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
import AdminAiBudgetPage from "@/routes/admin/admin-ai-budget-page";
import AdminIdentityProvidersPage from "@/routes/admin/admin-identity-providers-page";
import AdminNotificationsPage from "@/routes/admin/admin-notifications-page";
import WorkspaceHomePage from "@/routes/workspace/workspace-home-page";
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

describe("workspace home", () => {
  it("renders the counters, announcement and platform statistics for a granted user (§18.71)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    renderPage(<WorkspaceHomePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();
    // Row 1 — the caller's own actionable counters (/dashboard/me).
    expect(await screen.findByTestId("home-kpi-pending-approval")).toBeVisible();
    expect(screen.getByTestId("home-kpi-pending-execution")).toBeVisible();
    expect(screen.getByTestId("home-kpi-blocked-review")).toBeVisible();
    // The announcement mounts immediately and fills in once the query lands.
    await screen.findByText("季度维护窗口公告");
    expect(screen.getByTestId("home-announcement")).toHaveTextContent("季度维护窗口公告");
    // §18.71 (owner ruling 2026-10-16): platform statistics are an
    // authenticated-session surface — a non-admin session sees the same
    // operations numbers the admin home shows.
    expect(await screen.findByTestId("home-order-overview")).toBeVisible();
    expect(screen.getByTestId("home-distribution")).toBeVisible();
    // The loaded-state counterpart to the unknown-state test below. Without it
    // a "render unknown forever" regression would satisfy every unknown-state
    // assertion: the fixture is 41/47 = 87%, so the ring must announce 87% and
    // carry both the track and the progress circle.
    const loadedRing = screen.getByTestId("home-completion-ring");
    expect(loadedRing).toHaveAccessibleName("工单完成率 87%");
    expect(loadedRing.querySelectorAll("circle")).toHaveLength(2);
    // 状态分布与成功率同口径（RCP-20261023-HOME-METRICS-ALIGNMENT）：
    // 四段计数取自平台 state_distribution，合计等于窗口工单总量 47；
    // 旧实现用本人最近 20 条聚合，会得到 20。
    expect(screen.getByTestId("home-distribution")).toHaveTextContent("工单状态分布");
    // 平台窗口 47 单 = 已完成 41 + 进行中 1 + 失败 5（failed 3 + partial 2）+ 其他 0。
    const counts = ["done", "active", "failed", "other"].map((key) =>
      Number(screen.getByTestId(`home-distribution-count-${key}`).textContent),
    );
    expect(counts).toEqual([41, 1, 5, 0]);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(47);
    // §18.83（owner ruling 2026-10-23）：system-health 对全部已登录会话开放，
    // 普通用户也能拿到组件健康点（此前 admin-only，普通用户永久缺失）。
    expect(await screen.findByTestId("home-health-dots")).toBeVisible();
  });

  it("renders the zero-permission notice alongside the dashboard, never instead of it (auth PRD §11)", async () => {
    stubSession(false);
    server.use(
      http.get("*/users/me/flows", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { items: [] },
          request_id: "req-flows-empty",
        }),
      ),
    );
    renderPage(<WorkspaceHomePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();
    // The default fixture world grants nothing: the notice appears…
    expect(await screen.findByText("等待管理员配置权限")).toBeVisible();
    // …while the dashboard blocks keep rendering underneath.
    expect(await screen.findByTestId("home-kpi-pending-approval")).toBeVisible();
    expect(screen.getByTestId("home-order-overview")).toBeVisible();
  });

  it("never asserts a completion percentage it has not loaded (review L4)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    // The operations aggregate fails: the page must degrade to "not measured"
    // rather than claim 0 / 0 done. Regression guard for the round-1 finding
    // that an unresolved query rendered a confident zero with a 0% arc.
    server.use(
      http.get("*/admin/dashboard/operations", () =>
        HttpResponse.json(
          { err_code: 5000, message: "internal error", data: null, request_id: "req-ops-fail" },
          { status: 500 },
        ),
      ),
    );
    renderPage(<WorkspaceHomePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();

    // The ring announces "loading", not "0%".
    const ring = await screen.findByTestId("home-completion-ring");
    expect(ring).toHaveAccessibleName("工单完成率（加载中）");
    // An absent arc is the point: a zero-length arc would be a claim.
    expect(ring.querySelectorAll("circle")).toHaveLength(1);
    // The centre must read "— / —". If CountUp ever fell back to 0 for an
    // undefined value this would be "0 / 0" — the exact original symptom —
    // while the three assertions above stayed green.
    expect(ring.parentElement).toHaveTextContent("— / —");
    // The four breakdown columns show an em dash, not zeros that sum to 47.
    // Exact match, not substring: "—%" must not pass as "—".
    for (const key of ["done", "active", "failed", "other"]) {
      expect(screen.getByTestId(`home-distribution-count-${key}`).textContent.trim()).toBe("—");
    }
    // Copy must say "still measuring", never a count of zero orders.
    expect(await screen.findByText("正在统计执行结果…")).toBeVisible();
    expect(screen.getByText("正在加载统计窗口内的工单状态…")).toBeVisible();
  });

  it("keeps the announcement card frame when no announcement is published (RCP-20261020)", async () => {
    seedQueryScenario("query-flow");
    stubSession(false);
    server.use(
      http.get("*/announcements/current", () =>
        HttpResponse.json({ err_code: 0, message: "ok", data: null, request_id: "req-ann-null" }),
      ),
    );
    renderPage(<WorkspaceHomePage />);
    expect(await screen.findByTestId("workspace-page")).toBeVisible();
    const announcement = await screen.findByTestId("home-announcement");
    expect(announcement).toBeVisible();
    expect(await screen.findByTestId("home-announcement-empty")).toHaveTextContent(
      "当前没有已发布的公告",
    );
    expect(screen.getByTestId("home-announcement-title")).toHaveTextContent("暂无公告");
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
