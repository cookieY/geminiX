import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewRun } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import "@/shared/i18n";
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

function renderCard(phase: RunPhase, run: ReviewRun | null) {
  return render(<ReviewStatusCard phase={phase} run={run} />);
}

describe("ReviewStatusCard", () => {
  it("shows counts and stage results for a finished run", () => {
    renderCard("ready", runFixture());
    expect(screen.getByTestId("review-counts").textContent).toContain("12");
    expect(screen.getByTestId("review-counts").textContent).toContain("3");
    expect(screen.getByText("阶段 1")).toBeInTheDocument();
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
});
