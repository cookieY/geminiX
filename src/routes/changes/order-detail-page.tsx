import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { ChangeOrderTimelineEntry } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { OrderStateBadge, StageStateBadge } from "@/features/orders/order-state-badge";
import { canVoid, withdrawOutcome } from "@/features/orders/order-state";
import { stageApprovalSteps } from "@/features/orders/approval-steps";
import { ApprovalDecisionCard, ApprovalStepStateBadge } from "@/features/orders/approval-decision-card";
import { FrozenReviewCard } from "@/features/orders/frozen-review-card";
import { OrderCommentsCard } from "@/features/orders/order-comments-card";
import { OrderSqlCard } from "@/features/orders/order-sql-card";
import { ExecutionWorkspaceCard } from "@/features/orders/execution-card";
import {
  useChangeOrder,
  useChangeOrderTimeline,
  useVoidOrder,
  useWithdrawOrder,
} from "@/features/orders/use-orders";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
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
import { Ban, CircleAlert, Clock, FileCode2, History, ShieldCheck, Undo2, User, Wrench } from "lucide-react";

/**
 * Order detail (route /changes/orders/:id; migration contract §2 keeps the
 * legacy profile's header-actions + progress + timeline layout). Withdraw/
 * void mirror the change_order state machine: the withdraw dialog spells out
 * the partial-execution consequence before confirming (W007 — 部分执行后撤
 * 回明确提示不可回滚), and a backend rejection re-renders inside the dialog
 * as an error — never as a success state (gate: 后端拒绝无假成功).
 *
 * FE-F7 approval workspace: the same surface serves the frozen reviewer —
 * an approval decision card renders only for the active step's frozen
 * actors, the frozen submission review and comments are readable for every
 * related user, and an invalid notice explains the W008 actor-deletion
 * state. Opening or operating this page never creates a Review Run (R003).
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

  const entries = timelineQuery.data ?? [];
  return (
    <Card data-testid="order-timeline">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden />
          {t("orders.detail.timeline")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timelineQuery.isPending ? (
          <LoadingState variant="table" columns={2} />
        ) : timelineQuery.isError ? (
          <ErrorState
            error={timelineQuery.error}
            operationId="listChangeOrderTimeline"
            onRetry={() => void timelineQuery.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyState title={t("orders.detail.timelineEmpty")} />
        ) : (
          <ol className="flex flex-col gap-3" data-testid="order-timeline-list">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="text-muted-foreground mt-0.5">
                  <ActorIcon kind={entry.actor_kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p>{entry.summary}</p>
                  {entry.comment != null && entry.comment !== "" && (
                    <p className="text-foreground/80 whitespace-pre-wrap break-words text-xs" data-testid="order-timeline-comment">
                      {entry.comment}
                    </p>
                  )}
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

  // The shared event feed keeps state-driven surfaces live (withdrawals and
  // peer decisions from another tab, stage progress); the client's resume
  // point survives across pages exactly as in the draft workspace.
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);

  const [dialog, setDialog] = useState<"withdraw" | "void" | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The execution attempt this session knows about. The contract has no
  // list-attempts read — the id enters through the creation response and is
  // page-local state (FE-F8; events on the order subject keep it fresh).
  const [attemptId, setAttemptId] = useState<string | null>(null);

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
      <PageLayout data-testid="order-detail-page">
        <PageHeader
          icon={FileCode2}
          title={t("orders.detail.title")}
          description={t("orders.detail.frozenNote")}
        />
        <LoadingState variant="page" />
      </PageLayout>
    );
  }
  if (orderQuery.isError) {
    return (
      <PageLayout data-testid="order-detail-page">
        <PageHeader
          icon={FileCode2}
          title={t("orders.detail.title")}
          description={t("orders.detail.frozenNote")}
        />
        <ErrorState
          error={orderQuery.error}
          operationId="getChangeOrder"
          onRetry={() => void orderQuery.refetch()}
        />
      </PageLayout>
    );
  }
  if (order === null) return null;

  const pending = withdrawMutation.isPending || voidMutation.isPending;

  return (
    <PageLayout data-testid="order-detail-page">
      <PageHeader
        icon={FileCode2}
        title={<span className="font-mono">{order.display_number}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{order.title}</span>
            <OrderStateBadge state={order.state} />
          </span>
        }
        actions={
          <>
          {isSubmitter && outcome !== null && (
            <PendingButton
              variant="outline"
              pending={withdrawMutation.isPending}
              disabled={voidMutation.isPending}
              onClick={() => { setDialog("withdraw"); setDialogError(null); }}
              data-testid="withdraw-order"
            >
              <Undo2 aria-hidden />
              {t("orders.detail.withdraw")}
            </PendingButton>
          )}
          {isSubmitter && canVoid(order.state) && (
            <PendingButton
              variant="destructive"
              pending={voidMutation.isPending}
              disabled={withdrawMutation.isPending}
              onClick={() => { setDialog("void"); setDialogError(null); }}
              data-testid="void-order"
            >
              <Ban aria-hidden />
              {t("orders.detail.void")}
            </PendingButton>
          )}
          </>
        }
      />

      {order.state === "invalid" && (
        <Alert data-testid="invalid-order-alert">
          <CircleAlert className="size-4" aria-hidden />
          <AlertTitle>{t("orders.detail.invalidTitle")}</AlertTitle>
          <AlertDescription>{t("orders.detail.invalidDescription")}</AlertDescription>
        </Alert>
      )}

      <ApprovalDecisionCard order={order} onRecover={() => void orderQuery.refetch()} />
      <OrderSqlCard orderId={order.id} />
      {/* §18.57：执行等待期，非冻结执行人视角没有任何解释（§18.47补记5
          同类缺陷）——补一块说明面板，点名冻结执行人。 */}
      {order.state === "stage_execution_pending" &&
        (() => {
          const pendingStage = order.stages.find((stage) => stage.state === "execution_pending");
          const isExecutor =
            pendingStage !== undefined &&
            session.user !== null &&
            pendingStage.execution_actors.some((actor) => actor.id === session.user?.id);
          if (isExecutor || pendingStage === undefined) return null;
          const names = pendingStage.execution_actors.map((actor) => actor.display_name).join("、");
          return (
            <Card data-testid="execution-wait-note">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Clock aria-hidden />
                  {t("orders.execution.waitTitle")}
                </CardTitle>
                <CardDescription>{t("orders.execution.waitNote", { names })}</CardDescription>
              </CardHeader>
            </Card>
          );
        })()}
      <ExecutionWorkspaceCard
        order={order}
        attemptId={attemptId}
        onAttemptCreated={setAttemptId}
        onRecover={() => void orderQuery.refetch()}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="order-stages">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <FileCode2 aria-hidden />
              {t("orders.detail.stages")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {order.stages.map((stage) => {
              const steps = stageApprovalSteps(stage);
              return (
                <div key={stage.id} className="rounded-md border p-3" data-testid={`order-stage-${String(stage.position)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Badge variant="outline">{t("precheck.stagePath.stage", { position: stage.position })}</Badge>
                      <span className="font-mono text-xs">{stage.datasource_name}</span>
                    </p>
                    <StageStateBadge state={stage.state} />
                  </div>
                  {steps.length > 0 && (
                    <ol className="mt-2 flex flex-col gap-2" data-testid={`stage-steps-${String(stage.position)}`}>
                      {steps.map((step) => (
                        <li key={step.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`stage-step-${String(step.position)}`}>
                          <ApprovalStepStateBadge state={step.state} />
                          <span className="text-muted-foreground">
                            {t("orders.detail.stepTitle", { position: step.position })}
                          </span>
                          <span>
                            {step.actors.map((actor) => actor.displayName).join("、")}
                          </span>
                          {step.decidedAt !== null && (
                            <span className="text-muted-foreground">
                              {t("orders.detail.stepDecidedAt", { time: formatTimestamp(step.decidedAt) })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("orders.detail.stageExecutors", { count: stage.execution_actors.length })}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card data-testid="order-facts">
          <CardHeader className="pb-3">
            <CardTitle>{t("orders.detail.facts")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.detail.submittedAt")}</span>
              <span>{formatTimestamp(order.submitted_at)}</span>
            </p>
            {order.requested_scheduled_for != null && (
              <p className="flex justify-between gap-3" data-testid="order-requested-schedule">
                <span className="text-muted-foreground">{t("orders.detail.requestedSchedule")}</span>
                <span>{formatTimestamp(order.requested_scheduled_for)}</span>
              </p>
            )}
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

      <FrozenReviewCard orderId={order.id} />
      <OrderCommentsCard orderId={order.id} />
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
          <div className="flex flex-col gap-2">
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
            <PendingButton
              variant={dialog === "void" ? "destructive" : "default"}
              onClick={confirmAction}
              pending={pending}
              disabled={reason.trim() === ""}
              data-testid="order-action-confirm"
            >
              {dialog === "withdraw" ? t("orders.detail.withdraw") : t("orders.detail.void")}
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
