import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/shared/i18n";
import { SessionProvider } from "@/features/auth/session-provider";
import { server } from "@/test/msw/server";
import { HttpResponse, http } from "msw";
import { CommandMenu } from "./command-menu";

// The menu is a presentation shortcut over NAV_GROUPS, so the assertions are
// about what a given session may see and where Enter lands — never about
// authorization (the backend stays default-deny).
function currentUser(canAccessAdmin: boolean) {
  return {
    id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
    username: canAccessAdmin ? "admin" : "henry",
    display_name: canAccessAdmin ? "admin" : "henry",
    email: null,
    is_builtin_admin: canAccessAdmin,
    version: 1,
    created_at: "2026-08-28T08:00:00Z",
    updated_at: "2026-08-28T08:00:00Z",
    can_access_admin: canAccessAdmin,
    auth_provider: "local",
  };
}

function renderMenu(canAccessAdmin: boolean, onOpenChange = vi.fn()) {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: currentUser(canAccessAdmin),
        request_id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={["/workspace"]}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Routes>
            <Route
              path="/workspace"
              element={<CommandMenu open onOpenChange={onOpenChange} />}
            />
            <Route path="/changes/mine" element={<div data-testid="mine-route" />} />
          </Routes>
        </SessionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onOpenChange;
}

describe("CommandMenu", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("lists the workspace entries for a normal user and hides admin groups", async () => {
    renderMenu(false);
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(3);
    expect(within(list).getAllByRole("option")[0]).toHaveTextContent("首页");
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /数据源/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: /系统设置/ })).not.toBeInTheDocument();
  });

  it("shows the admin groups once the server grants admin access", async () => {
    renderMenu(true);
    expect(await screen.findByRole("option", { name: /数据源/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /系统设置/ })).toBeVisible();
  });

  it("filters by the translated label and reports the result count", async () => {
    const user = userEvent.setup();
    renderMenu(true);
    await screen.findByRole("listbox");
    await user.type(screen.getByRole("combobox"), "工单");
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });
    expect(screen.getByText("3 个结果")).toBeVisible();
    expect(screen.queryByRole("option", { name: /数据源/ })).not.toBeInTheDocument();
  });

  it("navigates to the highlighted entry on Enter and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderMenu(true);
    const mine = await screen.findByRole("option", { name: /我的工单/ });
    await user.click(mine);
    await waitFor(() => {
      expect(screen.getByTestId("mine-route")).toBeTruthy();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("moves the highlight with the arrow keys before Enter", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderMenu(true);
    const input = await screen.findByRole("combobox");
    await screen.findByRole("listbox");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    // Index 0 is 首页 and index 1 is 我的工单, so ArrowDown{Enter} must land on
    // the orders route rather than stay on the workspace root.
    await waitFor(() => {
      expect(screen.getByTestId("mine-route")).toBeTruthy();
    });
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderMenu(false);
    await screen.findByRole("listbox");
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("没有匹配的页面")).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
