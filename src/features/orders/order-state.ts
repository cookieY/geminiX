import type {
  ChangeOrder,
  ChangeOrderState,
  StageState,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { stageApprovalSteps } from "@/features/orders/approval-steps";

/**
 * Order state semantics mirrored from api/contracts/state-machines.json
 * (change_order machine) — the frontend presentation layer of the backend's
 * authoritative transitions. Withdraw/void affordances and the
 * partial-execution warning are derived here so the UI can never offer an
 * action the state machine forbids (work-package gate: 未Ready正常UI不能提交
 * and 部分执行后撤回明确提示不可回滚).
 */

/** States from which the submitter's withdraw action is legal. */
const WITHDRAWABLE_STATES: readonly ChangeOrderState[] = [
  "submitted",
  "stage_approval_active",
  "stage_execution_pending",
  "scheduled",
  "blocked_datasource_unavailable",
];

/** Withdraw from a running/unknown-result order is a partial-execution
 * withdrawal: prior stage effects stay and nothing rolls back (W007). */
const WITHDRAW_PARTIAL_STATES: readonly ChangeOrderState[] = ["running", "result_unknown"];

/** States from which the submitter's void action is legal. */
const VOIDABLE_STATES: readonly ChangeOrderState[] = [
  "submitted",
  "stage_approval_active",
  "stage_execution_pending",
  "scheduled",
  "blocked_datasource_unavailable",
  "result_unknown",
  "invalid",
];

export type WithdrawOutcome = "withdrawn" | "withdrawn_after_partial_execution";

/** The withdrawal result the state machine would produce, or null when the
 * action is not offered for this state. */
export function withdrawOutcome(state: ChangeOrderState | null | undefined): WithdrawOutcome | null {
  if (state === null || state === undefined) return null;
  if (WITHDRAWABLE_STATES.includes(state)) return "withdrawn";
  if (WITHDRAW_PARTIAL_STATES.includes(state)) return "withdrawn_after_partial_execution";
  return null;
}

export function canVoid(state: ChangeOrderState | null | undefined): boolean {
  return state !== null && state !== undefined && VOIDABLE_STATES.includes(state);
}

/** Badge visual class per aggregate state: completed greens, hard-terminal
 * reds, caution ambers for "effects happened but not finished" states, and
 * neutral greys for withdrawn paperwork. */
export type OrderStateTone = "success" | "destructive" | "warning" | "info" | "neutral";

export function orderStateTone(state: ChangeOrderState): OrderStateTone {
  switch (state) {
    case "completed":
      return "success";
    case "rejected":
    case "failed":
    case "partial_failed":
    case "voided":
      return "destructive";
    case "withdrawn_after_partial_execution":
    case "result_unknown":
    case "missed_schedule":
    case "blocked_datasource_unavailable":
    case "invalid":
      return "warning";
    case "submitted":
    case "stage_approval_active":
    case "stage_execution_pending":
    case "scheduled":
    case "running":
      return "info";
    case "withdrawn":
    case "cancelled":
    case "partial_cancelled":
      return "neutral";
  }
}

/** Tailwind classes per tone (badge.tsx ships only the shadcn base variants,
 * so the domain layer owns the state-color mapping). */
export const ORDER_STATE_TONE_CLASS: Record<OrderStateTone, string> = {
  success: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  warning: "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400",
  info: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-muted bg-muted text-muted-foreground",
};

export function stageStateTone(state: StageState): OrderStateTone {
  switch (state) {
    case "succeeded":
      return "success";
    case "failed":
    case "partial_failed":
      return "destructive";
    case "result_unknown":
    case "partial_cancelled":
      return "warning";
    case "pending":
    case "skipped":
      return "neutral";
    case "approval_active":
    case "execution_pending":
    case "scheduled":
    case "running":
      return "info";
    case "cancelled":
      return "neutral";
  }
}

/** Timeline actor icon semantics: system/worker events are machine facts,
 * user events carry the acting user. */
export type TimelineActorKind = "user" | "system" | "worker";

/** Identity of the approval step currently awaiting a decision, when the
 * given user is one of its frozen reviewers (W003 同级任一审批). Derived
 * presentation only — the backend re-checks frozen-actor membership on the
 * decision command (order_decision profile 3001/3002). */
export interface ActiveApprovalStep {
  stageId: string;
  stagePosition: number;
  datasourceName: string;
  stepId: string;
  stepPosition: number;
  actorCount: number;
}

export function activeApprovalStepFor(
  order: ChangeOrder,
  userId: string | undefined,
): ActiveApprovalStep | null {
  if (userId === undefined) return null;
  if (order.state !== "stage_approval_active") return null;
  for (const stage of order.stages) {
    if (stage.state !== "approval_active") continue;
    for (const step of stageApprovalSteps(stage)) {
      if (step.state !== "active") continue;
      if (step.actors.some((actor) => actor.id === userId)) {
        return {
          stageId: stage.id,
          stagePosition: stage.position,
          datasourceName: stage.datasource_name,
          stepId: step.id,
          stepPosition: step.position,
          actorCount: step.actors.length,
        };
      }
    }
  }
  return null;
}

/** Badge tone per approval-step state (order_approval_steps vocabulary,
 * including the W008 invalid state when frozen actors were removed). */
export function approvalStepTone(state: string): OrderStateTone {
  switch (state) {
    case "approved":
      return "success";
    case "rejected":
      return "destructive";
    case "invalid":
      return "warning";
    case "active":
      return "info";
    default:
      return "neutral";
  }
}

/** The stage whose execution is currently waiting for its frozen executor
 * (W006), when the given user is one of its frozen executors. Admin confers
 * no execution right — the backend re-checks membership on every command
 * (3001), the UI only mirrors the frozen snapshot. */
export function frozenExecutorStageFor(
  order: ChangeOrder,
  userId: string | undefined,
): (typeof order.stages)[number] | null {
  if (userId === undefined) return null;
  if (order.state !== "stage_execution_pending") return null;
  const stage = order.stages.find((candidate) => candidate.state === "execution_pending");
  if (stage === undefined) return null;
  return stage.execution_actors.some((actor) => actor.id === userId) ? stage : null;
}

/** Terminal execution-attempt states (backend domain.AttemptState.Terminal) —
 * the shared truth for "attempt is live" across the polling hooks and the
 * workspace cards. */
export const ATTEMPT_TERMINAL_STATES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "partial_failed",
  "cancelled",
  "partial_cancelled",
  "result_unknown",
]);

export function isAttemptTerminalState(state: string): boolean {
  return ATTEMPT_TERMINAL_STATES.has(state);
}

/** Badge tone per execution-attempt state (ExecutionAttempt vocabulary). */
export function executionAttemptTone(state: string): OrderStateTone {
  switch (state) {
    case "succeeded":
      return "success";
    case "failed":
    case "partial_failed":
      return "destructive";
    case "result_unknown":
    case "cancelled":
    case "partial_cancelled":
      return "warning";
    case "created":
    case "preflight":
    case "running":
    case "cancelling":
      return "info";
    default:
      return "neutral";
  }
}

/** Badge tone per per-statement fact. `unknown` is deliberately warning-toned
 * and never rendered like `not_started` — a sent statement whose database
 * answer was lost is a high-risk state (E005, gate: Unknown绝不显示成未执行). */
export function statementStateTone(state: string): OrderStateTone {
  switch (state) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    case "unknown":
    case "cancelled":
      return "warning";
    case "sent":
      return "info";
    case "not_started":
    case "skipped":
      return "neutral";
    default:
      return "neutral";
  }
}
