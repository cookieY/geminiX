import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { HttpResponse, delay, http } from "msw";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import { resetAdminFixture } from "@/shared/mock/admin-fixture";
import { setMockAuthBehavior } from "@/shared/mock/auth-scenario-store";
import AdminDatasourcesPage from "@/routes/admin/admin-datasources-page";
import AdminFlowsPage from "@/routes/admin/admin-flows-page";
import AdminPermissionGroupsPage from "@/routes/admin/admin-permission-groups-page";
import AdminProvidersPage from "@/routes/admin/admin-providers-page";
import AdminReviewKnowledgePage from "@/routes/admin/admin-review-knowledge-page";
import AdminReviewSkillsPage from "@/routes/admin/admin-review-skills-page";
import AdminRuleSetsPage from "@/routes/admin/admin-rule-sets-page";
import AdminUsersPage from "@/routes/admin/admin-users-page";

/**
 * Table search gates (§18.37 → §18.73): every admin table toolbar drives the
 * server-side q parameter (case-insensitive substring over the domain's
 * declared fields) and distinguishes the search-empty state from the page's
 * native empty state. The mock mirrors the ILIKE semantics; assertions await
 * the async round trip (keepPreviousData keeps the previous rows during the
 * refetch).
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

function renderPage(ui: React.ReactElement): QueryClient {
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
  return queryClient;
}

function typeSearch(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeAll(() => {
  // Base UI Select pointer-capture stubs (admin-pages precedent).
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

beforeEach(() => {
  server.resetHandlers();
  resetAdminFixture();
  setMockAuthBehavior("admin");
  grantSession();
});

describe("admin table search (§18.37)", () => {
  it("users: filters by username/display name/email and column chips, with create button in the toolbar", async () => {
    renderPage(<AdminUsersPage />);
    expect(screen.getByRole("heading", { level: 1, name: "用户" })).toBeVisible();
    const createBtn = screen.getByTestId("admin-users-create");
    expect(createBtn.closest('[data-slot="list-toolbar"]')).not.toBeNull();
    expect(createBtn.closest('[data-slot="page-actions"]')).toBeNull();
    const searchInput = screen.getByTestId("admin-users-search");
    expect(searchInput).toHaveAttribute("placeholder", "搜索用户名 / 显示名 / 邮箱（类型、状态等请用条件筛选）");
    fireEvent.focus(searchInput);
    expect(screen.getByRole("option", { name: "用户名" })).toBeVisible();
    expect(screen.getByRole("option", { name: "显示名" })).toBeVisible();
    expect(screen.getByRole("option", { name: "邮箱" })).toBeVisible();
    expect(screen.getByRole("option", { name: "类型" })).toBeVisible();
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

  it("flows: filters by flow name and exposes flow column search fields with toolbar create buttons", async () => {
    renderPage(<AdminFlowsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "流程" })).toBeVisible();
    expect(screen.getByTestId("admin-flows-create-change").closest('[data-slot="list-toolbar"]')).not.toBeNull();
    expect(screen.getByTestId("admin-flows-create-query").closest('[data-slot="list-toolbar"]')).not.toBeNull();
    const searchInput = screen.getByTestId("admin-flows-search");
    fireEvent.focus(searchInput);
    expect(screen.getByRole("option", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("option", { name: "类型" })).toBeVisible();
    expect(screen.getByRole("option", { name: "启用" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "结构" })).toBeNull();
    expect((await screen.findAllByTestId(/admin-flow-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-flows-search", "在线只读");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^admin-flow-row-/).length).toBe(1);
    });
    typeSearch("admin-flows-search", "不存在");
    expect(await screen.findByTestId("admin-flows-empty").then((node) => node.textContent)).toContain("暂无匹配结果");
  });

  it("permission groups: filters by group name and exposes group column search fields with toolbar create button", async () => {
    renderPage(<AdminPermissionGroupsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "权限组" })).toBeVisible();
    expect(screen.getByTestId("admin-groups-create").closest('[data-slot="list-toolbar"]')).not.toBeNull();
    const searchInput = screen.getByTestId("admin-groups-search");
    fireEvent.focus(searchInput);
    expect(screen.getByRole("option", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("option", { name: "启用" })).toBeVisible();
    expect(screen.getByRole("option", { name: "成员" })).toBeVisible();
    expect(screen.getByRole("option", { name: "授权流程" })).toBeVisible();
    expect((await screen.findAllByTestId(/admin-group-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-groups-search", "变更发布组");
    expect(screen.getAllByTestId(/^admin-group-row-/).length).toBe(1);
    typeSearch("admin-groups-search", "不存在");
    expect(await screen.findByTestId("admin-groups-empty").then((node) => node.textContent)).toContain("暂无匹配结果");
  });

  it("permission groups: the effective-permission preview picks a user from a Select and can cancel the selection", async () => {
    renderPage(<AdminPermissionGroupsPage />);
    const trigger = await screen.findByTestId("admin-groups-preview-input");
    expect(trigger).toHaveAttribute("data-slot", "select-trigger");
    expect(trigger.tagName).not.toBe("INPUT");
    expect(trigger).toHaveTextContent("选择用户查看有效权限");
    expect(screen.queryByTestId("admin-groups-preview-result")).toBeNull();
    expect(screen.queryByTestId("admin-groups-preview-clear")).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "dba-anne" }));
    const result = await screen.findByTestId("admin-groups-preview-result");
    expect(result).toHaveTextContent("dba-anne");
    expect(trigger).toHaveTextContent("dba-anne");
    const clearBtn = screen.getByTestId("admin-groups-preview-clear");
    expect(clearBtn).toHaveTextContent("取消");
    await userEvent.click(clearBtn);
    expect(screen.queryByTestId("admin-groups-preview-clear")).toBeNull();
    expect(screen.queryByTestId("admin-groups-preview-result")).toBeNull();
    expect(trigger).toHaveTextContent("选择用户查看有效权限");
  });

  it("typed field conditions ride the server filter params instead of client-only text (RCP-20261105)", async () => {
    // users 类型 → kind=local_user/builtin_admin：收窄发生在服务端（mock按
    // 契约只对q的文本列做模糊匹配，这两行断言只有参数过滤能做出来）。
    renderPage(<AdminUsersPage />);
    const trigger = await screen.findByTestId("admin-users-search");
    expect(await screen.findByText("Administrator")).toBeVisible();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "类型" }));
    await userEvent.click(await screen.findByRole("option", { name: "本地用户" }));
    await waitFor(() => {
      expect(screen.queryByText("Administrator")).toBeNull();
    });
    expect(screen.getByText("dba-anne")).toBeVisible();
    // 去掉条件后内置管理员行回来。
    const chip = screen.getByRole("button", { name: /移除条件 类型: 本地用户/ });
    await userEvent.click(chip);
    expect(await screen.findByText("Administrator")).toBeVisible();

    // 权限组成员 → member_user_id：同样由服务端收窄。
    renderPage(<AdminPermissionGroupsPage />);
    const groupTrigger = await screen.findByTestId("admin-groups-search");
    await userEvent.click(groupTrigger);
    await userEvent.click(await screen.findByRole("option", { name: "成员" }));
    await userEvent.click(await screen.findByRole("option", { name: "dba-anne" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^admin-group-row-/).length).toBe(1);
    });
    expect(screen.getByText("变更发布组")).toBeVisible();
  });

  it("datasources: filters by name and host and exposes datasource column search fields with toolbar create button", async () => {
    renderPage(<AdminDatasourcesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "数据源管理" })).toBeVisible();
    expect(screen.getByTestId("ds-create").closest('[data-slot="list-toolbar"]')).not.toBeNull();
    const searchInput = screen.getByTestId("admin-datasources-search");
    fireEvent.focus(searchInput);
    expect(screen.getByRole("option", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("option", { name: "引擎" })).toBeVisible();
    expect(screen.getByRole("option", { name: "端点" })).toBeVisible();
    expect(screen.getByRole("option", { name: "凭据状态" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "流程引用" })).toBeNull();
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
    expect(screen.getByRole("heading", { level: 1, name: "Provider 管理" })).toBeVisible();
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
    expect(screen.getByRole("heading", { level: 1, name: "规则集" })).toBeVisible();
    expect((await screen.findAllByTestId(/rule-set-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-rule-sets-search", "change-review");
    expect(screen.getAllByTestId(/^rule-set-row-/).length).toBe(1);
    typeSearch("admin-rule-sets-search", "不存在");
    expect(await screen.findByTestId("admin-rule-sets-search-empty")).toBeVisible();
  });

  it("review skills: filters the prompt tool table", async () => {
    renderPage(<AdminReviewSkillsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "审核技能（Prompt Tool）" })).toBeVisible();
    expect((await screen.findAllByTestId(/review-input-row-/)).length).toBeGreaterThan(0);
    typeSearch("admin-skills-search", "dml");
    await waitFor(() => {
      expect(screen.getAllByTestId(/^review-input-row-/).length).toBe(1);
    });
    typeSearch("admin-skills-search", "不存在");
    expect(await screen.findByTestId("admin-skills-search-empty")).toBeVisible();
  });

  it("knowledge: exposes one page title above the existing master-detail layout", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    expect(screen.getByRole("heading", { level: 1, name: "内部经验（知识库）" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect((await screen.findAllByTestId(/review-input-row-/))[0]).toBeInTheDocument();
  });

  it("keeps the page controls and table-shaped loading state during first load", () => {
    server.use(
      http.get("*/admin/datasources", async () => {
        await delay("infinite");
        return HttpResponse.json(null);
      }),
    );
    renderPage(<AdminDatasourcesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "数据源管理" })).toBeVisible();
    expect(screen.getByTestId("admin-datasources-search")).toBeVisible();
    expect(screen.getByRole("status", { name: "加载中" })).toHaveAttribute(
      "data-loading-variant",
      "table",
    );
  });

  it("keeps existing rows while a background refresh is announced in the toolbar", async () => {
    const queryClient = renderPage(<AdminUsersPage />);
    expect(await screen.findByText("dba-anne")).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();

    server.use(
      http.get("*/admin/users", async () => {
        await delay("infinite");
        return HttpResponse.json(null);
      }),
    );
    void queryClient.refetchQueries({ queryKey: ["admin", "users"] });

    expect(await screen.findByRole("status", { name: "正在刷新" })).toBeVisible();
    expect(screen.getByText("dba-anne")).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();
    expect(screen.queryByRole("status", { name: "加载中" })).not.toBeInTheDocument();
  });
});
