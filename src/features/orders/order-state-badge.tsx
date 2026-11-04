import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  CircleCheck,
  Clock,
  Hourglass,
  Info,
  Loader2,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { ChangeOrderState, StageState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import {
  ORDER_STATE_TONE_CLASS,
  orderStateTone,
  stageStateTone,
  type OrderStateTone,
} from "./order-state";

/**
 * Aggregate/step state chip for order surfaces. Color is presentation only —
 * the state string itself stays the single source of truth (workorder PRD §4
 * 聚合状态仅用于列表展示).
 *
 * owner ruling 2026-11-04（Sonner 08 落地）：工单状态章采用 shadcn-dashboard
 * sonner-08 块的 tone 视觉（src/shared/components/shadcn-dashboard/sonner/）——
 * 图标置于着色圆（/15 底）内，章体沿用族色 12% 底 + 30% 描边（STATUS_TONE_CLASS），
 * 图标随章文字走族色。tone 与图标一一对应，沿用块的图标语义：
 *   CircleCheck 完成 · Clock 排期 · Info 已提交 · Loader2 执行中（旋转）
 *   BellRing 待审批/文书 · Hourglass 等待执行 · TriangleAlert 结果不明 ·
 *   OctagonAlert 失败恶果
 * 2026-11-04 起 waiting 族（含"等待执行"）统一 Hourglass，TriangleAlert 仅
 * 保留给 partial/结果不明。
 * 早于它的两条裁定（2026-10-31 三族动效章、2026-11-04 审批队列扁平章）均由本
 * 版本替代；审批队列仍消费同一组件，全仓工单状态只有这一处定义。
 */

/** Sonner-08 tone grammar: one icon per order tone (see ruling above). */
const TONE_ICON: Record<OrderStateTone, LucideIcon> = {
  emerald: CircleCheck,
  teal: Clock,
  sky: Info,
  indigo: Loader2,
  violet: BellRing,
  amber: TriangleAlert,
  orange: TriangleAlert,
  waiting: Hourglass,
  rose: OctagonAlert,
  red: OctagonAlert,
  stone: BellRing,
};

/** Tinted circle behind the icon (the block's `badge` layer, /15 tint). */
const TONE_ICON_CIRCLE: Record<OrderStateTone, string> = {
  emerald: "bg-tone-emerald/15",
  teal: "bg-tone-teal/15",
  sky: "bg-tone-sky/15",
  indigo: "bg-tone-indigo/15",
  violet: "bg-tone-violet/15",
  amber: "bg-tone-amber/15",
  orange: "bg-tone-orange/15",
  waiting: "bg-tone-waiting/15",
  rose: "bg-tone-rose/15",
  red: "bg-tone-red/15",
  stone: "bg-foreground/10",
};

/** The sonner-08 tone chip shared by every order-surface state badge. */
export function StateToneChip({
  tone,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Badge>, "children"> & {
  tone: OrderStateTone;
  label: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <Badge
      variant="outline"
      className={cn(ORDER_STATE_TONE_CLASS[tone], className)}
      {...props}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full",
          TONE_ICON_CIRCLE[tone],
        )}
        aria-hidden="true"
      >
        <Icon
          className={cn(
            "size-2.5",
            tone === "indigo" && "animate-spin motion-reduce:animate-none",
          )}
        />
      </span>
      {label}
    </Badge>
  );
}

export function OrderStateBadge({
  state,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Badge>, "children"> & {
  state: ChangeOrderState;
}) {
  const { t } = useTranslation();
  return (
    <StateToneChip
      tone={orderStateTone(state)}
      label={t(`orders.state.${state}`)}
      className={className}
      {...props}
    />
  );
}

export function StageStateBadge({ state }: { state: StageState }) {
  const { t } = useTranslation();
  return <StateToneChip tone={stageStateTone(state)} label={t(`orders.stageState.${state}`)} />;
}
