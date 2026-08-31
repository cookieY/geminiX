import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useApprovalQueue } from "@/features/orders/use-approvals";
import { activeApprovalStepFor } from "@/features/orders/order-state";
import { useSession } from "@/features/auth/session-provider";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { ArrowRight, Inbox, Stamp } from "lucide-react";

/**
 * 审批Workspace queue (route /approvals/changes; migration contract §2 maps
 * the legacy /server/order/audit/list here — "只列出当前用户为冻结审核人的节
 * 点"). The queue lists orders where the current user is a frozen actor of
 * the currently active approval step (W003 同级任一审批); the decision
 * itself happens on the order detail page. Opening or operating this page
 * never creates a Review Run — the reviewer consumes the frozen submission
 * review (R003, gate: 打开操作审批页不创建Review Run).
 *
 * Legacy continuity (orderTable.vue audit view): work_id→工单号,
 * source→数据源, remark→标题, date→提交时间, status→状态胶囊; the legacy
 * type/delay columns have no v4 counterpart (DDL/DML types and global delay
 * were dropped by the field-mapping contract).
 */

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function QueueRow({ order, userId }: { order: ChangeOrder; userId: string | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pending = activeApprovalStepFor(order, userId);
  // Keyboard/AT users open rows through the explicit 打开详情 button (a
  // real button element); the row-level onClick is a pointer convenience
  // only, mirroring the mine-page rows.
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => { void navigate(`/changes/orders/${order.id}`); }}
      data-testid="approval-queue-row"
    >
      <TableCell className="font-mono text-xs">{order.display_number}</TableCell>
      <TableCell className="max-w-56 truncate">{order.title}</TableCell>
      <TableCell className="font-mono text-xs">
        {pending === null ? "—" : pending.datasourceName}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {pending === null
          ? "—"
          : t("approvals.queue.pendingStep", {
              stage: pending.stagePosition,
              step: pending.stepPosition,
              reviewers: pending.actorCount,
            })}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {formatTimestamp(order.submitted_at)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            void navigate(`/changes/orders/${order.id}`);
          }}
          data-testid={`open-approval-${order.display_number}`}
        >
          {t("approvals.queue.open")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function ApprovalQueuePage() {
  const { t } = useTranslation();
  const session = useSession();
  const queueQuery = useApprovalQueue(true);

  // The shared event feed keeps the queue live against peer decisions —
  // each row's subject is subscribed by the hook, this page just scopes the
  // connection lifecycle like every other event-driven page.
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="approval-queue-page">
      <PageBreadcrumb title={t("approvals.title")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Stamp className="size-5" aria-hidden />
          <h1 className="text-xl font-semibold">{t("approvals.title")}</h1>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Inbox className="size-4" aria-hidden />
            {t("approvals.queue.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queueQuery.isPending ? (
            <LoadingState />
          ) : queueQuery.isError ? (
            <ErrorState
              error={queueQuery.error}
              operationId="listChangeOrders"
              onRetry={() => void queueQuery.refetch()}
            />
          ) : queueQuery.data.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm" data-testid="approval-queue-empty">
              {t("approvals.queue.empty")}
            </p>
          ) : (
            <Table data-testid="approval-queue-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("approvals.queue.column.number")}</TableHead>
                  <TableHead>{t("approvals.queue.column.title")}</TableHead>
                  <TableHead>{t("approvals.queue.column.datasource")}</TableHead>
                  <TableHead>{t("approvals.queue.column.pendingStep")}</TableHead>
                  <TableHead>{t("approvals.queue.column.submittedAt")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueQuery.data.map((order) => (
                  <QueueRow key={order.id} order={order} userId={session.user?.id} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">{t("approvals.queue.frozenNote")}</p>
    </div>
  );
}
