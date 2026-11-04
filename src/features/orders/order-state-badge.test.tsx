import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/shared/i18n";
import type { ChangeOrderState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { ORDER_STATE_TONE_CLASS, orderStateTone, type OrderStateTone } from "./order-state";
import { OrderStateBadge, StageStateBadge } from "./order-state-badge";

/** owner 2026-11-04（Sonner 08 落地）：状态章 = sonner-08 tone 视觉 ——
 * 图标置于着色圆（各 tone 的 /15 底）内 + 族色 12% 底/30% 描边章体。 */
const TONE_CIRCLE: Record<OrderStateTone, string> = {
  emerald: "bg-tone-emerald/15",
  teal: "bg-tone-teal/15",
  sky: "bg-tone-sky/15",
  indigo: "bg-tone-indigo/15",
  violet: "bg-tone-violet/15",
  amber: "bg-tone-amber/15",
  orange: "bg-tone-orange/15",
  waiting: "bg-tone-waiting/15",
  rose: "bg-tone-rose/15",
  red: "bg-tone-red/15",
  stone: "bg-foreground/10",
};

describe("OrderStateBadge (sonner-08 tone chip)", () => {
  it("renders the label in a tone capsule with the icon in a tinted circle", () => {
    const state = "stage_approval_active" as ChangeOrderState;
    const { container } = render(<OrderStateBadge state={state} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("rounded-full");
    expect(badge?.className).toContain(ORDER_STATE_TONE_CLASS[orderStateTone(state)]);
    expect(screen.getByText("阶段审批中")).toBeInTheDocument();
    // Sonner-08 grammar: one icon circle (aria-hidden) carrying the tone tint,
    // one icon inside, label as the only other content.
    expect(badge?.querySelectorAll("span")).toHaveLength(1);
    const circle = badge?.querySelector("span[aria-hidden='true']");
    expect(circle?.className).toContain(TONE_CIRCLE.violet);
    expect(circle?.querySelector("svg")).not.toBeNull();
  });

  it.each([
    ["completed", "emerald"],
    ["running", "indigo"],
    ["failed", "red"],
    ["withdrawn", "stone"],
  ] as const)("maps %s onto its %s tone with the circle tint", (state, tone) => {
    const { container } = render(<OrderStateBadge state={state} />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain(ORDER_STATE_TONE_CLASS[tone]);
    expect(badge?.querySelector("span[aria-hidden='true']")?.className).toContain(TONE_CIRCLE[tone]);
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("forwards extra props (data-testid) for table call sites", () => {
    render(<OrderStateBadge state="submitted" data-testid="row-state" />);
    expect(screen.getByTestId("row-state")).toHaveTextContent("已提交");
  });
});

describe("StageStateBadge keeps the same sonner-08 baseline", () => {
  it("renders the stage-state tone chip (waiting states carry the #F59145 waiting tone)", () => {
    const { container } = render(<StageStateBadge state="execution_pending" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain(ORDER_STATE_TONE_CLASS.waiting);
    expect(badge?.querySelector("span[aria-hidden='true']")?.className).toContain(TONE_CIRCLE.waiting);
    expect(screen.getByText("等待执行")).toBeInTheDocument();
  });
});
