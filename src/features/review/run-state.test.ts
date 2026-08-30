import { describe, expect, it } from "vitest";
import {
  gateBlockers,
  hasReviewResult,
  isTerminalPhase,
  mergeRunPhase,
  presentPhase,
  submissionDecision,
  type RunPhase,
} from "./run-state";

describe("mergeRunPhase", () => {
  it("walks the healthy path forward", () => {
    let phase: RunPhase = "idle";
    phase = mergeRunPhase(phase, "queued");
    phase = mergeRunPhase(phase, "running");
    phase = mergeRunPhase(phase, "ready");
    expect(phase).toBe("ready");
  });

  it("a stale observation never walks the state backwards (乱序事件不回退状态)", () => {
    // An interleaved stale HTTP snapshot or a replayed event must not undo
    // the terminal phase the workspace already presented.
    expect(mergeRunPhase("ready", "running")).toBe("ready");
    expect(mergeRunPhase("blocked", "queued")).toBe("blocked");
    expect(mergeRunPhase("failed", "running")).toBe("failed");
    expect(mergeRunPhase("partial", "queued")).toBe("partial");
  });

  it("terminal phases stick against sibling terminal observations", () => {
    expect(mergeRunPhase("blocked", "partial")).toBe("blocked");
    expect(mergeRunPhase("failed", "ready")).toBe("failed");
  });

  it("outdated supersedes every phase because the reviewed inputs changed", () => {
    expect(mergeRunPhase("ready", "outdated")).toBe("outdated");
    expect(mergeRunPhase("blocked", "outdated")).toBe("outdated");
    expect(mergeRunPhase("outdated", "running")).toBe("outdated");
  });

  it("non-terminal phases progress within the active window", () => {
    expect(mergeRunPhase("queued", "running")).toBe("running");
    expect(mergeRunPhase("running", "queued")).toBe("running");
    expect(mergeRunPhase("idle", "running")).toBe("running");
  });
});

describe("isTerminalPhase", () => {
  it("classifies result phases", () => {
    expect(isTerminalPhase("ready")).toBe(true);
    expect(isTerminalPhase("blocked")).toBe(true);
    expect(isTerminalPhase("partial")).toBe(true);
    expect(isTerminalPhase("failed")).toBe(true);
    expect(isTerminalPhase("running")).toBe(false);
    expect(isTerminalPhase("outdated")).toBe(false);
  });
});

describe("gateBlockers", () => {
  it("returns no blockers for a passing gate", () => {
    expect(gateBlockers({ passed: true, reason_codes: [] })).toEqual([]);
    expect(gateBlockers(null)).toEqual([]);
  });

  it("maps every known backend reason code to its i18n key", () => {
    const blockers = gateBlockers({
      passed: false,
      reason_codes: [
        "critical_severity_finding",
        "high_severity_finding",
        "stage_review_failed",
        "stage_review_incomplete",
        "stage_review_blocked",
        "stage_review_missing",
      ],
    });
    expect(blockers.map((b) => b.messageKey)).toEqual([
      "precheck.gate.critical_severity_finding",
      "precheck.gate.high_severity_finding",
      "precheck.gate.stage_review_failed",
      "precheck.gate.stage_review_incomplete",
      "precheck.gate.stage_review_blocked",
      "precheck.gate.stage_review_missing",
    ]);
  });

  it("sends unknown reason codes to the safe generic text, never the raw code", () => {
    const blockers = gateBlockers({ passed: false, reason_codes: ["something_new"] });
    expect(blockers[0]?.messageKey).toBe("precheck.gate.unknown");
  });
});

describe("hasReviewResult", () => {
  it("is true exactly for the result-carrying draft states", () => {
    expect(hasReviewResult("ready")).toBe(true);
    expect(hasReviewResult("outdated")).toBe(true);
    expect(hasReviewResult("draft")).toBe(false);
    expect(hasReviewResult("reviewing")).toBe(false);
    expect(hasReviewResult(null)).toBe(false);
  });
});

describe("submissionDecision", () => {
  const readyGate = { passed: true, reason_codes: [] as string[] };

  it("enables submit only for a clean ready run", () => {
    const decision = submissionDecision({
      draftState: "ready",
      runPhase: "ready",
      gate: readyGate,
      dirty: false,
      flowUpdated: false,
      reviewCurrent: true,
    });
    expect(decision.submitEnabled).toBe(true);
    expect(decision.reasonKey).toBeNull();
  });

  it("blocks on every partial/failed/outdated run state", () => {
    for (const phase of ["idle", "queued", "running", "blocked", "partial", "failed", "outdated"] as const) {
      const decision = submissionDecision({
        draftState: "ready",
        runPhase: phase,
        gate: readyGate,
        dirty: false,
        flowUpdated: false,
        reviewCurrent: true,
      });
      expect(decision.submitEnabled).toBe(false);
      expect(decision.reasonKey).toMatch(/^precheck\./);
    }
  });

  it("blocks on gate blockers even when the run is ready (High/Critical无例外)", () => {
    const decision = submissionDecision({
      draftState: "ready",
      runPhase: "ready",
      gate: { passed: false, reason_codes: ["critical_severity_finding"] },
      dirty: false,
      flowUpdated: false,
      reviewCurrent: true,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.gate");
  });

  it("blocks on unsaved SQL changes because the hash can no longer match", () => {
    const decision = submissionDecision({
      draftState: "ready",
      runPhase: "ready",
      gate: readyGate,
      dirty: true,
      flowUpdated: false,
      reviewCurrent: true,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.unsaved");
  });

  it("a flow template update is the strongest blocker", () => {
    const decision = submissionDecision({
      draftState: "ready",
      runPhase: "ready",
      gate: readyGate,
      dirty: false,
      flowUpdated: true,
      reviewCurrent: true,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.flowUpdated");
    expect(decision.flowUpdated).toBe(true);
  });

  it("disables submit when the run was frozen on an older draft revision", () => {
    // Deliverable "Ready失效处理": a ready run from an older revision never
    // unlocks submission even though the phase itself reads ready.
    const decision = submissionDecision({
      draftState: "outdated",
      runPhase: "ready",
      gate: readyGate,
      dirty: false,
      flowUpdated: false,
      reviewCurrent: false,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.outdated");
  });

  it("an already submitted draft can never submit again", () => {
    const decision = submissionDecision({
      draftState: "submitted",
      runPhase: "ready",
      gate: readyGate,
      dirty: false,
      flowUpdated: false,
      reviewCurrent: true,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.submitted");
  });
});

describe("presentPhase", () => {
  it("an unsaved SQL edit voids any existing result immediately", () => {
    expect(presentPhase("ready", "ready", true)).toBe("outdated");
    expect(presentPhase("blocked", "blocked", true)).toBe("outdated");
  });

  it("without a result, dirty editing stays out of the result presentation", () => {
    expect(presentPhase("draft", "idle", true)).toBe("idle");
  });

  it("prefers the live run phase while a run is active", () => {
    expect(presentPhase("reviewing", "running", false)).toBe("running");
    expect(presentPhase("reviewing", "ready", false)).toBe("ready");
  });

  it("falls back to the server draft state when no run is in flight", () => {
    expect(presentPhase("blocked", "idle", false)).toBe("blocked");
    expect(presentPhase("outdated", "idle", false)).toBe("outdated");
    expect(presentPhase("draft", "idle", false)).toBe("idle");
    expect(presentPhase("submitted", "idle", false)).toBe("idle");
  });

  it("a server-voided draft stays outdated even with a finished ready run", () => {
    // The stale-ready presentation hole the review gate caught: outdated
    // server state must not be overridden by a terminal run phase.
    expect(presentPhase("outdated", "ready", false)).toBe("outdated");
    // A live run still presents its progress over the voided state.
    expect(presentPhase("outdated", "running", false)).toBe("running");
  });
});
