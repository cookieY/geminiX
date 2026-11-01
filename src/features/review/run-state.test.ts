import { describe, expect, it } from "vitest";
import {
  gateBlockers,
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

describe("submissionDecision", () => {
  const readyGate = { passed: true, reason_codes: [] as string[] };

  it("enables submit only for a clean ready run on unchanged SQL", () => {
    const decision = submissionDecision({
      draftState: "draft",
      runPhase: "ready",
      gate: readyGate,
      sqlChangedSincePrecheck: false,
      flowUpdated: false,
    });
    expect(decision.submitEnabled).toBe(true);
    expect(decision.reasonKey).toBeNull();
  });

  it("blocks on every non-ready run phase (no precheck result included)", () => {
    for (const phase of ["idle", "queued", "running", "blocked", "partial", "failed", "outdated"] as const) {
      const decision = submissionDecision({
        draftState: "draft",
        runPhase: phase,
        gate: readyGate,
        sqlChangedSincePrecheck: false,
        flowUpdated: false,
      });
      expect(decision.submitEnabled).toBe(false);
      expect(decision.reasonKey).toMatch(/^precheck\./);
    }
  });

  it("blocks on gate blockers even when the run is ready (High/Critical无例外)", () => {
    const decision = submissionDecision({
      draftState: "draft",
      runPhase: "ready",
      gate: { passed: false, reason_codes: ["critical_severity_finding"] },
      sqlChangedSincePrecheck: false,
      flowUpdated: false,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.gate");
  });

  it("fails closed when a ready run has no passing gate", () => {
    for (const gate of [
      null,
      undefined,
      { passed: false, reason_codes: [] },
    ]) {
      const decision = submissionDecision({
        draftState: "draft",
        runPhase: "ready",
        gate,
        sqlChangedSincePrecheck: false,
        flowUpdated: false,
      });
      expect(decision.submitEnabled).toBe(false);
      expect(decision.reasonKey).toBe("precheck.blocked.gate");
    }
  });

  it("blocks when the editor SQL changed since the last precheck (防审A提B)", () => {
    // RCP-20261101: the server compares the submitted SQL byte-for-byte with
    // the prechecked text — a local change must force a re-precheck first.
    const decision = submissionDecision({
      draftState: "draft",
      runPhase: "ready",
      gate: readyGate,
      sqlChangedSincePrecheck: true,
      flowUpdated: false,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.outdated");
  });

  it("a flow template update is the strongest blocker", () => {
    const decision = submissionDecision({
      draftState: "draft",
      runPhase: "ready",
      gate: readyGate,
      sqlChangedSincePrecheck: false,
      flowUpdated: true,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.flowUpdated");
    expect(decision.flowUpdated).toBe(true);
  });

  it("an already submitted draft can never submit again", () => {
    const decision = submissionDecision({
      draftState: "submitted",
      runPhase: "ready",
      gate: readyGate,
      sqlChangedSincePrecheck: false,
      flowUpdated: false,
    });
    expect(decision.submitEnabled).toBe(false);
    expect(decision.reasonKey).toBe("precheck.blocked.submitted");
  });
});

describe("presentPhase", () => {
  it("an editor edit after the precheck voids the result immediately", () => {
    expect(presentPhase("ready", true, true)).toBe("outdated");
    expect(presentPhase("blocked", true, true)).toBe("outdated");
  });

  it("without a precheck result, local edits stay out of the result presentation", () => {
    expect(presentPhase("idle", true, false)).toBe("idle");
  });

  it("prefers the live run phase while a run is active", () => {
    expect(presentPhase("running", true, true)).toBe("running");
    expect(presentPhase("ready", false, true)).toBe("ready");
  });

  it("no run and no local delta presents idle", () => {
    expect(presentPhase("idle", false, false)).toBe("idle");
  });
});
