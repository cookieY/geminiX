import { useTranslation } from "react-i18next";
import type { OrderStage } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { stageApprovalSteps } from "@/features/orders/approval-steps";
import { ORDER_STATE_TONE_DOT, approvalStepTone } from "@/features/orders/order-state";
import { cn } from "@/shared/lib/utils";

/**
 * Approval progress, built on the Shadcn Dashboard `progress-07` (Segmented
 * Storage) block: a heading row with the headline figure, one rounded
 * multi-segment bar whose widths are proportional to the step counts, and a
 * dot legend that names every state with its count. Segment colours are the
 * step-state tones the badges already use (approved / active / rejected /
 * invalid / waiting) instead of the block's demo palette; the legend and the
 * bar's accessible label carry the same names, so colour is never the only
 * carrier.
 */
export function ApprovalProgress({ stages }: { stages: OrderStage[] }) {
  const { t } = useTranslation();

  const states = stages.flatMap((stage) => stageApprovalSteps(stage).map((step) => step.state));
  if (states.length === 0) return null;

  const total = states.length;
  const approved = states.filter((state) => state === "approved").length;
  // Segments follow first appearance, so the bar reads in step order.
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  const segments = [...counts.entries()].map(([state, count]) => ({
    state,
    count,
    label: t(`approvals.stepState.${state}`, { defaultValue: state }),
    color: ORDER_STATE_TONE_DOT[approvalStepTone(state)],
  }));

  return (
    <div className="flex flex-col gap-4" data-testid="approval-progress">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{t("orders.detail.progressLabel")}</p>
        <p className="text-muted-foreground text-sm tabular-nums" data-testid="approval-progress-figure">
          {approved} / {total}
        </p>
      </div>

      <div
        role="img"
        aria-label={segments.map((segment) => `${segment.label} ${String(segment.count)}`).join(", ")}
        className="bg-muted flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        data-testid="approval-progress-bar"
      >
        {segments.map((segment) => (
          <div
            key={segment.state}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.color)}
            style={{ width: `${String((segment.count / total) * 100)}%` }}
            data-testid={`approval-progress-segment-${segment.state}`}
          />
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map((segment) => (
          <li key={segment.state} className="flex items-center gap-2 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", segment.color)} aria-hidden="true" />
            <span className="text-foreground">{segment.label}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">{segment.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
