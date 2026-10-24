import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/shared/i18n";
import { PageHeader, PageLayout, ListToolbar } from "./page-layout";
import { PendingButton } from "./pending-button";
import { LoadingState } from "./status/loading-state";
import { EmptyState } from "./status/empty-state";

describe("shared page presentation", () => {
  it("keeps the page heading, description and primary action accessible", () => {
    render(<PageLayout><PageHeader title="用户" description="管理用户资料" actions={<button>创建用户</button>} /></PageLayout>);
    expect(screen.getByRole("heading", { level: 1, name: "用户" })).toBeVisible();
    expect(screen.getByText("管理用户资料")).toBeVisible();
    expect(screen.getByRole("button", { name: "创建用户" })).toBeEnabled();
  });

  it("announces refresh without removing the active filters or search", () => {
    const { rerender } = render(<ListToolbar busy search={<input aria-label="搜索" defaultValue="生产" />}><button>筛选</button></ListToolbar>);
    expect(screen.getByRole("status")).toHaveAccessibleName("正在刷新");
    expect(screen.getByRole("textbox", { name: "搜索" })).toHaveValue("生产");
    rerender(<ListToolbar search={<input aria-label="搜索" defaultValue="生产" />}><button>筛选</button></ListToolbar>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选" })).toBeEnabled();
  });

  it("prevents duplicate actions while preserving button name and explicit disabled state", () => {
    const click = vi.fn();
    const { rerender } = render(<PendingButton pending onClick={click}>保存</PendingButton>);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button"));
    expect(click).not.toHaveBeenCalled();
    rerender(<PendingButton pending={false} disabled onClick={click}>保存</PendingButton>);
    expect(screen.getByRole("button")).toBeDisabled();
    rerender(<PendingButton pending={false} onClick={click}>保存</PendingButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each(["page", "panel", "table", "inline"] as const)("announces %s loading without exposing fake data", (variant) => {
    render(<LoadingState variant={variant} columns={4} label="读取工单" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("读取工单");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("provides an actionable empty or filtered result with the original test id", () => {
    const clear = vi.fn();
    render(<EmptyState title="没有匹配结果" filtered description="调整筛选条件" testId="empty-orders" action={<button onClick={clear}>清除筛选</button>} />);
    expect(screen.getByTestId("empty-orders")).toHaveAttribute("data-slot", "empty");
    expect(screen.getByText("调整筛选条件")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(clear).toHaveBeenCalledOnce();
  });
});
