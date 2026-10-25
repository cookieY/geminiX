import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRun, ReviewStageResultState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import i18n from "@/shared/i18n";
import { ReviewStatusCard } from "./review-status-card";
import type { RunPhase } from "./run-state";

/**
 * The review status card renders the observable run truth: phase badge with
 * icon+text, per-stage results, statement/fingerprint counts and the known
 * failure copy. Text is i18n-only — raw state names and failure codes never
 * reach the screen (migration contract §1).
 */

function runFixture(overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
    id: "4f6f1a2b-0000-4000-8000-00000000aa01",
    draft_id: "4f6f1a2b-0000-4000-8000-00000000aa02",
    draft_revision: 1,
    state: "ready",
    statement_count: 12,
    fingerprint_group_count: 3,
    stage_results: [
      {
        stage_position: 1,
        state: "passed",
        highest_severity: "medium",
        gate_passed: true,
        finding_count: 1,
        evidence_count: 1,
        snapshot_hash: "snap-1",
        summary: "审核完成。",
        summary_locale: "zh-CN",
      },
    ],
    gate: { passed: true, reason_codes: [] },
    failure_code: null,
    version: 3,
    created_at: "2026-08-30T00:00:00Z",
    started_at: "2026-08-30T00:00:01Z",
    finished_at: "2026-08-30T00:00:02Z",
    ...overrides,
  };
}

function renderCard(
  phase: RunPhase,
  run: ReviewRun | null,
  query: {
    hasRunId?: boolean;
    isPending?: boolean;
    isError?: boolean;
    error?: unknown;
    onRetry?: () => void;
  } = {},
) {
  return render(
    <ReviewStatusCard
      phase={phase}
      run={run}
      hasRunId={query.hasRunId ?? (run !== null || phase !== "idle")}
      isPending={query.isPending ?? false}
      isError={query.isError ?? false}
      error={query.error}
      onRetry={query.onRetry}
    />,
  );
}

describe("ReviewStatusCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("shows counts and stage results for a finished run", () => {
    renderCard("ready", runFixture());
    expect(screen.getByTestId("review-counts").textContent).toContain("12");
    expect(screen.getByTestId("review-counts").textContent).toContain("3");
    expect(screen.getByRole("cell", { name: "阶段 1" })).toBeInTheDocument();
    expect(screen.getByText("通过")).toBeInTheDocument();
  });

  it("presents the queued/running phases without run data regressions", () => {
    renderCard("running", null);
    expect(screen.getByText("预审中")).toBeInTheDocument();
  });

  it("renders known failure codes as i18n copy, never the raw code", () => {
    renderCard(
      "failed",
      runFixture({
        state: "failed",
        failure_code: "provider_unavailable",
        gate: { passed: false, reason_codes: ["stage_review_failed"] },
        stage_results: [
          {
            stage_position: 1,
            state: "failed",
            highest_severity: "none",
            gate_passed: false,
            finding_count: 0,
            evidence_count: 0,
            snapshot_hash: "snap-x",
            summary: null,
            summary_locale: null,
          },
        ],
      }),
    );
    expect(screen.getByTestId("review-failure").textContent).toContain("AI服务暂不可用");
    expect(screen.queryByText("provider_unavailable")).not.toBeInTheDocument();
  });

  it("uses safe generic copy for unknown failure codes", () => {
    renderCard(
      "failed",
      runFixture({ state: "failed", failure_code: "brand_new_failure" }),
    );
    expect(screen.getByTestId("review-failure").textContent).toContain("预审失败");
    expect(screen.queryByText("brand_new_failure")).not.toBeInTheDocument();
  });

  it("explains that no run exists yet instead of fabricating one", () => {
    renderCard("idle", null);
    expect(screen.getByText(/尚未运行预审/)).toBeInTheDocument();
  });

  it("shows run loading instead of claiming that no precheck exists", () => {
    renderCard("idle", null, { hasRunId: true, isPending: true });
    expect(screen.getByTestId("review-status-loading")).toHaveTextContent("正在读取审核状态");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
  });

  it("shows a retryable run read error instead of claiming that no precheck exists", () => {
    const onRetry = vi.fn();
    renderCard("idle", null, {
      hasRunId: true,
      isError: true,
      error: new Error("review run unavailable"),
      onRetry,
    });
    expect(screen.getByTestId("review-status-error")).toHaveTextContent("请求失败");
    expect(screen.queryByText(/尚未运行预审/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the real AI identity and usage line when the run carries usage", () => {
    renderCard(
      "ready",
      runFixture({
        usage: {
          provider_name: "DeepSeek",
          model_name: "deepseek-chat",
          input_tokens: 1234,
          output_tokens: 567,
          amount_minor: 9,
          currency: "CNY",
        },
      }),
    );
    const usage = screen.getByTestId("review-usage").textContent;
    expect(usage).toContain("deepseek-chat");
    expect(usage).toContain("DeepSeek");
    expect(usage).toContain("1234");
    expect(usage).toContain("567");
  });

  it("falls back to pending copy for an unrecognized stage state", () => {
    // 生成类型联合与 STAGE_BADGE 一致，回退分支防御的是运行时漂移，
    // 因此用显式断言构造一个联合之外的状态。
    renderCard(
      "ready",
      runFixture({
        stage_results: [
          {
            stage_position: 1,
            state: "outdated" as unknown as ReviewStageResultState,
            highest_severity: "none",
            gate_passed: false,
            finding_count: 0,
            evidence_count: 0,
            snapshot_hash: "snap-o",
            summary: null,
            summary_locale: null,
          },
        ],
      }),
    );
    expect(screen.getByText("等待")).toBeInTheDocument();
  });

  it("renders budget and timeout failure copy from the known set", () => {
    const first = renderCard("failed", runFixture({ state: "failed", failure_code: "budget_exhausted" }));
    expect(screen.getByTestId("review-failure").textContent).toContain("当日AI预算已耗尽");
    first.unmount();
    renderCard("failed", runFixture({ state: "failed", failure_code: "timed_out" }));
    expect(screen.getByTestId("review-failure").textContent).toContain("预审超时");
  });

  it("shows the accepted summary verbatim while translating only its label", async () => {
    const summary = "已接受的中文审核结论。";
    renderCard(
      "ready",
      runFixture({
        stage_results: [
          {
            stage_position: 1,
            state: "passed",
            highest_severity: "none",
            gate_passed: true,
            finding_count: 0,
            evidence_count: 1,
            snapshot_hash: "snap-summary",
            summary,
            summary_locale: "zh-CN",
          },
        ] as ReviewRun["stage_results"],
      }),
    );

    expect(screen.getByText("AI 审核结论")).toBeInTheDocument();
    expect(screen.getByText(summary)).toHaveAttribute("lang", "zh-CN");

    await i18n.changeLanguage("en-US");

    expect(screen.getByText("AI review summary")).toBeInTheDocument();
    expect(screen.getByText(summary)).toHaveAttribute("lang", "zh-CN");
  });

  it("renders Chinese and English frozen summaries independently of UI language", async () => {
    const zhSummary = "中文冻结审核结论。";
    const enSummary = "English frozen review summary.";
    renderCard(
      "ready",
      runFixture({
        stage_results: [
          {
            stage_position: 1,
            state: "passed",
            highest_severity: "none",
            gate_passed: true,
            finding_count: 0,
            evidence_count: 1,
            snapshot_hash: "snap-summary-zh",
            summary: zhSummary,
            summary_locale: "zh-CN",
          },
          {
            stage_position: 2,
            state: "passed",
            highest_severity: "none",
            gate_passed: true,
            finding_count: 0,
            evidence_count: 1,
            snapshot_hash: "snap-summary-en",
            summary: enSummary,
            summary_locale: "en-US",
          },
        ],
      }),
    );

    expect(screen.getByText(zhSummary)).toHaveAttribute("lang", "zh-CN");
    expect(screen.getByText(enSummary)).toHaveAttribute("lang", "en-US");

    await i18n.changeLanguage("en-US");

    expect(screen.getByText(zhSummary)).toHaveAttribute("lang", "zh-CN");
    expect(screen.getByText(enSummary)).toHaveAttribute("lang", "en-US");
  });

  it("does not fabricate a summary for a stage that has not completed", () => {
    renderCard(
      "running",
      runFixture({
        state: "running",
        stage_results: [
          {
            stage_position: 1,
            state: "running",
            highest_severity: "none",
            gate_passed: false,
            finding_count: 0,
            evidence_count: 0,
            snapshot_hash: "snap-running",
            summary: null,
            summary_locale: null,
          },
        ] as ReviewRun["stage_results"],
      }),
    );

    expect(screen.queryByTestId("review-summary")).not.toBeInTheDocument();
  });

  it("ignores a malformed stage response with no summary property", () => {
    const malformedStage = {
      stage_position: 1,
      state: "passed",
      highest_severity: "none",
      gate_passed: true,
      finding_count: 0,
      evidence_count: 1,
      snapshot_hash: "snap-malformed",
    };
    renderCard(
      "ready",
      runFixture({
        stage_results: [malformedStage] as unknown as ReviewRun["stage_results"],
      }),
    );

    expect(screen.queryByTestId("review-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "阶段 1" })).toBeInTheDocument();
  });
});
