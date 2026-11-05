import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
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
  type OrderListScope,
} from "@/features/orders/use-orders";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import { OrderStateBadge } from "@/features/orders/order-state-badge";
import { QueryOrdersTab } from "@/routes/changes/query-orders-tab";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { ListToolbar, PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import {
  GlobalSearchBar,
  type SearchFieldDef,
  type SearchTerm,
} from "@/shared/components/global-search-bar";
import { ORDER_STATES } from "@/features/orders/order-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { TAB_PANEL_VARIANTS, TransitionPanel } from "@/shared/components/ui/transition-panel";
import { ArrowRight, FileStack, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteChangeDraft } from "@/api/generated/client/change-drafts/change-drafts";
import { describeError } from "@/shared/api/error-display";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

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

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function DraftRow({ draft, onDelete }: { draft: ChangeDraft; onDelete: (draft: ChangeDraft) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { void navigate(`/changes/drafts/${draft.id}`); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") void navigate(`/changes/drafts/${draft.id}`);
      }}
      className="group focus-visible:ring-ring/50 hover:border-border hover:bg-muted/40 focus-visible:border-ring flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-[background-color,border-color] duration-150 ease-out focus-visible:ring-[3px]"
      data-testid="mine-draft-row"
    >
      <span className="bg-secondary text-secondary-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        <FileStack className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {draft.title}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {t("orders.list.draftsUpdated", { time: formatTimestamp(draft.updated_at) })}
        </span>
      </span>
      {/* RCP-20261101：草稿列表不再有审核状态列——draft.state 只剩
          draft|submitted，提交即离开草稿列表，无需徽章。 */}
      {/* 草稿删除 (owner ruling 2026-10-24): the list row carries the only
          delete affordance; the confirm dialog lives at the card level. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive focus-visible:opacity-100 pointer-coarse:opacity-100 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
        aria-label={t("orders.list.draftsDelete")}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(draft);
        }}
        data-testid={`delete-draft-${draft.id}`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <ArrowRight
        className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
        aria-hidden
      />
    </div>
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
      data-row-key={order.id}
    >
      <TableCell className="font-semibold text-foreground">{order.display_number}</TableCell>
      <TableCell className="max-w-56 truncate font-semibold text-foreground">{order.title}</TableCell>
      <TableCell>
        <OrderStateBadge state={order.state} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {order.current_stage_position === null
          ? "—"
          : t("orders.list.stagePosition", { position: order.current_stage_position })}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatTimestamp(order.submitted_at)}
      </TableCell>
      <TableCell className="text-right">
        {/* Reference ruling 2026-10-24: a navigation table ends with a quiet
            right-aligned affordance, not a labeled button; the row itself
            navigates and this echoes it. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t("orders.list.open")}
          onClick={(event) => {
            event.stopPropagation();
            void navigate(`/changes/orders/${order.id}`);
          }}
          data-testid={`open-order-${order.display_number}`}
        >
          <ArrowRight aria-hidden />
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
}

const INITIAL_FILTERS: FilterState = {
  keywordInput: "",
  q: "",
  state: ALL_STATES,
  datasource: ALL_DATASOURCES,
  submittedFrom: "",
};

function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q !== "" ||
    filters.state !== ALL_STATES ||
    filters.datasource !== ALL_DATASOURCES ||
    filters.submittedFrom !== ""
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

  const patchFilters = (patch: Partial<FilterState>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  // ECS-style global search (owner feedback 2026-11-04 + 2026-11-05): the ONE
  // search box owns every server filter — free text maps to the q param
  // (matches 工单号+标题 server-side), and 状态 / 数据源 / 提交起始日期 chips
  // map to the state / datasource / submitted_from params (owner feedback:
  // 提交截止时间 is not needed in the search box). The old datasource Select
  // and date pickers are gone; the bar's clear-all resets all params in one
  // gesture. Mapping happens in the event handlers (not an effect):
  // onTermsChange fires before the bar's trailing onLiveChange, and the ref
  // keeps the committed any-chip visible to both handlers within one batch.
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  const committedTermsRef = useRef<SearchTerm[]>([]);
  const lastAnyText = (terms: readonly SearchTerm[]): string =>
    [...terms].reverse().find((term) => term.field === null)?.text ?? "";
  const textOf = (terms: readonly SearchTerm[], field: string): string =>
    [...terms].reverse().find((term) => term.field === field)?.text ?? "";
  const stateOfTerms = (terms: readonly SearchTerm[]): string => {
    const label = [...terms].reverse().find((term) => term.field === "state")?.text;
    return label === undefined
      ? ALL_STATES
      : ORDER_STATES.find((candidate) => t(`orders.state.${candidate}`) === label) ?? ALL_STATES;
  };
  const handleTermsChange = (next: SearchTerm[]): void => {
    committedTermsRef.current = next;
    setSearchTerms(next);
    patchFilters({
      keywordInput: lastAnyText(next),
      state: stateOfTerms(next),
      datasource: textOf(next, "datasource") || ALL_DATASOURCES,
      submittedFrom: textOf(next, "submitted_from"),
    });
  };
  const handleLiveChange = (live: SearchTerm | null): void => {
    // Live any-field text wins while typing; a scoped draft (状态 value) is
    // chip-only; an emptied input falls back to the committed any-chip.
    const keyword =
      live !== null && live.field === null ? live.text : lastAnyText(committedTermsRef.current);
    patchFilters({ keywordInput: keyword });
  };

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

  const serverFilters: OrderListFilters = {
    q: filters.q === "" ? undefined : filters.q,
    state: filters.state === ALL_STATES ? undefined : (filters.state as ChangeOrderState),
    datasource: filters.datasource === ALL_DATASOURCES ? undefined : filters.datasource,
    submitted_from: filters.submittedFrom === "" ? undefined : filters.submittedFrom,
  };

  // F-UX-004：工作台「待我执行」卡携带 ?scope=execution 到达——同一
  // 关系范围读改为执行人待办视图（展示过滤，见useMyChangeOrders）。
  const [searchParams] = useSearchParams();
  const orderScope: OrderListScope = searchParams.get("scope") === "execution" ? "execution" : "submitter";

  const draftsQuery = useMyDrafts(true);
  const ordersPager = useCursorPage(20);
  const ordersQuery = useMyChangeOrders(
    true,
    serverFilters,
    { limit: ordersPager.pageSize, after: ordersPager.after },
    orderScope,
  );
  const ordersPageMeta = ordersQuery.data?.page;
  const orderItems = ordersQuery.data?.items ?? [];
  // 筛选之后仍留在列表里的行换了位置：记录旧位置再补间，而不是瞬跳。
  const ordersBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(orderItems.map((order) => order.id)),
  );
  // §18.82：先于穷尽三元捕获，避免收窄泄漏进分页守卫。
  const ordersLoaded = !ordersQuery.isPending && !ordersQuery.isError;
  // keepPreviousData 会先展示上一页/上一关键词的行；在表体自证过期，避免点击旧行。
  const ordersStale = ordersQuery.isFetching && ordersQuery.isPlaceholderData;
  const datasourceOptionsQuery = useOrderDatasourceOptions(true);
  const searchFields = useMemo<SearchFieldDef[]>(
    () => [
      {
        key: "state",
        label: t("orders.list.column.state"),
        options: ORDER_STATES.map((state) => ({
          label: t(`orders.state.${state}`),
        })),
      },
      {
        key: "datasource",
        label: t("orders.list.filter.datasourceField"),
        options: (datasourceOptionsQuery.data ?? []).map((name) => ({ label: name })),
      },
      { key: "submitted_from", label: t("orders.list.filter.from"), input: "date" },
    ],
    [t, datasourceOptionsQuery.data],
  );

  const draftsError = draftsQuery.error ?? ordersQuery.error;

  // 草稿删除 (owner ruling 2026-10-24): the drafts card is the surface —
  // confirm dialog at card level, DELETE with the row's If-Match version.
  const [pendingDelete, setPendingDelete] = useState<ChangeDraft | null>(null);
  const queryClient = useQueryClient();
  const deleteDraftMutation = useMutation({
    mutationFn: (draft: ChangeDraft) =>
      deleteChangeDraft(draft.id, {
        headers: { "If-Match": `"${String(draft.version)}"` },
      }),
    onSuccess: () => {
      toast.success(t("orders.list.draftsDeleted"));
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["change-drafts", "mine"] });
    },
    onError: (error) => {
      const display = describeError(error, "deleteChangeDraft");
      toast.error(t(display.messageKey));
    },
  });
  const retry = (): void => {
    void draftsQuery.refetch();
    void ordersQuery.refetch();
  };
  // tabs-02 reference (owner ruling 2026-10-24): a controlled tab pair so the
  // content switch runs through TransitionPanel's slide+blur motion.
  const [mineTab, setMineTab] = useState<"audit" | "query">("audit");

  return (
    <PageLayout data-testid="mine-page">
      <PageHeader
        icon={FileStack}
        title={t("orders.list.title")}
        description={t("orders.list.description")}
        actions={
          <Tabs
            value={mineTab}
            onValueChange={(next) => { setMineTab(next === "query" ? "query" : "audit"); }}
          >
            <TabsList>
              <TabsTrigger value="audit" data-testid="tab-audit-orders">
                {t("orders.list.auditTab")}
              </TabsTrigger>
              <TabsTrigger value="query" data-testid="tab-query-orders">
                {t("orders.list.queryTab")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <TransitionPanel
        activeIndex={mineTab === "audit" ? 0 : 1}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        variants={TAB_PANEL_VARIANTS}
      >
        <div className="flex flex-col gap-5">
          {draftsError !== null && (
            <ErrorState error={draftsError} operationId="listChangeOrders" onRetry={retry} />
          )}
          {draftsError === null && (draftsQuery.isPending || ordersQuery.isPending) && (
            <LoadingState variant="table" columns={6} />
          )}
          {draftsError === null && !draftsQuery.isPending && !ordersQuery.isPending && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("orders.list.draftsCard")}</CardTitle>
                  <CardDescription>
                    {(draftsQuery.data ?? []).length === 0
                      ? t("orders.list.draftsCardIdle")
                      : t("orders.list.draftsCardDescription", {
                          total: (draftsQuery.data ?? []).length,
                        })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {(draftsQuery.data ?? []).length === 0 && (
                    <EmptyState title={t("orders.list.draftsEmpty")} />
                  )}
                  {(draftsQuery.data ?? []).map((draft) => (
                    <DraftRow key={draft.id} draft={draft} onDelete={setPendingDelete} />
                  ))}
                </CardContent>
                {/* Delete confirmation (owner ruling 2026-10-24): the draft,
                 * its SQL and its review records go in one transaction — the
                 * dialog says so before the irreversible call. */}
                <Dialog
                  open={pendingDelete !== null}
                  onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                  }}
                >
                  <DialogContent data-testid="delete-draft-dialog">
                    <DialogHeader>
                      <DialogTitle>{t("orders.list.draftsDeleteTitle")}</DialogTitle>
                      <DialogDescription>
                        {t("orders.list.draftsDeleteDescription")}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => { setPendingDelete(null); }}
                        data-testid="delete-draft-cancel"
                      >
                        {t("common.cancel")}
                      </Button>
                      <PendingButton
                        variant="destructive"
                        pending={deleteDraftMutation.isPending}
                        onClick={() => {
                          if (pendingDelete !== null) deleteDraftMutation.mutate(pendingDelete);
                        }}
                        data-testid="delete-draft-accept"
                      >
                        {t("orders.list.draftsDeleteAction")}
                      </PendingButton>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Card>
              {/* overflow-visible (review R2 H1): the search bar's suggestion
                  listbox and inline calendar extend below the card in empty or
                  1-row states; the default Card overflow-hidden would clip
                  late-month calendar days and make them unclickable. */}
              <Card className="overflow-visible">
                <ListToolbar busy={ordersStale} fill>
                  <CardTitle>{t("orders.list.ordersCard")}</CardTitle>
                  {/* Owner feedback 2026-11-04 + 2026-11-05: ONE full-width
                      ECS-style search box replaces every filter control —
                      工单号/标题 free text via the server q param, plus 状态/
                      数据源 enum chips and 提交起始日期 calendar chip mapped
                      to their server params (提交截止日期 is intentionally
                      omitted). The bar's clear-all is the single reset
                      affordance. */}
                  <GlobalSearchBar
                    fields={searchFields}
                    terms={searchTerms}
                    onTermsChange={handleTermsChange}
                    onLiveChange={handleLiveChange}
                    placeholder={t("orders.list.filter.searchPlaceholder")}
                    testId="filter-keyword"
                    className="w-full min-w-0 flex-1"
                  />
                </ListToolbar>
                <CardContent className="flex flex-col gap-3 px-0!">
                  {(ordersQuery.data?.items ?? []).length === 0 ? (
                    <EmptyState
                      filtered={hasActiveFilters(filters)}
                      title={
                        hasActiveFilters(filters)
                          ? t("orders.list.filter.emptyFiltered")
                          : orderScope === "execution"
                            ? t("orders.list.executionEmpty")
                            : t("orders.list.ordersEmpty")
                      }
                      testId="orders-empty"
                    />
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
                      <TableBody ref={ordersBodyRef} stale={ordersStale}>
                        {orderItems.map((order) => (
                          <OrderRow key={order.id} order={order} />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {ordersLoaded ? (
                    <TablePagination
                      busy={ordersStale}
                      page={ordersPager.pageNo}
                      hasMore={ordersPageMeta?.has_more ?? false}
                      isFirst={ordersPager.pageNo === 1}
                      onPrev={() => {
                        ordersPager.goPrev();
                      }}
                      onJumpPage={ordersPager.goToPage}
                      onNext={() => {
                        ordersPager.pushCursor(ordersPageMeta?.next_cursor);
                      }}
                      pageSize={ordersPager.pageSize}
                      onPageSizeChange={ordersPager.setPageSize}
                      rowsOnPage={orderItems.length}
                      testIdPrefix="mine-orders"
                    />
                  ) : null}
                </CardContent>
              </Card>
            </>
          )}
        </div>
        <div>
          <QueryOrdersTab />
        </div>
      </TransitionPanel>
    </PageLayout>
  );
}
