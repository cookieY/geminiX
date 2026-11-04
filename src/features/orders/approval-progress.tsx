import { useTranslation } from "react-i18next";
import type { ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { stageApprovalSteps } from "@/features/orders/approval-steps";
import { ORDER_STATE_TONE_DOT, orderStateTone } from "@/features/orders/order-state";
import { cn } from "@/shared/lib/utils";

/**
 * Order progress (owner ruling 2026-11-04 进度条口径): the stage list already
 * shows every node — each approval step plus one execution node per stage — so
 * the bar counts the same population. 完成率 = 已完成节点 / 全部节点：
 * a step completes on `approved`; a stage's execution node completes on
 * `succeeded` (skipped counts as complete so a finished order that skipped a
 * stage still reads 100%). The bar is a single fill in the CURRENT order
 * state's tone (进度条颜色与当前状态章一致) — progress-07's segmented
 * per-state palette is retired; the stage list underneath itemises every
 * node's own state, colour on the bar only has to say "how far, and where the
 * order stands right now". The accessible label carries the counts and the
 * state name, so colour is never the only carrier.
 */
export function ApprovalProgress({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  const stages = order.stages;

  const stepStates = stages.flatMap((stage) =>
    stageApprovalSteps(stage).map((step) => step.state),
  );
  // One execution node per stage, after that stage's approval steps.
  const total = stepStates.length + stages.length;
  if (total === 0) return null;

  const approvedSteps = stepStates.filter((state) => state === "approved").length;
  const finishedExecutions = stages.filter(
    (stage) => stage.state === "succeeded" || stage.state === "skipped",
  ).length;
  const done = approvedSteps + finishedExecutions;
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
