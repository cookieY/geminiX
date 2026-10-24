import { STATUS_TONE_CLASS } from "@/shared/lib/status-tone";
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

/** One hue per outcome family (owner ruling 2026-10-23: "不同状态有不同的颜色…
 * 颜色要符合状态结果含义"). Ten hue tokens instead of five generic ones, so a
 * reviewer can tell "waiting for approval" (violet) from "waiting for
 * execution" (amber) from "scheduled" (teal) at a glance, while every tone
 * still maps to a real semantic group:
 *   emerald  finished well        teal    queued for a fixed slot
 *   sky      handed in            indigo  actively running
 *   violet   decision pending     amber   execution pending
 *   orange   outcome uncertain    rose    effects happened, ended badly
 *   red      hard failure         stone   paperwork that closed quietly
 * Each tone is declared per theme in global.css (light holds deeper inks on
 * paper, dark holds luminous ones on near-black) and the contrast gate keeps
 * the chip text at WCAG AA in both. */
export type OrderStateTone =
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "violet"
  | "amber"
  | "orange"
  | "rose"
  | "red"
  | "stone";

export function orderStateTone(state: ChangeOrderState): OrderStateTone {
  switch (state) {
    case "completed":
      return "emerald";
    case "scheduled":
      return "teal";
    case "submitted":
      return "sky";
    case "running":
      return "indigo";
    case "stage_approval_active":
      return "violet";
    case "stage_execution_pending":
      return "amber";
    case "result_unknown":
    case "missed_schedule":
    case "blocked_datasource_unavailable":
      return "orange";
    case "partial_failed":
    case "partial_cancelled":
    case "withdrawn_after_partial_execution":
      return "rose";
    case "rejected":
    case "failed":
    case "invalid":
      return "red";
    case "withdrawn":
    case "cancelled":
    case "voided":
      return "stone";
  }
}

/** Chip surface per tone: a 12% wash of the same hue plus a 30% hairline, so
 * the chip stays flat (no gradient, no shadow) and the hue does the talking. */
export const ORDER_STATE_TONE_CLASS: Record<OrderStateTone, string> = STATUS_TONE_CLASS;

/** Solid dot/fill variant of the same tones (status strips, legends). */
export const ORDER_STATE_TONE_DOT: Record<OrderStateTone, string> = {
  emerald: "bg-tone-emerald",
  teal: "bg-tone-teal",
  sky: "bg-tone-sky",
  indigo: "bg-tone-indigo",
  violet: "bg-tone-violet",
  amber: "bg-tone-amber",
  orange: "bg-tone-orange",
  rose: "bg-tone-rose",
  red: "bg-tone-red",
  stone: "bg-muted-foreground/60",
};

export function stageStateTone(state: StageState): OrderStateTone {
  switch (state) {
    case "succeeded":
      return "emerald";
    case "failed":
      return "red";
    case "partial_failed":
      return "rose";
    case "result_unknown":
      return "orange";
    case "partial_cancelled":
      return "rose";
    case "pending":
    case "skipped":
    case "cancelled":
      return "stone";
    case "approval_active":
      return "violet";
    case "execution_pending":
      return "amber";
    case "scheduled":
      return "teal";
    case "running":
      return "indigo";
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

/** §18.58：当前用户在该工单里"自己的"审批步——优先返回仍在等待决定的
 * active步；否则返回第一个包含该用户的步骤（已决定/未激活/被跳过），
 * 供审批队列在已审工单上展示我的参与状态。纯展示派生，权威判定在
 * 后端决策命令。 */
export interface MyApprovalStep extends ActiveApprovalStep {
  stepState: string;
}

export function myApprovalStepFor(
  order: ChangeOrder,
  userId: string | undefined,
): MyApprovalStep | null {
  if (userId === undefined) return null;
  let fallback: MyApprovalStep | null = null;
  for (const stage of order.stages) {
    for (const step of stageApprovalSteps(stage)) {
      if (!step.actors.some((actor) => actor.id === userId)) continue;
      const found: MyApprovalStep = {
        stageId: stage.id,
        stagePosition: stage.position,
        datasourceName: stage.datasource_name,
        stepId: step.id,
        stepPosition: step.position,
        actorCount: step.actors.length,
        stepState: step.state,
      };
      if (step.state === "active") return found;
      if (fallback === null) fallback = found;
    }
  }
  return fallback;
}

/** Badge tone per approval-step state (order_approval_steps vocabulary,
 * including the W008 invalid state when frozen actors were removed). */
export function approvalStepTone(state: string): OrderStateTone {
  switch (state) {
    case "approved":
      return "emerald";
    case "rejected":
      return "red";
    case "invalid":
      return "orange";
    case "active":
      return "violet";
    default:
      return "stone";
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
      return "emerald";
    case "failed":
      return "red";
    case "partial_failed":
      return "rose";
    case "result_unknown":
      return "orange";
    case "cancelled":
      return "stone";
    case "partial_cancelled":
      return "rose";
    case "created":
    case "preflight":
    case "running":
    case "cancelling":
      return "indigo";
    default:
      return "stone";
  }
}

/** Badge tone per per-statement fact. `unknown` is deliberately warning-toned
 * and never rendered like `not_started` — a sent statement whose database
 * answer was lost is a high-risk state (E005, gate: Unknown绝不显示成未执行). */
export function statementStateTone(state: string): OrderStateTone {
  switch (state) {
    case "succeeded":
      return "emerald";
    case "failed":
      return "red";
    case "unknown":
      return "orange";
    case "cancelled":
      return "stone";
    case "sent":
      return "sky";
    case "not_started":
    case "skipped":
      return "stone";
    default:
      return "stone";
  }
}
