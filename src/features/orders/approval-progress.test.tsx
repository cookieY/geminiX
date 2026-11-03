import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderStage } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { ApprovalProgress } from "./approval-progress";

function stage(position: number, states: string[]): OrderStage {
  return {
    id: `stage-${String(position)}`,
    position,
    state: "approving",
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

describe("ApprovalProgress", () => {
  it("headlines approved / total across every stage", () => {
    render(<ApprovalProgress stages={[stage(1, ["approved", "approved"]), stage(2, ["active", "waiting"])]} />);
    expect(screen.getByTestId("approval-progress-figure")).toHaveTextContent("2 / 4");
  });

  it("sizes one segment per state in proportion to its step count, in step order", () => {
    render(<ApprovalProgress stages={[stage(1, ["approved", "approved", "active"]), stage(2, ["waiting"])]} />);
    const segment = (state: string): HTMLElement => screen.getByTestId(`approval-progress-segment-${state}`);
    expect(segment("approved").style.width).toBe("50%");
    expect(segment("active").style.width).toBe("25%");
    expect(segment("waiting").style.width).toBe("25%");
    const order = [...screen.getByTestId("approval-progress-bar").children].map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual([
      "approval-progress-segment-approved",
      "approval-progress-segment-active",
      "approval-progress-segment-waiting",
    ]);
  });

  it("names every state with its count in the accessible label, so colour is never alone", () => {
    render(<ApprovalProgress stages={[stage(1, ["approved", "rejected", "rejected"])]} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/approved.*1/);
    expect(label).toMatch(/rejected.*2/);
  });

  it("renders nothing for an order without approval steps", () => {
    const { container } = render(<ApprovalProgress stages={[stage(1, [])]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
