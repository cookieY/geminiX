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
  it("renders structured findings with severity, category and stage, and the numeric distribution under the title bar", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    expect(screen.getAllByTestId("finding-item")).toHaveLength(2);
    // 严重 appears twice: the distribution row's label and the finding badge.
    expect(screen.getAllByText("严重")).toHaveLength(2);
    expect(screen.getAllByText("阶段 1").length).toBe(2);
    // Distribution row sits inside the list, all five severities with counts.
    expect(screen.getByTestId("severity-count-critical")).toHaveTextContent("1");
    expect(screen.getByTestId("severity-count-info")).toHaveTextContent("0");
  });

  it("filters by severity through the select", async () => {
    const user = userEvent.setup();
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("DROP TABLE")).toBeInTheDocument();
  });

  it("filters info findings independently", async () => {
    const user = userEvent.setup();
    render(
      <FindingList
        state={ready([
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f103",
            severity: "info",
            title: "执行提示",
            evidence_ids: [],
          }),
          finding(),
        ])}
        onOpenEvidence={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "信息" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.getByText("执行提示")).toBeInTheDocument();
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
    // RCP-20261101：staleness文案=SQL已修改（本地比对，非旧版草稿）。
    expect(screen.getByTestId("findings-stale")).toHaveTextContent("SQL已修改");
    expect(screen.queryByTestId("findings-empty-all")).not.toBeInTheDocument();
  });

  it("renders backtick spans as inline code without literal backticks", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    const code = screen.getByTestId("finding-inline-code");
    expect(code).toHaveTextContent("UPDATE orders SET status = 1");
    // The markdown backticks are a rendering convention, not user-visible text.
    const allText = screen
      .getAllByTestId("finding-item")
      .map((item) => item.textContent)
      .join("");
    expect(allText).not.toContain("`");
  });

  it("keeps the suggestion visible as a labelled block with normal contrast", () => {
    render(<FindingList state={ready()} onOpenEvidence={() => {}} />);
    const suggestions = screen.getAllByTestId("finding-suggestion");
    expect(suggestions).toHaveLength(2);
    for (const suggestion of suggestions) {
      expect(suggestion).toHaveTextContent("修改建议");
      // The block must not rely on the muted (near-disabled) foreground.
      expect(suggestion.className).not.toContain("text-muted-foreground");
    }
    expect(suggestions[0]).toHaveTextContent("补充索引。");
  });

  it("merges same-group findings into one card led by the highest severity", () => {
    const groupId = "9b0f6e21-0000-4000-8000-00000000a001";
    render(
      <FindingList
        state={ready([
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f201",
            severity: "medium",
            category: "operability",
            title: "目标表不存在，DROP TABLE 将执行失败",
            message: "当前元数据快照显示 demo.x 不存在；语句未使用 IF EXISTS。",
            suggestion: "若目的是幂等删除，可改为 DROP TABLE IF EXISTS x。",
            fingerprint_group_id: groupId,
          }),
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f202",
            severity: "critical",
            category: "correctness",
            title: "对象 x 不存在，第 1 条语句无法执行",
            message: "第 1 条语句的对象 x 要求状态为“存在”，已证明状态为“不存在”。",
            suggestion: "请先确认目标对象与语句顺序是否符合预期。",
            fingerprint_group_id: groupId,
          }),
        ])}
        onOpenEvidence={() => {}}
      />,
    );
    // One merged card, headline severity = highest of the group.
    const cards = screen.getAllByTestId("finding-item");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-severity", "critical");
    expect(screen.getByText("对象 x 不存在，第 1 条语句无法执行")).toBeInTheDocument();
    // The lower-severity finding stays fully present as a secondary sub-item:
    // its own severity, title and advice visible, message one expand away.
    const subs = screen.getAllByTestId("finding-sub-item");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toHaveAttribute("data-severity", "medium");
    expect(subs[0]).toHaveTextContent("目标表不存在，DROP TABLE 将执行失败");
    expect(subs[0]).toHaveTextContent("若目的是幂等删除，可改为 DROP TABLE IF EXISTS x。");
    expect(screen.getByTestId("finding-sub-detail")).toHaveTextContent("demo.x");
  });

  it("falls back to a flat card when the filter hides the other group member", async () => {
    const groupId = "9b0f6e21-0000-4000-8000-00000000a002";
    const user = userEvent.setup();
    render(
      <FindingList
        state={ready([
          finding({ id: "4f6f1a2b-0000-4000-8000-00000000f211", fingerprint_group_id: groupId }),
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f212",
            severity: "critical",
            fingerprint_group_id: groupId,
          }),
        ])}
        onOpenEvidence={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("筛选严重级别"));
    await user.click(await screen.findByRole("option", { name: "严重" }));
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1);
    expect(screen.queryByTestId("finding-sub-item")).not.toBeInTheDocument();
  });

  it("opens the whole group's evidence through the single card button", () => {
    const groupId = "9b0f6e21-0000-4000-8000-00000000a003";
    const onOpenEvidence = vi.fn();
    render(
      <FindingList
        state={ready([
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f221",
            severity: "critical",
            title: "对象 x 不存在，第 1 条语句无法执行",
            evidence_ids: [],
            fingerprint_group_id: groupId,
          }),
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f222",
            severity: "medium",
            title: "目标表不存在，DROP TABLE 将执行失败",
            evidence_ids: [EVIDENCE_ID],
            fingerprint_group_id: groupId,
          }),
        ])}
        onOpenEvidence={onOpenEvidence}
      />,
    );
    // 合并卡内唯一证据按钮：主项无证据但子项有时仍显示，且一次携带
    // 整组的发现清单（owner裁定2026-10-31：同组证据在一个按钮里）。
    const buttons = screen.getAllByRole("button", { name: "查看审核证据" });
    expect(buttons).toHaveLength(1);
    buttons[0]?.click();
    expect(onOpenEvidence).toHaveBeenCalledWith([
      expect.objectContaining({ id: "4f6f1a2b-0000-4000-8000-00000000f221" }),
      expect.objectContaining({ id: "4f6f1a2b-0000-4000-8000-00000000f222" }),
    ]);
    // 子项 details 内不再有自己的证据按钮。
    expect(screen.getAllByTestId("finding-sub-item")).toHaveLength(1);
  });

  it("upgrades long code spans to a copyable code block", async () => {
    const longSql = `ALTER TABLE orders ADD COLUMN backup_reason varchar(255) NOT NULL DEFAULT '' COMMENT 'manual backup justification for this change batch'`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <FindingList
        state={ready([
          finding({
            id: "4f6f1a2b-0000-4000-8000-00000000f301",
            title: "大表加列",
            message: `建议语句 \`${longSql}\` 需评估锁表。`,
            suggestion: null,
          }),
        ])}
        onOpenEvidence={() => {}}
      />,
    );
    const block = screen.getByTestId("finding-block-code");
    expect(block).toHaveTextContent(longSql);
    // Native click (same pattern as the locate test): userEvent's pointer
    // clipping check mis-fires on buttons nested in overflow-hidden cards.
    screen.getByTestId("finding-copy-code").click();
    expect(writeText).toHaveBeenCalledWith(longSql);
    // Copy feedback is announced to assistive technology.
    expect(await screen.findByText("代码已复制")).toBeInTheDocument();
  });
});
