import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { ChangeOrderTimelineEntry } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { OrderStateBadge, StageStateBadge } from "@/features/orders/order-state-badge";
import { canVoid, withdrawOutcome } from "@/features/orders/order-state";
import {
  useChangeOrder,
  useChangeOrderTimeline,
  useVoidOrder,
  useWithdrawOrder,
} from "@/features/orders/use-orders";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { useSession } from "@/features/auth/session-provider";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Ban, CircleAlert, FileCode2, History, ShieldCheck, Undo2, User, Wrench } from "lucide-react";

/**
 * Order detail (route /changes/orders/:id; migration contract §2 keeps the
 * legacy profile's header-actions + progress + timeline layout). Withdraw/
 * void mirror the change_order state machine: the withdraw dialog spells out
 * the partial-execution consequence before confirming (W007 — 部分执行后撤
 * 回明确提示不可回滚), and a backend rejection re-renders inside the dialog
 * as an error — never as a success state (gate: 后端拒绝无假成功).
 */

function formatTimestamp(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : value.replace("T", " ").replace("Z", " UTC");
}

const STATE_LABEL_ROOTS = ["orders.state", "orders.stageState"] as const;

/** Timeline entry states mix order and stage enums; resolve the localized
 * label from either dictionary and fall back to the raw value. */
function useTimelineStateLabel(): (state: string | null | undefined) => string {
  const { t, i18n } = useTranslation();
  return (state): string => {
    if (state === null || state === undefined) return "";
    for (const root of STATE_LABEL_ROOTS) {
      const key = `${root}.${state}`;
      if (i18n.exists(key)) return t(key);
    }
    return state;
  };
}

function ActorIcon({ kind }: { kind: ChangeOrderTimelineEntry["actor_kind"] }) {
  if (kind === "user") return <User className="size-3.5" aria-hidden />;
  if (kind === "system") return <ShieldCheck className="size-3.5" aria-hidden />;
  return <Wrench className="size-3.5" aria-hidden />;
}

function TimelineCard({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const stateLabel = useTimelineStateLabel();
  const timelineQuery = useChangeOrderTimeline(orderId, true);

  if (timelineQuery.isPending) return <LoadingState />;
  if (timelineQuery.isError) {
    return (
      <ErrorState
        error={timelineQuery.error}
        operationId="listChangeOrderTimeline"
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  const entries = timelineQuery.data;
  return (
    <Card data-testid="order-timeline">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4" aria-hidden />
          {t("orders.detail.timeline")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("orders.detail.timelineEmpty")}</p>
        ) : (
          <ol className="flex flex-col gap-3" data-testid="order-timeline-list">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="text-muted-foreground mt-0.5">
                  <ActorIcon kind={entry.actor_kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p>{entry.summary}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatTimestamp(entry.occurred_at)}
                    {entry.stage_position !== null && (
                      <> · {t("orders.detail.timelineStage", { position: entry.stage_position })}</>
                    )}
                    {entry.state !== null && (
                      <Badge variant="outline" className="ml-2 align-middle">
                        {stateLabel(entry.state)}
                      </Badge>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default function OrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams<{ orderId: string }>();
  const session = useSession();
  const orderQuery = useChangeOrder(orderId ?? "");
  const order = orderQuery.data ?? null;
  // Work-order PRD §5: only the submitter may withdraw or void — frozen
  // reviewers/executors can read the order but never see the lifecycle
  // buttons (the backend keeps the authoritative 403).
  const isSubmitter = session.user?.id === order?.submitter_user_id;

  // The shared event feed keeps state-driven surfaces live (withdrawals from
  // another tab, stage progress); the client's resume point survives across
  // pages exactly as in the draft workspace.
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);

  const [dialog, setDialog] = useState<"withdraw" | "void" | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const withdrawMutation = useWithdrawOrder(order);
  const voidMutation = useVoidOrder(order);
  const outcome = withdrawOutcome(order?.state);

  const closeDialog = (): void => {
    setDialog(null);
    setReason("");
    setDialogError(null);
  };

  const confirmAction = (): void => {
    const mutation = dialog === "withdraw" ? withdrawMutation : voidMutation;
    mutation.mutate(reason, {
      onSuccess: () => { closeDialog(); },
      onError: (error) => {
        // The dialog stays open and shows exactly what the backend said —
        // no optimistic state flip, no fake success (验收门禁: 后端拒绝无假
        // 成功).
        const display = describeError(
          error,
          dialog === "withdraw" ? "withdrawChangeOrder" : "voidChangeOrder",
        );
        setDialogError(
          `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
        );
      },
    });
  };

  if (orderQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" data-testid="order-detail-page">
        <PageBreadcrumb title={t("orders.detail.title")} />
        <LoadingState />
      </div>
    );
  }
  if (orderQuery.isError) {
    return (
      <div className="flex flex-col gap-4" data-testid="order-detail-page">
        <PageBreadcrumb title={t("orders.detail.title")} />
        <ErrorState
          error={orderQuery.error}
          operationId="getChangeOrder"
          onRetry={() => void orderQuery.refetch()}
        />
      </div>
    );
  }
  if (order === null) return null;

  const pending = withdrawMutation.isPending || voidMutation.isPending;

  return (
    <div className="flex flex-col gap-4" data-testid="order-detail-page">
      <PageBreadcrumb title={order.display_number} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold">{order.display_number}</h1>
          <OrderStateBadge state={order.state} />
        </div>
        <div className="flex items-center gap-2">
          {isSubmitter && outcome !== null && (
            <Button
              variant="outline"
              onClick={() => { setDialog("withdraw"); setDialogError(null); }}
              disabled={pending}
              data-testid="withdraw-order"
            >
              <Undo2 className="size-4" aria-hidden />
              {t("orders.detail.withdraw")}
            </Button>
          )}
          {isSubmitter && canVoid(order.state) && (
            <Button
              variant="destructive"
              onClick={() => { setDialog("void"); setDialogError(null); }}
              disabled={pending}
              data-testid="void-order"
            >
              <Ban className="size-4" aria-hidden />
              {t("orders.detail.void")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="order-stages">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileCode2 className="size-4" aria-hidden />
              {t("orders.detail.stages")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {order.stages.map((stage) => (
              <div key={stage.id} className="rounded-md border p-3" data-testid={`order-stage-${String(stage.position)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Badge variant="outline">{t("precheck.stagePath.stage", { position: stage.position })}</Badge>
                    <span className="font-mono text-xs">{stage.datasource_name}</span>
                  </p>
                  <StageStateBadge state={stage.state} />
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {t("orders.detail.stageApprovers", { count: stage.approval_steps.length })} ·{" "}
                  {t("orders.detail.stageExecutors", { count: stage.execution_actors.length })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="order-facts">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("orders.detail.facts")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.submittedAt")}</span>
              <span>{formatTimestamp(order.submitted_at)}</span>
            </p>
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.terminalAt")}</span>
              <span>{formatTimestamp(order.terminal_at)}</span>
            </p>
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.sqlHash")}</span>
              <span className="font-mono text-xs">{order.sql_hash}</span>
            </p>
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.snapshotHash")}</span>
              <span className="font-mono text-xs">{order.snapshot_hash}</span>
            </p>
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.manuallyVerified")}</span>
              <span>{order.manually_verified ? t("common.yes") : t("common.no")}</span>
            </p>
            <p className="text-muted-foreground text-xs">{t("orders.detail.frozenNote")}</p>
          </CardContent>
        </Card>
      </div>

      <TimelineCard orderId={order.id} />

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent data-testid="order-action-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog === "withdraw" ? t("orders.detail.withdrawTitle") : t("orders.detail.voidTitle")}
            </DialogTitle>
            <DialogDescription>
              {dialog === "withdraw"
                ? outcome === "withdrawn_after_partial_execution"
                  ? t("orders.detail.withdrawPartialDescription")
                  : t("orders.detail.withdrawDescription")
                : t("orders.detail.voidDescription")}
            </DialogDescription>
          </DialogHeader>
          {dialog === "withdraw" && outcome === "withdrawn_after_partial_execution" && (
            <Alert variant="destructive" data-testid="partial-execution-warning">
              <CircleAlert className="size-4" aria-hidden />
              <AlertTitle>{t("orders.detail.partialWarningTitle")}</AlertTitle>
              <AlertDescription>{t("orders.detail.partialWarningDescription")}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="order-action-reason">{t("orders.detail.reasonLabel")}</Label>
            <Textarea
              id="order-action-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); }}
              rows={3}
              maxLength={4096}
              data-testid="order-action-reason"
            />
          </div>
          {dialogError !== null && (
            <p role="alert" className="text-destructive text-sm" data-testid="order-action-error">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="order-action-cancel">
              {t("common.cancel")}
            </Button>
            <Button
              variant={dialog === "void" ? "destructive" : "default"}
              onClick={confirmAction}
              disabled={reason.trim() === "" || pending}
              data-testid="order-action-confirm"
            >
              {dialog === "withdraw" ? t("orders.detail.withdraw") : t("orders.detail.void")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
