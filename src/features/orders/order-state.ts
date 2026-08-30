import type { ChangeOrderState, StageState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

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
