import { useTranslation } from "react-i18next";
import type { ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { stageApprovalSteps } from "@/features/orders/approval-steps";
import { ORDER_STATE_TONE_DOT, orderStateTone } from "@/features/orders/order-state";
import { cn } from "@/shared/lib/utils";

/**
 * Order progress (owner page feedback 2026-11-04 进度条口径 v2，替代同日早先
 * 的「节点 = 全部审批步骤 + 每阶段一个执行节点」口径)：节点固定三个 ——
 * 用户提交、审核、执行（"一共就 用户提交 然后审核 最后执行"）。
 *   提交节点：工单已存在即已完成（提交即走完第一个节点）。
 *   审核节点：全部阶段的所有审批步都有结论（approved/rejected/skipped/
 *             invalid；整阶段 skipped 视同有结论）——拒绝也算审完。
 *   执行节点：全部阶段 succeeded/skipped（完成单读 100%，沿旧口径"跳过
 *             计为完成"的精神）。
 * 进度条仍为单段填充，颜色取工单当前状态的族色（进度条颜色与当前状态章
 * 一致）；阶段列表继续逐项展示每个审批步的细粒度状态。可访问标签携带
 * 计数与状态名，颜色不是唯一载体。
 */

/** Approval-step states that carry a decision (审批步有结论). */
const DECIDED_STEP_STATES: ReadonlySet<string> = new Set([
  "approved",
  "rejected",
  "skipped",
  "invalid",
]);

export function ApprovalProgress({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  const stages = order.stages;

  // No stages ⇒ nothing to review or execute; the card stays hidden (the
  // empty order shape never reaches this page in practice).
  if (stages.length === 0) return null;

  // Node 1 用户提交: the order exists, so it was submitted — always done.
  // Node 2 审核: every approval step of every stage is decided; a stage
  // skipped as a whole counts as decided regardless of its step records.
  const reviewDone = stages.every(
    (stage) =>
      stage.state === "skipped" ||
      stageApprovalSteps(stage).every((step) => DECIDED_STEP_STATES.has(step.state)),
  );
  // Node 3 执行: every stage finished (successfully or skipped).
  const executionDone = stages.every(
    (stage) => stage.state === "succeeded" || stage.state === "skipped",
  );
  const total = 3;
  const done = 1 + (reviewDone ? 1 : 0) + (executionDone ? 1 : 0);
  const color = ORDER_STATE_TONE_DOT[orderStateTone(order.state)];

  return (
    <div className="flex flex-col gap-4" data-testid="approval-progress">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{t("orders.detail.progressLabel")}</p>
        <p className="text-muted-foreground text-sm tabular-nums" data-testid="approval-progress-figure">
          {done} / {total}
        </p>
      </div>

      <div
        role="img"
        aria-label={t("orders.detail.progressAria", {
          done,
          total,
          state: t(`orders.state.${order.state}`),
        })}
        className="bg-muted flex h-3 w-full overflow-hidden rounded-full"
        data-testid="approval-progress-bar"
      >
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${String(Math.min(100, (done / total) * 100))}%` }}
          data-testid="approval-progress-fill"
        />
      </div>
    </div>
  );
}
