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
 */
export function OrderStateBadge({ state }: { state: ChangeOrderState }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={ORDER_STATE_TONE_CLASS[orderStateTone(state)]}>
      {t(`orders.state.${state}`)}
    </Badge>
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
