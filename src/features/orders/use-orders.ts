import { useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChangeDraft,
  ChangeOrder,
  ChangeOrderState,
  ChangeOrderTimelineEntry,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  getChangeOrder,
  listChangeOrders,
} from "@/api/generated/client/change-orders/change-orders";
import {
  copyChangeOrderToDraft,
  listChangeOrderTimeline,
  voidChangeOrder,
  withdrawChangeOrder,
} from "@/api/generated/client/change-orders/change-orders";
import { getReviewEventClient, useDomainEvent } from "@/shared/events/review-event-client";
import { useSession } from "@/features/auth/session-provider";

/**
 * Server-state hooks for the personal order pages (frontend PRD F6). Events
 * are notifications only — every handler re-reads the HTTP resource, so
 * at-least-once redelivery can never duplicate rows (acceptance gate
 * 列表事件无重复 lives in the client dedup + full refetch, not in list
 * merging).
 */

/** Server-side list filters (RCP-20260831-ORDER-LIST-FILTER contract
 * surface). All filters narrow the submitter-scoped result on the server —
 * the UI never filters client-side, which would fight cursor paging and the
 * event-driven re-read semantics. */
export interface OrderListFilters {
  state?: ChangeOrderState;
  q?: string;
  datasource?: string;
  submitted_from?: string;
  submitted_to?: string;
}

const EMPTY_FILTERS: OrderListFilters = {};

function activeFilters(filters: OrderListFilters): OrderListFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export function useMyChangeOrders(enabled: boolean, filters: OrderListFilters = EMPTY_FILTERS) {
  const queryClient = useQueryClient();
  const session = useSession();
  const me = session.user?.id;
  const effective = activeFilters(filters);
  const query = useQuery({
    // The filter object joins the key so every filter change is a fresh
    // server read, never a stale-cache hit. keepPreviousData holds the last
    // rows (and keeps this hook's consumers mounted) while a first-time
    // filter combination is in flight. The user id joins the key so the
    // submitter filter below never runs against a half-initialized session.
    queryKey: ["change-orders", "mine", me, effective],
    queryFn: async () => {
      // The list endpoint is relation-scoped (submitter / frozen approval
      // actor / frozen execution actor — backend relationFilterSQL, consumed
      // by the approval queue on the same read). The 我的工单 tab is
      // submitter-scoped per UI-spec §5.2: a presentation filter on this
      // shared read, never an authorization boundary.
      const page = (await listChangeOrders({
        limit: 50,
        ...effective,
      })) as unknown as {
        items: ChangeOrder[];
      };
      if (me === undefined) return [];
      return page.items.filter((order) => order.submitter_user_id === me);
    },
    enabled: enabled && me !== undefined,
    placeholderData: keepPreviousData,
  });

  // The event client routes by exact aggregate subject, so the list page
  // subscribes to the subjects it has actually loaded. keepPreviousData holds
  // the previous read through a filter transition, so the subscription set
  // never drops while a new filter key loads — ingest() cannot advance past
  // undelivered events in that window. New orders arrive through normal
  // invalidation on navigation — the submission flow lands on the detail
  // page and back-navigation remounts this query.
  const orders = query.data;
  const subscriptionKey =
    orders === undefined ? "" : orders.map((order) => `${order.id}:${String(order.version)}`).join("|");
  useEffect(() => {
    if (subscriptionKey === "") return;
    const client = getReviewEventClient();
    const unsubscribes = (orders ?? []).map((order) =>
      client.subscribe(`change-orders/${order.id}`, () => {
        void queryClient.invalidateQueries({ queryKey: ["change-orders", "mine"] });
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [subscriptionKey, orders, queryClient]);

  return query;
}

/**
 * Datasource options for the filter select, taken from one unfiltered read
 * of the submitter's orders — filter interactions must not shrink the
 * option set.
 */
export function useOrderDatasourceOptions(enabled: boolean) {
  const session = useSession();
  const me = session.user?.id;
  return useQuery({
    queryKey: ["change-orders", "mine", "datasource-options", me],
    queryFn: async () => {
      const page = (await listChangeOrders({ limit: 200 })) as unknown as {
        items: ChangeOrder[];
      };
      if (me === undefined) return [];
      return [
        ...new Set(
          page.items
            .filter((order) => order.submitter_user_id === me)
            .flatMap((order) => order.stages.map((stage) => stage.datasource_name)),
        ),
      ];
    },
    enabled: enabled && me !== undefined,
  });
}

export function useChangeOrder(orderId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["change-order", orderId],
    queryFn: async () => (await getChangeOrder(orderId)) as unknown as ChangeOrder,
  });

  useDomainEvent(
    orderId === "" ? null : `change-orders/${orderId}`,
    "any",
    () => {
      void queryClient.invalidateQueries({ queryKey: ["change-order", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["change-order-timeline", orderId] });
    },
  );

  return query;
}

export function useChangeOrderTimeline(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["change-order-timeline", orderId],
    queryFn: async () => {
      const page = (await listChangeOrderTimeline(orderId, { limit: 50 })) as unknown as {
        items: ChangeOrderTimelineEntry[];
      };
      return page.items;
    },
    enabled: enabled && orderId !== "",
  });
}

function orderActionHeaders(order: ChangeOrder | null | undefined): Record<string, string> {
  // Both headers are declared required on withdrawal/voidance (OpenAPI
  // IdempotencyKey parameter; order_lifecycle profile carries the
  // idempotency codes) — If-Match guards the aggregate version.
  return {
    "If-Match": `"${String(order?.version ?? 1)}"`,
    "Idempotency-Key": `order-action-${crypto.randomUUID()}`,
  };
}

export function useWithdrawOrder(order: ChangeOrder | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      withdrawChangeOrder(order?.id as string, { reason }, { headers: orderActionHeaders(order) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["change-order", order?.id] });
      void queryClient.invalidateQueries({ queryKey: ["change-order-timeline", order?.id] });
      void queryClient.invalidateQueries({ queryKey: ["change-orders", "mine"] });
    },
  });
}

export function useVoidOrder(order: ChangeOrder | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      voidChangeOrder(order?.id as string, { reason }, { headers: orderActionHeaders(order) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["change-order", order?.id] });
      void queryClient.invalidateQueries({ queryKey: ["change-order-timeline", order?.id] });
      void queryClient.invalidateQueries({ queryKey: ["change-orders", "mine"] });
    },
  });
}

export function useCopyOrderToDraft(order: ChangeOrder | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { target_flow_id: string; title: string; description?: string }) =>
      copyChangeOrderToDraft(order?.id as string, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["change-drafts"] });
    },
  });
}

/** Draft catalog for the 我的工单 split (migration contract §2: 草稿和已提交
 * 工单分离). Reuses the draft list endpoint already exercised by F4. */
export function useMyDrafts(enabled: boolean) {
  return useQuery({
    queryKey: ["change-drafts", "mine"],
    queryFn: async () => {
      const { listChangeDrafts } = await import(
        "@/api/generated/client/change-drafts/change-drafts"
      );
      const page = (await listChangeDrafts({ limit: 50 })) as unknown as {
        items: ChangeDraft[];
      };
      // A submitted draft is terminal — its order lives in the orders card,
      // and the draft-phase vocabulary has no honest label for it.
      return page.items.filter((draft) => draft.state !== "submitted");
    },
    enabled,
  });
}
