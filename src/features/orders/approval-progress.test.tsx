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
 * owner page feedback 2026-11-04（进度条口径 v2）：节点固定三个 —— 用户提交、
 * 审核、执行。提交即完成第一个节点；审核在所有审批步有结论时完成；执行在
 * 全部阶段 succeeded/skipped 时完成。填充色仍取工单当前状态族色。
 */
describe("ApprovalProgress", () => {
  it("counts submission as the first completed node (待审单读 1 / 3)", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["active", "pending"], "approval_active")], "stage_approval_active")}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("1 / 3");
  });

  it("completes the review node only when every step of every stage is decided", () => {
    render(
      <ApprovalProgress
        order={order(
          [
            stage(1, ["approved", "approved"], "succeeded"),
            // Second stage still has a live step ⇒ review not finished.
            stage(2, ["approved", "active"], "approval_active"),
          ],
          "stage_approval_active",
        )}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("1 / 3");
  });

  it("reads 2 / 3 once all approvals passed and execution waits", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved"], "execution_pending")], "stage_execution_pending")}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("2 / 3");
    const fill = screen.getByTestId("approval-progress-fill");
    expect(parseFloat(fill.style.width)).toBeCloseTo(66.67, 2);
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

  it("counts a rejected review as finished review", () => {
    // Rejected: every step decided (rejected + skipped) ⇒ submit + review done.
    render(
      <ApprovalProgress
        order={order([stage(1, ["rejected", "skipped"], "cancelled")], "rejected")}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("2 / 3");
  });

  it("counts a skipped stage as executed (finished orders read 100%)", () => {
    render(
      <ApprovalProgress
        order={order([stage(1, ["approved"], "succeeded"), stage(2, ["approved"], "skipped")], "completed")}
      />,
    );
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("3 / 3");
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

  it("renders nothing for an order without stages", () => {
    const { container } = render(<ApprovalProgress order={order([], "submitted")} />);
    expect(container).toBeEmptyDOMElement();
  });
});
