import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { ChangeDraft, ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useMyChangeOrders, useMyDrafts } from "@/features/orders/use-orders";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { OrderStateBadge } from "@/features/orders/order-state-badge";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Badge } from "@/shared/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ArrowRight, FileStack } from "lucide-react";

/**
 * 我的工单 (route /changes/mine; migration contract §2: 草稿和已提交工单分离;
 * UI spec §5.2 double-tab shell). The audit tab splits personal drafts from
 * submitted orders; the query tab is the unified query-order view the query
 * domain (F10) delivers — it stays visibly reserved, not silently missing.
 * Legacy list continuity (orderTable.vue): work_id→工单号, remark→标题,
 * date→提交时间, status→状态胶囊; type/delay/real_name columns have no v4
 * counterpart and are dropped per the field-mapping contract.
 */

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function DraftRow({ draft }: { draft: ChangeDraft }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => { void navigate(`/changes/drafts/${draft.id}`); }}
      className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
      data-testid="mine-draft-row"
    >
      <FileStack className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{draft.title}</span>
      <Badge variant="outline">{t(`precheck.phase.${draft.state}`, { defaultValue: draft.state })}</Badge>
      <span className="text-muted-foreground hidden text-xs sm:block">
        {formatTimestamp(draft.updated_at)}
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </button>
  );
}

function OrderRow({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => { void navigate(`/changes/orders/${order.id}`); }}
      data-testid="mine-order-row"
    >
      <TableCell className="font-mono text-xs">{order.display_number}</TableCell>
      <TableCell className="max-w-56 truncate">{order.title}</TableCell>
      <TableCell>
        <OrderStateBadge state={order.state} />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {order.current_stage_position === null
          ? "—"
          : t("orders.list.stagePosition", { position: order.current_stage_position })}
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
          data-testid={`open-order-${order.display_number}`}
        >
          {t("orders.list.open")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function MinePage() {
  const { t } = useTranslation();
  // Live order-state updates ride the shared event feed; without it the list
  // would only refresh on navigation.
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);
  const draftsQuery = useMyDrafts(true);
  const ordersQuery = useMyChangeOrders(true);

  const draftsError = draftsQuery.error ?? ordersQuery.error;
  const retry = (): void => {
    void draftsQuery.refetch();
    void ordersQuery.refetch();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mine-page">
      <PageBreadcrumb title={t("nav.myOrders")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("orders.list.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("orders.list.description")}</p>
      </header>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit" data-testid="tab-audit-orders">
            {t("orders.list.auditTab")}
          </TabsTrigger>
          <TabsTrigger value="query" data-testid="tab-query-orders">
            {t("orders.list.queryTab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="audit" className="flex flex-col gap-4">
          {draftsError !== null && (
            <ErrorState error={draftsError} operationId="listChangeOrders" onRetry={retry} />
          )}
          {draftsError === null && (draftsQuery.isPending || ordersQuery.isPending) && (
            <LoadingState />
          )}
          {draftsError === null && !draftsQuery.isPending && !ordersQuery.isPending && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t("orders.list.draftsCard")}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {(draftsQuery.data ?? []).length === 0 && (
                    <p className="text-muted-foreground px-3 py-2 text-sm">
                      {t("orders.list.draftsEmpty")}
                    </p>
                  )}
                  {(draftsQuery.data ?? []).map((draft) => (
                    <DraftRow key={draft.id} draft={draft} />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t("orders.list.ordersCard")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {(ordersQuery.data ?? []).length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center text-sm">
                      {t("orders.list.ordersEmpty")}
                    </p>
                  ) : (
                    <Table data-testid="mine-orders-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("orders.list.column.number")}</TableHead>
                          <TableHead>{t("orders.list.column.title")}</TableHead>
                          <TableHead>{t("orders.list.column.state")}</TableHead>
                          <TableHead>{t("orders.list.column.stage")}</TableHead>
                          <TableHead>{t("orders.list.column.submittedAt")}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(ordersQuery.data ?? []).map((order) => (
                          <OrderRow key={order.id} order={order} />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="query">
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              {t("orders.list.queryTabPending")}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
