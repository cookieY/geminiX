import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import { resetAdminFixture } from "@/shared/mock/admin-fixture";
import { setMockAuthBehavior } from "@/shared/mock/auth-scenario-store";
import AdminDatasourcesPage from "@/routes/admin/admin-datasources-page";
import AdminFlowsPage from "@/routes/admin/admin-flows-page";
import AdminPermissionGroupsPage from "@/routes/admin/admin-permission-groups-page";
import AdminProvidersPage from "@/routes/admin/admin-providers-page";
import AdminReviewSkillsPage from "@/routes/admin/admin-review-skills-page";
import AdminRuleSetsPage from "@/routes/admin/admin-rule-sets-page";
import AdminUsersPage from "@/routes/admin/admin-users-page";

/**
 * Table search gates (§18.37/§18.39 supplement): every admin table toolbar
 * filters its loaded rows by case-insensitive name substring and
 * distinguishes the search-empty state from the page's native empty state.
 * The filter is client-side over the current page (server-side q parameters
 * remain an RCP decision).
 */

vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function grantSession(): void {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: "0198d9cc-1111-7111-8111-000000000001",
          username: "henry",
          display_name: "henry",
          email: null,
          is_builtin_admin: true,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: true,
        },
        request_id: "x",
      }),
    ),
  );
}

function renderPage(ui: React.ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider>{ui}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function typeSearch(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
  server.resetHandlers();
  resetAdminFixture();
  setMockAuthBehavior("admin");
  grantSession();
});

describe("admin table search (§18.37)", () => {
  it("users: filters by username/display name/email with a search empty state", async () => {
    renderPage(<AdminUsersPage />);
    // Row testids carry the user id (uuid), not the username — assert on
    // visible text and row counts.
    expect(await screen.findByText("dba-anne")).toBeVisible();
    typeSearch("admin-users-search", "anne");
    await waitFor(() => {
      expect(screen.queryByText("Administrator")).toBeNull();
    });
    expect(screen.getByText("dba-anne")).toBeVisible();
    typeSearch("admin-users-search", "不存在");
    expect(await screen.findByTestId("admin-users-empty").then((node) => node.textContent)).toContain("暂无匹配结果");
    typeSearch("admin-users-search", "");
    expect(await screen.findByText("Administrator")).toBeVisible();
  });

  it("flows: filters by flow name", async () => {
    renderPage(<AdminFlowsPage />);
    expect((await screen.findAllByTestId(/admin-flow-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-flows-search", "在线只读");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^admin-flow-row-/).length).toBe(1);
    });
    typeSearch("admin-flows-search", "不存在");
    expect(await screen.findByTestId("admin-flows-empty").then((node) => node.textContent)).toContain("暂无匹配结果");
  });

  it("permission groups: filters by group name", async () => {
    renderPage(<AdminPermissionGroupsPage />);
    expect((await screen.findAllByTestId(/admin-group-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-groups-search", "变更发布组");
    expect(screen.getAllByTestId(/^admin-group-row-/).length).toBe(1);
    typeSearch("admin-groups-search", "不存在");
    expect(await screen.findByTestId("admin-groups-empty").then((node) => node.textContent)).toContain("暂无匹配结果");
  });

  it("datasources: filters by name and host", async () => {
    renderPage(<AdminDatasourcesPage />);
    expect((await screen.findAllByTestId(/ds-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-datasources-search", "订单主库");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^ds-row-/).length).toBe(1);
    });
    // Host search hits a different row set than name search.
    typeSearch("admin-datasources-search", "10.0.0.11");
    await waitFor(() => {
      expect(screen.getByText("prod-order-mysql")).toBeVisible();
    });
    typeSearch("admin-datasources-search", "不存在");
    expect(await screen.findByTestId("admin-datasources-search-empty")).toBeVisible();
  });

  it("providers: filters by name, base url and model", async () => {
    renderPage(<AdminProvidersPage />);
    expect((await screen.findAllByTestId(/provider-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-providers-search", "backup");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^provider-row-/).length).toBe(1);
    });
    typeSearch("admin-providers-search", "glm");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^provider-row-/).length).toBe(1);
    });
    typeSearch("admin-providers-search", "不存在");
    expect(await screen.findByTestId("admin-providers-search-empty")).toBeVisible();
  });

  it("rule sets: filters by rule set name", async () => {
    renderPage(<AdminRuleSetsPage />);
    expect((await screen.findAllByTestId(/rule-set-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-rule-sets-search", "change-review");
    expect(screen.getAllByTestId(/^rule-set-row-/).length).toBe(1);
    typeSearch("admin-rule-sets-search", "不存在");
    expect(await screen.findByTestId("admin-rule-sets-search-empty")).toBeVisible();
  });

  it("review skills: filters the prompt tool table", async () => {
    renderPage(<AdminReviewSkillsPage />);
    expect((await screen.findAllByTestId(/review-input-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-skills-search", "dml");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^review-input-row-/).length).toBe(1);
    });
    typeSearch("admin-skills-search", "不存在");
    expect(await screen.findByTestId("admin-skills-search-empty")).toBeVisible();
  });
});
