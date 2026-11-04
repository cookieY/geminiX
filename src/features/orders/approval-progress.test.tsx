import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/shared/i18n";
import type { ChangeOrder, OrderStage } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { ORDER_STATE_TONE_DOT, orderStateTone } from "./order-state";
import { ApprovalProgress } from "./approval-progress";

function stage(position: number, states: string[], stageState: string): OrderStage {
  return {
    id: `stage-${String(position)}`,
    position,
    state: stageState,
    datasource_name: "ds",
    execution_actors: [],
    approval_steps: states.map((state, index) => ({
      id: `s${String(position)}-${String(index + 1)}`,
      position: index + 1,
      state,
      decided_at: null,
      actors: [],
    })),
  } as unknown as OrderStage;
}

function order(stages: OrderStage[], state: string): ChangeOrder {
  return { state, stages } as unknown as ChangeOrder;
}

/**
 * owner 2026-11-04 进度条口径：节点 = 全部审批步骤 + 每阶段一个执行节点
 * （与阶段列表展示的节点一致）；完成率 = 已完成节点 / 全部节点；进度条为
 * 单段填充，颜色取工单当前状态的族色。
 */
describe("ApprovalProgress", () => {
  it("counts approval steps AND per-stage execution nodes in the headline figure", () => {
    render(
      <ApprovalProgress
        order={order(
          [
            // 2 approved steps + a finished execution → 3/3 done.
            stage(1, ["approved", "approved"], "succeeded"),
            // 1 active + 1 waiting steps + an execution still ahead → 0/3 done.
            stage(2, ["active", "waiting"], "approval_active"),
          ],
          "stage_approval_active",
        )}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("3 / 6");
  });

  it("fills the single bar proportionally to completed nodes", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved", "approved"], "succeeded"), stage(2, ["waiting"], "approval_active")], "stage_approval_active")}
      />,
    );
    // 3 done of 5 nodes (2 steps + 2 execution nodes + 1 waiting step).
    expect(screen.getByTestId("approval-progress-fill").style.width).toBe("60%");
  });

  it("colours the fill with the CURRENT order state tone, not per-node states", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved"], "succeeded")], "stage_execution_pending")}
      />,
    );
    const fill = screen.getByTestId("approval-progress-fill");
    expect(fill.className).toContain(ORDER_STATE_TONE_DOT[orderStateTone("stage_execution_pending")]);
  });

  it("counts a skipped execution node as complete (finished orders read 100%)", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved"], "succeeded"), stage(2, ["approved"], "skipped")], "completed")}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("4 / 4");
    expect(screen.getByTestId("approval-progress-fill").style.width).toBe("100%");
  });

  it("carries the counts and the state name in the accessible label", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved", "active"], "approval_active")], "stage_approval_active")}
      />,
    );
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/1 \/ 3/);
    expect(label).toContain("阶段审批中");
  });

  it("renders nothing for an order without stages or steps", () => {
    const { container } = render(<ApprovalProgress order={order([], "submitted")} />);
    expect(container).toBeEmptyDOMElement();
  });
});
