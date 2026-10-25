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
    id: "4f6f1a2b-0000-4000-8000-00000000f101",
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
    id: "4f6f1a2b-0000-4000-8000-00000000f102",
    severity: "critical",
    category: "safety",
    title: "DROP TABLE",
    message: "高危操作。",
    evidence_ids: [],
  }),
];

function ready(findings: ReviewFinding[] = FINDINGS) {
  return { status: "ready" as const, findings };
}

function incomplete(findings: ReviewFinding[] = FINDINGS) {
  return { status: "incomplete" as const, findings };
}

describe("FindingList", () => {
  it("renders structured findings with severity, category and stage", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    expect(screen.getAllByTestId("finding-item")).toHaveLength(2);
    expect(screen.getByText("严重")).toBeInTheDocument();
    expect(screen.getAllByText("阶段 1").length).toBe(2);
  });

  it("filters by severity through the select", async () => {
    const user = userEvent.setup();
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("DROP TABLE")).toBeInTheDocument();
  });

  it("shows an empty state when the filter matches nothing", async () => {
    const user = userEvent.setup();
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "低" }));
    expect(screen.getByTestId("findings-empty")).toBeInTheDocument();
  });

  it("offers the evidence affordance only when evidence is bound", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    expect(screen.getAllByRole("button", { name: "查看审核证据" })).toHaveLength(1);
  });

  it("offers SQL locating only for findings quoting a snippet present in the editor", () => {
    const onLocate = vi.fn();
    render(
      <FindingList state={ready()} onOpenEvidence={() => {}} onLocate={onLocate} />,
    );
    const locateButtons = screen.getAllByRole("button", { name: "在SQL中定位" });
    // Only the medium finding quotes a snippet; the critical one does not.
    expect(locateButtons).toHaveLength(1);
    locateButtons[0]?.click();
    expect(onLocate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "4f6f1a2b-0000-4000-8000-00000000f101" }),
    );
  });

  it("never renders a reasoning channel or model transcript", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    const text = document.body.textContent;
    expect(text).not.toMatch(/思维链|思考过程|chain of thought|reasoning_content/i);
    expect(document.querySelector("[data-testid='reasoning']")).toBeNull();
  });

  it("shows a waiting state while the review is queued or running", () => {
    render(<FindingList state={{ status: "waiting" }} onOpenEvidence={() => {}} />);

    const waiting = screen.getByTestId("findings-waiting");
    expect(waiting).toHaveAttribute("role", "status");
    expect(waiting).toHaveTextContent("AI 预审进行中");
    expect(waiting).toHaveTextContent("风险发现将在所有审核阶段完成后显示");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("shows loading until the terminal review findings request succeeds", () => {
    render(<FindingList state={{ status: "loading" }} onOpenEvidence={() => {}} />);

    const loading = screen.getByTestId("findings-loading");
    expect(loading).toHaveTextContent("正在加载风险发现");
    expect(loading.querySelector('[role="status"]')).not.toBeNull();
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("shows an actionable error instead of an empty result", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <FindingList
        state={{ status: "error", error: new Error("findings request failed") }}
        onOpenEvidence={() => {}}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId("findings-error")).toHaveTextContent("请求失败");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("only reports no risks after a successful review result", () => {
    render(<FindingList state={ready([])} onOpenEvidence={() => {}} />);

    expect(screen.getByTestId("findings-empty-all")).toHaveTextContent("本次预审未发现风险");
    expect(screen.queryByTestId("findings-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finding-item")).not.toBeInTheDocument();
  });

  it("never reports no risks when an incomplete review returns an empty list", () => {
    render(<FindingList state={incomplete([])} onOpenEvidence={() => {}} />);

    const incompleteNotice = screen.getByTestId("findings-incomplete");
    expect(incompleteNotice).toHaveAttribute("role", "alert");
    expect(incompleteNotice).toHaveTextContent("审核未完整完成");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("keeps available findings readable when the review is incomplete", () => {
    render(<FindingList state={incomplete()} onOpenEvidence={() => {}} />);

    expect(screen.getByTestId("findings-incomplete")).toHaveTextContent("审核未完整完成");
    expect(screen.getAllByTestId("finding-item")).toHaveLength(2);
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("keeps no-run and stale results distinct from an empty review", () => {
    const idle = render(
      <FindingList state={{ status: "idle" }} onOpenEvidence={() => {}} />,
    );
    expect(screen.getByTestId("findings-idle")).toHaveTextContent("尚未生成风险发现");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
    idle.unmount();

    render(<FindingList state={{ status: "stale" }} onOpenEvidence={() => {}} />);
    expect(screen.getByTestId("findings-stale")).toHaveTextContent("风险发现已失效");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });
});
