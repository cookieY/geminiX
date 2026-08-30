import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/shared/i18n";
import { SubmissionDock } from "./submission-dock";
import type { RunPhase } from "./run-state";

/**
 * The submission dock mirrors the backend gate (R002): Ready + passing gate
 * is the only unlock; High/Critical, partial/failed/outdated, unsaved SQL
 * and a flow template change all disable submit with an explanation. The
 * enabled button is presentation only — the backend re-validates.
 */

const READY_GATE = { passed: true, reason_codes: [] as string[] };

function renderDock(overrides: {
  draftState?: "draft" | "reviewing" | "ready" | "blocked" | "partial" | "failed" | "outdated" | "submitted" | null;
  phase?: RunPhase;
  gate?: { passed: boolean; reason_codes: string[] } | null;
  dirty?: boolean;
  flowUpdated?: boolean;
  reviewCurrent?: boolean;
} = {}) {
  return render(
    <SubmissionDock
      draftState={overrides.draftState ?? "ready"}
      phase={overrides.phase ?? "ready"}
      gate={overrides.gate ?? READY_GATE}
      dirty={overrides.dirty ?? false}
      flowUpdated={overrides.flowUpdated ?? false}
      reviewCurrent={overrides.reviewCurrent ?? true}
      submitting={false}
      onSubmit={() => {}}
    />,
  );
}

describe("SubmissionDock", () => {
  it("unlocks submit only for the clean ready state", () => {
    renderDock();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("可以提交审批");
  });

  it("disables submit while the run is active", () => {
    renderDock({ draftState: "reviewing", phase: "running", gate: null });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("disables submit on unsaved SQL changes", () => {
    renderDock({ dirty: true });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("未保存");
  });

  it("disables submit on a flow template update with the strongest banner", () => {
    renderDock({ flowUpdated: true });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("flow-updated-alert").textContent).toContain("流程模板已更新");
  });

  it("lists every gate blocker when the gate fails", () => {
    renderDock({
      gate: { passed: false, reason_codes: ["critical_severity_finding", "stage_review_blocked"] },
    });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    const blockers = screen.getByTestId("gate-blockers");
    expect(blockers.textContent).toContain("存在严重风险发现");
    expect(blockers.textContent).toContain("存在被阻断的审核阶段");
  });

  it("disables submit when the run was frozen on an older draft revision", () => {
    renderDock({ reviewCurrent: false });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("旧版本草稿");
  });

  it("never shows submit as unlocked for a submitted draft", () => {
    renderDock({ draftState: "submitted", gate: null });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });
});
