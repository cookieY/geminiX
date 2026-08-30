import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import "@/shared/i18n";
import { SidebarProvider } from "@/shared/components/ui/sidebar";
import { YearningSidebar } from "./yearning-sidebar";
import { AppFooter, FOOTER_TEXT } from "./app-footer";
import { UserMenu } from "./user-menu";
import { PageBreadcrumb } from "./page-breadcrumb";

function renderWithShellProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/workspace"]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>,
  );
}

describe("YearningSidebar", () => {
  it("renders the workspace, audit and query groups for the placeholder user", () => {
    renderWithShellProviders(<YearningSidebar />);
    expect(screen.getByText("工作台")).toBeVisible();
    expect(screen.getByText("审计")).toBeVisible();
    // "查询" is both a group label and its single entry
    expect(screen.getAllByText("查询").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("管理")).not.toBeInTheDocument();
    expect(screen.queryByText("审核引擎")).not.toBeInTheDocument();
    expect(screen.getByText("我的工单")).toBeVisible();
  });

  it("marks the active route", () => {
    renderWithShellProviders(<YearningSidebar />);
    const active = screen.getByText("首页").closest("[data-active]");
    expect(active).not.toBeNull();
  });
});

describe("AppFooter", () => {
  it("renders the exact license line required by the migration contract", () => {
    render(<AppFooter />);
    expect(screen.getByText(FOOTER_TEXT)).toBeVisible();
    expect(FOOTER_TEXT).toBe("AGPL-3.0 Licensed | Copyright © 2017-present Henry Yee");
  });
});

describe("UserMenu", () => {
  it("opens the account sheet with identity and disabled actions that explain themselves", async () => {
    const user = userEvent.setup();
    renderWithShellProviders(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    expect(await screen.findByText("会话未接入")).toBeVisible();
    const profile = screen.getByRole("button", { name: /个人中心/ });
    expect(profile).toBeDisabled();
    const signOut = screen.getByRole("button", { name: /退出登录/ });
    expect(signOut).toBeDisabled();
  });
});

describe("PageBreadcrumb", () => {
  it("renders the page title with a home link trail", () => {
    renderWithShellProviders(<PageBreadcrumb title="首页" />);
    expect(screen.getAllByText("首页")).toHaveLength(3); // h4 title + home link + current trail entry
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/workspace");
    expect(screen.getByLabelText("面包屑")).toBeVisible();
  });
});
