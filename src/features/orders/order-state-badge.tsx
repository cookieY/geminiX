import { motion, useReducedMotion, type Variants } from "motion/react";
import { CheckCircle, Loader, XCircle } from "lucide-react";
import type { ChangeOrderState, StageState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import {
  ORDER_STATE_TONE_CLASS,
  orderStateTone,
  stageStateTone,
} from "./order-state";

/**
 * Aggregate/step state chip for order surfaces. Color is presentation only —
 * the state string itself stays the single source of truth (workorder PRD §4
 * 聚合状态仅用于列表展示).
 *
 * owner ruling 2026-10-31（badge-07/08/09 三块落地，二轮裁定）：三族动效
 * 徽章保留——成功（teal描边+对勾弹入）、进行中（amber描边+旋转加载）、
 * 失败（red描边+叉号弹入），逐字上浮入场且 state 变化时整章重播；辉光层
 * （三层radial-gradient+blur+backdrop）按裁定取消，只留族色描边与图标
 * 色。静默文书态（withdrawn/cancelled/voided）保持扁平中性章。
 * reduced-motion（含jsdom测试面）渲染静态扁平章，文本断言不受motion
 * 初始opacity影响。
 */

const LETTER_VARIANTS: Variants = {
  hidden: { y: -14, opacity: 0 },
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    transition: { delay: i * 0.038, duration: 0.35, ease: [0.215, 0.61, 0.355, 1] },
  }),
};

const MotionBadge = motion.create(Badge);

type OrderStateFamily = "success" | "pending" | "failed" | "neutral";

export function orderStateFamily(state: ChangeOrderState): OrderStateFamily {
  switch (state) {
    case "completed":
      return "success";
    case "rejected":
    case "failed":
    case "invalid":
    case "partial_failed":
    case "partial_cancelled":
    case "withdrawn_after_partial_execution":
    case "result_unknown":
    case "missed_schedule":
    case "blocked_datasource_unavailable":
      return "failed";
    case "withdrawn":
    case "cancelled":
    case "voided":
      return "neutral";
    default:
      // submitted / stage_approval_active / stage_execution_pending /
      // scheduled / running —— 一切在途。
      return "pending";
  }
}

/** 三族描边与图标色（badge-07/08/09 色值；辉光层已按二轮裁定移除）。 */
const FAMILY_STYLE: Record<Exclude<OrderStateFamily, "neutral">, {
  border: string;
  iconClassName: string;
}> = {
  success: {
    border: "border-teal-400/25",
    iconClassName: "text-teal-400",
  },
  pending: {
    border: "border-amber-300/25",
    iconClassName: "text-amber-300",
  },
  failed: {
    border: "border-red-500/25",
    iconClassName: "text-red-500",
  },
};

export function OrderStateBadge({ state }: { state: ChangeOrderState }) {
  const { t } = useTranslation();
  const label = t(`orders.state.${state}`);
  const family = orderStateFamily(state);
  const reduced = useReducedMotion();

  if (family === "neutral" || reduced) {
    return (
      <Badge variant="outline" className={ORDER_STATE_TONE_CLASS[orderStateTone(state)]}>
        {label}
      </Badge>
    );
  }

  const style = FAMILY_STYLE[family];
  const Icon = family === "success" ? CheckCircle : family === "failed" ? XCircle : Loader;

  return (
    <MotionBadge
      variant="outline"
      className={`rounded-full gap-2 px-3 py-2 text-foreground text-sm font-medium leading-none ${style.border}`}
    >
      {family === "pending" ? (
        <motion.span
          aria-hidden
          animate={{ rotate: 360 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${style.iconClassName}`}
        >
          <Icon size={16} strokeWidth={2.5} />
        </motion.span>
      ) : (
        <motion.span
          aria-hidden
          initial={{ scale: 0.35, opacity: 0, rotate: -25 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ duration: 0.32, ease: [0.175, 0.885, 0.32, 1.275] }}
          className="flex h-4 w-4 shrink-0 items-center justify-center"
        >
          <Icon size={16} strokeWidth={2} className={style.iconClassName} />
        </motion.span>
      )}
      {/* key=label：state 变化即重挂载，逐字入场随之重播——之前只在
          首挂载播一次，状态切换时看起来「动效没了」。 */}
      <span key={label} className="inline-flex overflow-hidden leading-none">
        {label.split("").map((char, index) => (
          <motion.span
            key={index}
            custom={index}
            variants={LETTER_VARIANTS}
            initial="hidden"
            animate="visible"
            className="inline-block whitespace-pre leading-normal"
          >
            {char}
          </motion.span>
        ))}
      </span>
    </MotionBadge>
  );
}

export function StageStateBadge({ state }: { state: StageState }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={ORDER_STATE_TONE_CLASS[stageStateTone(state)]}>
      {t(`orders.stageState.${state}`)}
    </Badge>
  );
}
