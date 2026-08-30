import type {
  DraftState,
  ReviewRunState,
  SubmissionGate,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Presentation-side projection of the change-draft/review-run state machine
 * (api/contracts/state-machines.json `change_draft`, PRD F4). Pure functions
 * only — no fetching, no React. The backend stays the sole authority for
 * transitions; this module only decides what the workspace shows and which
 * client-side affordances are unlocked.
 */

export type RunPhase =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "blocked"
  | "partial"
  | "failed"
  | "outdated";

const PHASE_RANK: Record<RunPhase, number> = {
  idle: 0,
  queued: 1,
  running: 2,
  ready: 3,
  blocked: 3,
  partial: 3,
  failed: 3,
  outdated: 4,
};

const TERMINAL_PHASES: readonly RunPhase[] = ["ready", "blocked", "partial", "failed"];

export function isTerminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/**
 * Folds one observation of a run's state into the currently presented phase.
 * Domain events are strictly ordered per subject and deduplicated by the
 * event client, but HTTP snapshots can interleave stale responses with fresh
 * events, so the fold is monotonic: an out-of-order observation can never
 * walk the workspace backwards (work-package gate 乱序事件不回退状态). A
 * terminal phase sticks until superseded by `outdated`, which voids every
 * prior result because the reviewed inputs changed.
 */
export function mergeRunPhase(current: RunPhase, incoming: ReviewRunState): RunPhase {
  if (incoming === "outdated") return "outdated";
  if (isTerminalPhase(current)) return current;
  return PHASE_RANK[incoming as RunPhase] > PHASE_RANK[current]
    ? (incoming)
    : current;
}

/** The six-value gate reason vocabulary from the backend domain contract. */
const KNOWN_GATE_REASONS: Record<string, string> = {
  high_severity_finding: "precheck.gate.high_severity_finding",
  critical_severity_finding: "precheck.gate.critical_severity_finding",
  stage_review_failed: "precheck.gate.stage_review_failed",
  stage_review_incomplete: "precheck.gate.stage_review_incomplete",
  stage_review_blocked: "precheck.gate.stage_review_blocked",
  stage_review_missing: "precheck.gate.stage_review_missing",
};

export interface GateBlocker {
  code: string;
  /** i18n key under which the blocker text resolves; unknown codes use the safe generic text. */
  messageKey: string;
}

export function gateBlockers(gate: SubmissionGate | null | undefined): GateBlocker[] {
  if (!gate || gate.passed) return [];
  return gate.reason_codes.map((code) => ({
    code,
    messageKey: KNOWN_GATE_REASONS[code] ?? "precheck.gate.unknown",
  }));
}

/** Draft states that carry a review result a local SQL edit would void. */
const RESULT_STATES: readonly DraftState[] = ["ready", "blocked", "partial", "failed", "outdated"];

export function hasReviewResult(state: DraftState | null | undefined): boolean {
  return state !== null && state !== undefined && RESULT_STATES.includes(state);
}

export interface SubmissionDecision {
  submitEnabled: boolean;
  /** i18n key explaining a disabled submit; null when enabled. */
  reasonKey: string | null;
  /** Flow template changed since the run froze — the strongest blocker. */
  flowUpdated: boolean;
}

export interface SubmissionInput {
  draftState: DraftState | null;
  runPhase: RunPhase;
  gate: SubmissionGate | null;
  /** Editor text differs from the last saved SQL — hash match is impossible. */
  dirty: boolean;
  flowUpdated: boolean;
  /**
   * The presented run belongs to the current draft revision (run.draft_revision
   * === draft.revision). A ready run frozen on older inputs must never unlock
   * submission (deliverable: Ready失效处理).
   */
  reviewCurrent: boolean;
}

/**
 * Mirrors the backend submission gate (R002) for presentation only: every
 * blocked outcome, incomplete result, high/critical finding, unsaved change,
 * stale template and stale revision keeps the submit action disabled with an
 * explanation. The backend re-validates all of it inside the submission
 * transaction; the enabled button is never the safety boundary.
 */
export function submissionDecision(input: SubmissionInput): SubmissionDecision {
  if (input.flowUpdated) {
    return { submitEnabled: false, reasonKey: "precheck.blocked.flowUpdated", flowUpdated: true };
  }
  if (input.draftState === "submitted") {
    return { submitEnabled: false, reasonKey: "precheck.blocked.submitted", flowUpdated: false };
  }
  if (input.dirty) {
    return { submitEnabled: false, reasonKey: "precheck.blocked.unsaved", flowUpdated: false };
  }
  if (!input.reviewCurrent) {
    return { submitEnabled: false, reasonKey: "precheck.blocked.outdated", flowUpdated: false };
  }
  if (input.runPhase !== "ready") {
    return {
      submitEnabled: false,
      reasonKey: `precheck.phase.${input.runPhase}`,
      flowUpdated: false,
    };
  }
  const blockers = gateBlockers(input.gate);
  if (blockers.length > 0) {
    return {
      submitEnabled: false,
      reasonKey: "precheck.blocked.gate",
      flowUpdated: false,
    };
  }
  return { submitEnabled: true, reasonKey: null, flowUpdated: false };
}

/**
 * The phase the workspace should present. A local unsaved SQL edit voids any
 * prior result immediately (PRD F4: SQL变化后立即本地标记outdated), and a
 * server-side voided draft ("outdated") stays voided for its finished run —
 * only a newly active run presents a live phase over it.
 */
export function presentPhase(serverState: DraftState | null, runPhase: RunPhase, dirty: boolean): RunPhase {
  // A run in flight always presents live progress, whatever the draft state.
  if (runPhase === "queued" || runPhase === "running") return runPhase;
  if (serverState === "outdated") return "outdated";
  if (dirty && hasReviewResult(serverState)) return "outdated";
  if (runPhase !== "idle") return runPhase;
  if (serverState === null) return "idle";
  if (serverState === "draft" || serverState === "reviewing" || serverState === "submitted") {
    return "idle";
  }
  return serverState;
}
