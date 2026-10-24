import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useApprovalQueue } from "@/features/orders/use-approvals";
import { myApprovalStepFor, ORDER_STATE_TONE_CLASS, orderStateTone } from "@/features/orders/order-state";
import { useSession } from "@/features/auth/session-provider";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { ListToolbar, PageHeader, PageLayout } from "@/shared/components/page-layout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import { Card, CardContent } from "@/shared/components/ui/card";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { ArrowRight, Inbox } from "lucide-react";

/**
 * 审批Workspace queue (route /approvals/changes; migration contract §2 maps
 * the legacy /server/order/audit/list here). §18.58 owner ruling: the queue
 * keeps EVERY order where the current user is a frozen approval actor —
 * decided steps stay listed with their outcome (工单状态/提交人 columns); the
 * decision itself still happens on the order detail page. §18.60: my-step
 * column narrows to 是否已审批 — 是 only when my frozen step carries my own
 * decision (approved/rejected), 否 otherwise.
 * Opening or operating this page never creates a Review Run — the reviewer
 * consumes the frozen submission review (R003, gate: 打开操作审批页不创建
 * Review Run).
 */

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function QueueRow({ order, userId }: { order: ChangeOrder; userId: string | undefined }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const mine = myApprovalStepFor(order, userId);
  const orderStateLabel = (state: string): string => {
    const key = `orders.state.${state}`;
    return i18n.exists(key) ? t(key) : state;
  };
  // §18.60：已审批=我的冻结步骤带上我自己的决定（通过/拒绝）；
  // 待轮到/审批中/被跳过/失效都还不是"我审过"。
  const iHaveReviewed = mine !== null && (mine.stepState === "approved" || mine.stepState === "rejected");
  // Keyboard/AT users open rows through the explicit 打开详情 button (a
  // real button element); the row-level onClick is a pointer convenience
  // only, mirroring the mine-page rows.
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => { void navigate(`/changes/orders/${order.id}`); }}
      data-testid="approval-queue-row"
      data-row-key={order.id}
    >
      <TableCell className="font-semibold text-foreground">{order.display_number}</TableCell>
      <TableCell className="max-w-56 truncate font-semibold text-foreground">{order.title}</TableCell>
      <TableCell className="font-mono">
        {mine === null ? "—" : mine.datasourceName}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={`text-xs ${ORDER_STATE_TONE_CLASS[orderStateTone(order.state)]}`}
          data-testid={`approval-row-state-${order.id}`}
        >
          {orderStateLabel(order.state)}
        </Badge>
      </TableCell>
      <TableCell>
        {order.submitter_display_name ?? order.submitter_username ?? "—"}
      </TableCell>
      <TableCell>
        {mine === null ? (
          "—"
        ) : (
          <span data-testid={`approval-reviewed-${order.id}`}>
            {iHaveReviewed ? t("approvals.queue.reviewedYes") : t("approvals.queue.reviewedNo")}
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatTimestamp(order.submitted_at)}
      </TableCell>
      <TableCell className="text-right">
        {/* Reference ruling 2026-10-24: quiet right-aligned affordance; the
            row itself navigates and this echoes it. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t("approvals.queue.open")}
          onClick={(event) => {
            event.stopPropagation();
            void navigate(`/changes/orders/${order.id}`);
          }}
          data-testid={`open-approval-${order.display_number}`}
        >
          <ArrowRight aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function ApprovalQueuePage() {
  const { t } = useTranslation();
  const session = useSession();
  const queueQuery = useApprovalQueue(true);
  const [search, setSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const keyword = search.trim().toLowerCase();
  // The queue matches on order number, title and stage datasource names —
  // the fields an approver uses to locate the order to work on.
  const queue = (queueQuery.data ?? []).filter(
    (order) =>
      keyword === "" ||
      order.display_number.toLowerCase().includes(keyword) ||
      (order.title ?? "").toLowerCase().includes(keyword) ||
      order.stages.some((stage) => stage.datasource_name.toLowerCase().includes(keyword)),
  );
  // The queue arrives as one live 200-row package (event-fed, migration
  // contract §14.3), so paging is client-side slicing — same pattern as the
  // query result grid. A fresh search restarts the walk at page 1.
  const startRow = (pageNo - 1) * pageSize;
  const visibleQueue = queue.slice(startRow, startRow + pageSize);
  const hasMore = startRow + visibleQueue.length < queue.length;
  // 搜索是客户端过滤；同伴决策会实时把行移出队列 — 两种都是行集合变化，
  // 用 FLIP 把幸存行的位移补间掉（与 query-access 的待审表同一模式）。
  const queueBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(visibleQueue.map((order) => order.id)),
  );

  // The shared event feed keeps the queue live against peer decisions —
  // each row's subject is subscribed by the hook, this page just scopes the
  // connection lifecycle like every other event-driven page.
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);

  return (
    <PageLayout data-testid="approval-queue-page">
      <PageHeader icon={Inbox} title={t("approvals.queue.title")} />
      <Card>
        <ListToolbar
          busy={queueQuery.isFetching && queueQuery.isPlaceholderData}
          search={
          <TableSearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPageNo(1);
            }}
            testId="approval-queue-search"
          />
          }
        />
        <CardContent className="px-0!">
          {queueQuery.isPending ? (
            <LoadingState variant="table" columns={8} />
          ) : queueQuery.isError ? (
            <ErrorState
              error={queueQuery.error}
              operationId="listChangeOrders"
              onRetry={() => void queueQuery.refetch()}
            />
          ) : queue.length === 0 && keyword !== "" ? (
            <EmptyState filtered title={t("table.emptySearch")} testId="approval-queue-search-empty" />
          ) : queueQuery.data.length === 0 ? (
            <EmptyState title={t("approvals.queue.empty")} testId="approval-queue-empty" />
          ) : (
            <>
              <Table data-testid="approval-queue-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("approvals.queue.column.number")}</TableHead>
                    <TableHead>{t("approvals.queue.column.title")}</TableHead>
                    <TableHead>{t("approvals.queue.column.datasource")}</TableHead>
                    <TableHead>{t("approvals.queue.column.state")}</TableHead>
                    <TableHead>{t("approvals.queue.column.submitter")}</TableHead>
                    <TableHead>{t("approvals.queue.column.reviewed")}</TableHead>
                    <TableHead>{t("approvals.queue.column.submittedAt")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody ref={queueBodyRef}>
                  {visibleQueue.map((order) => (
                    <QueueRow key={order.id} order={order} userId={session.user?.id} />
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                busy={queueQuery.isFetching && queueQuery.isPlaceholderData}
                page={pageNo}
                hasMore={hasMore}
                isFirst={pageNo <= 1}
                onPrev={() => { setPageNo((current) => Math.max(1, current - 1)); }}
                onNext={() => { setPageNo((current) => current + 1); }}
                onJumpPage={(target) => { setPageNo(target); }}
                pageSize={pageSize}
                onPageSizeChange={(size) => { setPageSize(size); setPageNo(1); }}
                rowsOnPage={visibleQueue.length}
                testIdPrefix="approval-queue-footer"
              />
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">{t("approvals.queue.frozenNote")}</p>
    </PageLayout>
  );
}
