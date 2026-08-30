import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import "@/shared/i18n";
import { FindingList } from "./finding-list";

/**
 * The finding list is the structured AI output surface: severity filter,
 * per-finding context (stage, category), suggestion, evidence affordance and
 * the quote-based SQL locate. Only contract fields render — the gate
 * "不展示思维链" means no reasoning channel exists at all.
 */

const EVIDENCE_ID = "4f6f1a2b-0000-4000-8000-00000000be01";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "4f6f1a2b-0000-4000-8000-00000000fi01",
    stage_position: 1,
    fingerprint_group_id: null,
    category: "performance",
    severity: "medium",
    title: "索引缺失",
    message: "语句 `UPDATE orders SET status = 1` 无法命中索引。",
    suggestion: "补充索引。",
    model_confidence: 0.9,
    evidence_ids: [EVIDENCE_ID],
    ...overrides,
  };
}

const FINDINGS = [
  finding(),
  finding({
    id: "4f6f1a2b-0000-4000-8000-00000000fi02",
    severity: "critical",
    category: "safety",
    title: "DROP TABLE",
    message: "高危操作。",
    evidence_ids: [],
  }),
];

describe("FindingList", () => {
  it("renders structured findings with severity, category and stage", () => {
    render(<FindingList findings={FINDINGS} onOpenEvidence={() => {}} />);
    expect(screen.getAllByTestId("finding-item")).toHaveLength(2);
    expect(screen.getByText("严重")).toBeInTheDocument();
    expect(screen.getAllByText("阶段 1").length).toBe(2);
  });

  it("filters by severity through the select", async () => {
    const user = userEvent.setup();
    render(<FindingList findings={FINDINGS} onOpenEvidence={() => {}} />);
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("DROP TABLE")).toBeInTheDocument();
  });

  it("shows an empty state when the filter matches nothing", async () => {
    const user = userEvent.setup();
    render(<FindingList findings={FINDINGS} onOpenEvidence={() => {}} />);
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "低" }));
    expect(screen.getByTestId("findings-empty")).toBeInTheDocument();
  });

  it("offers the evidence affordance only when evidence is bound", () => {
    render(<FindingList findings={FINDINGS} onOpenEvidence={() => {}} />);
    expect(screen.getAllByRole("button", { name: "查看审核证据" })).toHaveLength(1);
  });

  it("offers SQL locating only for findings quoting a snippet present in the editor", () => {
    const onLocate = vi.fn();
    render(
      <FindingList findings={FINDINGS} onOpenEvidence={() => {}} onLocate={onLocate} />,
    );
    const locateButtons = screen.getAllByRole("button", { name: "在SQL中定位" });
    // Only the medium finding quotes a snippet; the critical one does not.
    expect(locateButtons).toHaveLength(1);
    locateButtons[0]?.click();
    expect(onLocate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "4f6f1a2b-0000-4000-8000-00000000fi01" }),
    );
  });

  it("never renders a reasoning channel or model transcript", () => {
    render(<FindingList findings={FINDINGS} onOpenEvidence={() => {}} />);
    const text = document.body.textContent;
    expect(text).not.toMatch(/思维链|思考过程|chain of thought|reasoning_content/i);
    expect(document.querySelector("[data-testid='reasoning']")).toBeNull();
  });
});
