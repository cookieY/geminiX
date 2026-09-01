import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type {
  ChangeDraft,
  ChangeOrder,
  ChangeOrderState,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useMyChangeOrders,
  useMyDrafts,
  useOrderDatasourceOptions,
  type OrderListFilters,
} from "@/features/orders/use-orders";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { OrderStateBadge } from "@/features/orders/order-state-badge";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { QueryOrdersTab } from "@/routes/changes/query-orders-tab";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ArrowRight, FileStack, FilterX, Search } from "lucide-react";

/**
 * 我的工单 (route /changes/mine; migration contract §2: 草稿和已提交工单分离;
 * UI spec §5.2 double-tab shell). The audit tab splits personal drafts from
 * submitted orders; the query tab is the unified query-order view the query
 * domain (F10) delivers — it stays visibly reserved, not silently missing.
 * Legacy list continuity (orderTable.vue): work_id→工单号, remark→标题,
 * date→提交时间, status→状态胶囊; type/delay/real_name columns have no v4
 * counterpart and are dropped per the field-mapping contract.
 *
 * Filtering (FE-F6-ORDER-FILTER, RCP-20260831-ORDER-LIST-FILTER): state /
 * keyword / datasource / submitted-date range are server-side query params —
 * the toolbar composes them per the §7.1 list baseline (toolbar search
 * input); the keyword is debounced so each keystroke is not a request.
 */

const ALL_STATES = "all" as const;
const ALL_DATASOURCES = "all" as const;
const KEYWORD_DEBOUNCE_MS = 300;

const ORDER_STATES: ChangeOrderState[] = [
  "submitted",
  "stage_approval_active",
  "stage_execution_pending",
  "scheduled",
  "running",
  "completed",
  "rejected",
  "withdrawn",
  "withdrawn_after_partial_execution",
  "voided",
  "failed",
  "partial_failed",
  "cancelled",
  "partial_cancelled",
  "result_unknown",
  "blocked_datasource_unavailable",
  "missed_schedule",
  "invalid",
];

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

interface FilterState {
  keywordInput: string;
  q: string;
  /** "all" sentinel or a ChangeOrderState value. */
  state: string;
  /** "all" sentinel or an exact stage datasource_name. */
  datasource: string;
  submittedFrom: string;
  submittedTo: string;
}

const INITIAL_FILTERS: FilterState = {
  keywordInput: "",
  q: "",
  state: ALL_STATES,
  datasource: ALL_DATASOURCES,
  submittedFrom: "",
  submittedTo: "",
};

function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q !== "" ||
    filters.state !== ALL_STATES ||
    filters.datasource !== ALL_DATASOURCES ||
    filters.submittedFrom !== "" ||
    filters.submittedTo !== ""
  );
}

function MineOrderFilters({
  filters,
  datasourceOptions,
  onChange,
  onReset,
}: {
  filters: FilterState;
  datasourceOptions: string[];
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      data-testid="mine-order-filters"
    >
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={filters.keywordInput}
          onChange={(event) => { onChange({ keywordInput: event.target.value }); }}
          placeholder={t("orders.list.filter.searchPlaceholder")}
          className="w-48 pl-8"
          aria-label={t("orders.list.filter.searchPlaceholder")}
          data-testid="filter-keyword"
        />
      </div>
      <Select
        value={filters.state}
        onValueChange={(value) => { onChange({ state: value ?? ALL_STATES }); }}
      >
        <SelectTrigger className="w-40" aria-label={t("orders.list.filter.state")} data-testid="filter-state">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATES}>{t("orders.list.filter.allStates")}</SelectItem>
          {ORDER_STATES.map((state) => (
            <SelectItem key={state} value={state}>
              {t(`orders.state.${state}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.datasource}
        onValueChange={(value) => { onChange({ datasource: value ?? ALL_DATASOURCES }); }}
      >
        <SelectTrigger
          className="w-40"
          aria-label={t("orders.list.filter.datasource")}
          data-testid="filter-datasource"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_DATASOURCES}>{t("orders.list.filter.allDatasources")}</SelectItem>
          {datasourceOptions.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        value={filters.submittedFrom}
        onChange={(event) => { onChange({ submittedFrom: event.target.value }); }}
        aria-label={t("orders.list.filter.from")}
        className="w-36"
        data-testid="filter-submitted-from"
      />
      <Input
        type="date"
        value={filters.submittedTo}
        onChange={(event) => { onChange({ submittedTo: event.target.value }); }}
        aria-label={t("orders.list.filter.to")}
        className="w-36"
        data-testid="filter-submitted-to"
      />
      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={onReset} data-testid="filter-reset">
          <FilterX className="size-4" aria-hidden />
          {t("orders.list.filter.reset")}
        </Button>
      )}
    </div>
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

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);

  // The keyword param is debounced; the select/date inputs commit directly.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((previous) =>
        previous.q === previous.keywordInput.trim()
          ? previous
          : { ...previous, q: previous.keywordInput.trim() },
      );
    }, KEYWORD_DEBOUNCE_MS);
    return () => { clearTimeout(timer); };
  }, [filters.keywordInput]);

  const patchFilters = (patch: Partial<FilterState>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  const serverFilters: OrderListFilters = {
    q: filters.q === "" ? undefined : filters.q,
    state: filters.state === ALL_STATES ? undefined : (filters.state as ChangeOrderState),
    datasource: filters.datasource === ALL_DATASOURCES ? undefined : filters.datasource,
    submitted_from: filters.submittedFrom === "" ? undefined : filters.submittedFrom,
    submitted_to: filters.submittedTo === "" ? undefined : filters.submittedTo,
  };

  const draftsQuery = useMyDrafts(true);
  const ordersQuery = useMyChangeOrders(true, serverFilters);
  const datasourceOptionsQuery = useOrderDatasourceOptions(true);

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
                <CardContent className="flex flex-col gap-3">
                  <MineOrderFilters
                    filters={filters}
                    datasourceOptions={datasourceOptionsQuery.data ?? []}
                    onChange={patchFilters}
                    onReset={() => { setFilters(INITIAL_FILTERS); }}
                  />
                  {(ordersQuery.data ?? []).length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center text-sm" data-testid="orders-empty">
                      {hasActiveFilters(filters)
                        ? t("orders.list.filter.emptyFiltered")
                        : t("orders.list.ordersEmpty")}
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
          <QueryOrdersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
