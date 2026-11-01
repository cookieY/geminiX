import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ChangeOrderState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { OrderStateBadge } from "./order-state-badge";

/**
 * badge-07/08/09 三族动效分支（owner 2026-10-31；二轮裁定：辉光取消、
 * 动效保留）。jsdom 全局把 prefers-reduced-motion 钉为开启（setup.ts），
 * 组件在测试面默认走静态扁平章——这里 stub matchMedia 关闭
 * reduced-motion，验证真实浏览器走的动效分支：族色描边与图标色、
 * 逐字入场 span、辉光层已移除；中性族保持扁平。静态扁平路径（jsdom
 * 默认 reduced=true）由全仓既有工单断言隐式覆盖（motion按window缓存
 * matchMedia 结果，两类用例不能同文件共存）。
 */
function stubMotionAllowed(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrderStateBadge animated families (badge-07/08/09, glow removed)", () => {
  it.each([
    ["completed", "border-teal-400", "text-teal-400"],
    ["stage_approval_active", "border-amber-300", "text-amber-300"],
    ["failed", "border-red-500", "text-red-500"],
  ])("%s keeps family tint, icon colour and letter stagger without glow", (state, border, icon) => {
    stubMotionAllowed();
    const { container } = render(<OrderStateBadge state={state as ChangeOrderState} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    // 二轮裁定：辉光层（radial-gradient/blur/backdrop）全部移除。
    expect(badge?.className ?? "").not.toContain("backdrop-blur");
    expect(badge?.querySelectorAll("[style*='radial-gradient']")).toHaveLength(0);
    // 族色描边与图标色保留。
    expect(badge?.className).toContain(border);
    expect(badge?.querySelector(`.${icon}`)).not.toBeNull();
    // 逐字入场：标签被拆成多个 motion span。
    expect(badge?.querySelectorAll("span").length).toBeGreaterThan(3);
  });

  it("neutral paperwork states stay flat", () => {
    stubMotionAllowed();
    const { container } = render(<OrderStateBadge state="withdrawn" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className ?? "").not.toContain("backdrop-blur");
  });
});
