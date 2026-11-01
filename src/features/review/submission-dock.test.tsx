import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/shared/i18n";
import { SubmissionDock } from "./submission-dock";
import type { RunPhase } from "./run-state";

/**
 * The submission dock mirrors the backend gate (R002): Ready + passing gate
 * on unchanged SQL is the only unlock; High/Critical, partial/failed
 * outcomes, a post-precheck SQL edit and a flow template change all disable
 * submit with an explanation. The enabled button is presentation only — the
 * backend re-validates.
 */

const READY_GATE = { passed: true, reason_codes: [] as string[] };

function renderDock(overrides: {
  draftState?: "draft" | "submitted" | null;
  phase?: RunPhase;
  gate?: { passed: boolean; reason_codes: string[] } | null;
  sqlChangedSincePrecheck?: boolean;
  flowUpdated?: boolean;
  variant?: "dock" | "panel";
} = {}) {
  return render(
    <SubmissionDock
      draftState={overrides.draftState ?? "draft"}
      phase={overrides.phase ?? "ready"}
      gate={overrides.gate === undefined ? READY_GATE : overrides.gate}
      sqlChangedSincePrecheck={overrides.sqlChangedSincePrecheck ?? false}
      flowUpdated={overrides.flowUpdated ?? false}
      submitting={false}
      onSubmit={() => {}}
      variant={overrides.variant}
    />,
  );
}

describe("SubmissionDock", () => {
  it("unlocks submit only for the clean ready state", () => {
    renderDock();
    expect(screen.getByTestId("submit-draft")).toBeEnabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("可以提交审批");
  });

  it.each([
    ["dock", "queued"],
    ["dock", "running"],
    ["panel", "queued"],
    ["panel", "running"],
  ] as const)("shows neutral review progress instead of a gate failure on the %s dock while %s", (variant, phase) => {
    renderDock({
      phase,
      gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
      variant,
    });

    expect(screen.queryByTestId("gate-blockers")).not.toBeInTheDocument();
    const progress = screen.getByTestId("review-in-progress");
    expect(progress).toHaveAttribute("role", "status");
    expect(progress).toHaveAttribute("aria-live", "polite");
    expect(progress).toHaveTextContent("AI 预审进行中");
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("disables submit when the SQL changed since the last precheck", () => {
    renderDock({ sqlChangedSincePrecheck: true });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("SQL已修改，请重新预审");
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

  it.each(["blocked", "partial", "failed"] as const)(
    "shows the final gate explanation for a terminal %s result",
    (phase) => {
      renderDock({
        phase,
        gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
      });

      expect(screen.queryByTestId("review-in-progress")).not.toBeInTheDocument();
      expect(screen.getByTestId("gate-blockers")).toHaveTextContent("存在未完成的审核阶段");
      expect(screen.getByTestId("submit-draft")).toBeDisabled();
    },
  );

  it("hides gate reasons for a result whose SQL changed after the precheck", () => {
    renderDock({
      sqlChangedSincePrecheck: true,
      gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
    });
    expect(screen.queryByTestId("gate-blockers")).not.toBeInTheDocument();
  });

  it("fails closed when a ready run has no gate result", () => {
    renderDock({ gate: null });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
    expect(screen.getByTestId("submission-readiness").textContent).toContain("审核门禁");
  });

  it("never shows submit as unlocked for a submitted draft", () => {
    renderDock({ draftState: "submitted", gate: null });
    expect(screen.getByTestId("submit-draft")).toBeDisabled();
  });

  it("keeps the submit label and exposes progress while a submission is pending", () => {
    render(
      <SubmissionDock
        draftState="draft"
        phase="ready"
        gate={READY_GATE}
        sqlChangedSincePrecheck={false}
        flowUpdated={false}
        submitting
        onSubmit={() => {}}
      />,
    );

    const submit = screen.getByTestId("submit-draft");
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).toHaveTextContent("提交审批");
    expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull();
  });
});
