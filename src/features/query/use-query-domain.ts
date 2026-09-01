import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-provider";
import {
  closeQuerySession,
  createQuerySession,
  executeSelect,
  fetchQueryResultPage,
  getQuerySession,
  listQuerySessions,
} from "@/api/generated/client/query-sessions/query-sessions";
import {
  createQueryAccessRequest,
  decideQueryAccess,
  listQueryAccessRequests,
  listQueryGrants,
  relinquishQueryGrant,
  revokeQueryGrant,
  withdrawQueryAccessRequest,
} from "@/api/generated/client/query-access/query-access";
import {
  listQuerySessionColumns,
  listQuerySessionSchemas,
  listQuerySessionTables,
} from "@/api/generated/client/query-sessions/query-sessions";
import type {
  ApprovalDecisionRequest,
  PageInfo,
  CreateQueryAccessRequest as CreateQueryAccessRequestBody,
  CreateQuerySession as CreateQuerySessionBody,
  DatasourceColumn,
  DatasourceSchema,
  DatasourceTable,
  ExecuteQueryRequest,
  Flow,
  QueryAccessRequest,
  QueryGrant,
  QueryResultPage,
  QuerySession,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Server-state hooks for the query domain (work package FE-F10). Query
 * reads are relation-scoped server-side (owner / frozen reviewer), so the
 * hooks never filter — they consume exactly what the declared OpenAPI
 * returns. Mutations carry If-Match (row version) and the Idempotency-Key
 * header exactly where the frozen OpenAPI declares it.
 */

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `idem-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
}

function ifMatch(version: number | undefined): Record<string, string> {
  return { "If-Match": `"${String(version ?? 1)}"` };
}

function itemsOf<T>(data: { items?: T[] } | undefined | null): T[] {
  return data?.items ?? [];
}

/** Relation-scoped reads are user-bound server-side; keying by the session
 * user keeps a mid-session identity flip from serving the previous user's
 * cached lists (F6 mine-tab precedent). */
function useSessionUserKey(): string {
  return useSession().user?.id ?? "anonymous";
}

// ---- flow catalog / entry ------------------------------------------------

export function useMyQueryFlows(enabled: boolean) {
  return useQuery({
    queryKey: ["query", "actor", useSessionUserKey(), "my-flows"],
    queryFn: async () => {
      const { listCurrentUserFlows } = await import(
        "@/api/generated/client/change-drafts/change-drafts"
      );
      const response = (await listCurrentUserFlows({ flow_type: "query_access" })) as unknown as {
        items?: Flow[];
      };
      return itemsOf<Flow>(response);
    },
    enabled,
  });
}

// ---- access requests & grants -------------------------------------------

export function useMyAccessRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["query", "actor", useSessionUserKey(), "access-requests"],
    queryFn: async () => {
      const response = (await listQueryAccessRequests({ limit: 100 })) as unknown as {
        items?: QueryAccessRequest[];
      };
      return itemsOf<QueryAccessRequest>(response);
    },
    enabled,
  });
}

export function useMyGrants(enabled: boolean) {
  return useQuery({
    queryKey: ["query", "actor", useSessionUserKey(), "grants"],
    queryFn: async () => {
      const response = (await listQueryGrants({ limit: 100 })) as unknown as {
        items?: QueryGrant[];
      };
      return itemsOf<QueryGrant>(response);
    },
    enabled,
  });
}

export function useCreateAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateQueryAccessRequestBody) => {
      return (await createQueryAccessRequest(body, {
        headers: { "Idempotency-Key": newIdempotencyKey() },
      })) as unknown as QueryAccessRequest;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

export function useWithdrawAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; version: number; reason: string }) => {
      return (await withdrawQueryAccessRequest(input.requestId, { reason: input.reason }, {
        headers: {
          "Idempotency-Key": newIdempotencyKey(),
          ...ifMatch(input.version),
        },
      })) as unknown as QueryAccessRequest;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

export function useDecideAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      version: number;
      body: ApprovalDecisionRequest;
    }) => {
      return (await decideQueryAccess(input.requestId, input.body, {
        headers: {
          "Idempotency-Key": newIdempotencyKey(),
          ...ifMatch(input.version),
        },
      })) as unknown as QueryAccessRequest;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

export function useRevokeGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; version: number; reason: string }) => {
      return (await revokeQueryGrant(input.grantId, { reason: input.reason }, {
        headers: {
          "Idempotency-Key": newIdempotencyKey(),
          ...ifMatch(input.version),
        },
      })) as unknown as QueryGrant;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

export function useRelinquishGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; version: number; reason: string }) => {
      return (await relinquishQueryGrant(input.grantId, { reason: input.reason }, {
        headers: {
          "Idempotency-Key": newIdempotencyKey(),
          ...ifMatch(input.version),
        },
      })) as unknown as QueryGrant;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

// ---- sessions ------------------------------------------------------------

export function useMySessions(enabled: boolean) {
  return useQuery({
    queryKey: ["query", "actor", useSessionUserKey(), "sessions"],
    queryFn: async () => {
      const response = (await listQuerySessions({ limit: 100 })) as unknown as {
        items?: QuerySession[];
      };
      return itemsOf<QuerySession>(response);
    },
    enabled,
  });
}

export function useQuerySession(sessionId: string, enabled: boolean, pollWhileActive: boolean) {
  return useQuery({
    queryKey: ["query", "session", sessionId],
    queryFn: async () => {
      return (await getQuerySession(sessionId)) as unknown as QuerySession;
    },
    enabled: enabled && sessionId !== "",
    retry: false,
    // Grant revocation reaches the workspace through this re-read (the
    // query domain has no frontend event transport; in-flight queries fail
    // with 4004 and the interval flips the session state quickly).
    refetchInterval: (query) =>
      pollWhileActive && query.state.data?.state === "active" ? 5000 : false,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateQuerySessionBody) => {
      return (await createQuerySession(body)) as unknown as QuerySession;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

export function useCloseSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; reason: string }) => {
      return (await closeQuerySession(input.sessionId, { reason: input.reason }, {
        headers: { "Idempotency-Key": newIdempotencyKey() },
      })) as unknown as QuerySession;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    },
  });
}

// ---- metadata ------------------------------------------------------------

export function useSessionSchemas(sessionId: string, datasourceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["query", "session", sessionId, "schemas", datasourceId],
    queryFn: async () => {
      const response = (await listQuerySessionSchemas(sessionId, {
        datasource_id: datasourceId,
      })) as unknown as DatasourceSchema[];
      return response;
    },
    enabled: enabled && sessionId !== "" && datasourceId !== "",
    staleTime: 60_000,
  });
}

export function useSessionTables(
  sessionId: string,
  datasourceId: string,
  schemaName: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["query", "session", sessionId, "tables", datasourceId, schemaName],
    queryFn: async () => {
      const response = (await listQuerySessionTables(sessionId, {
        datasource_id: datasourceId,
        schema_name: schemaName,
      })) as unknown as DatasourceTable[];
      return response;
    },
    enabled: enabled && sessionId !== "" && datasourceId !== "" && schemaName !== "",
    staleTime: 60_000,
  });
}

export function useSessionColumns(
  sessionId: string,
  datasourceId: string,
  schemaName: string,
  tableName: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["query", "session", sessionId, "columns", datasourceId, schemaName, tableName],
    queryFn: async () => {
      const response = (await listQuerySessionColumns(sessionId, {
        datasource_id: datasourceId,
        schema_name: schemaName,
        table_name: tableName,
      })) as unknown as DatasourceColumn[];
      return response;
    },
    enabled:
      enabled && sessionId !== "" && datasourceId !== "" && schemaName !== "" && tableName !== "",
    staleTime: 60_000,
  });
}

// ---- executions & cursor pages ------------------------------------------

export const DISPLAY_PAGE_SIZE = 500;
export const EXPORT_PAGE_SIZE = 1000;

export async function runSelect(
  sessionId: string,
  body: ExecuteQueryRequest,
): Promise<QueryResultPage> {
  return (await executeSelect(sessionId, body)) as unknown as QueryResultPage;
}

export async function fetchPage(
  executionId: string,
  cursor: string,
  purpose: "display" | "export",
): Promise<QueryResultPage> {
  // The frozen contract declares no page-size parameter on the continuation
  // endpoint — the cursor keeps the page size it was opened with
  // (display pages 500, export pages 1000).
  return (await fetchQueryResultPage(executionId, {
    cursor,
    purpose,
  })) as unknown as QueryResultPage;
}

/** Page-info helper for callers that only need the continuation token. */
export function nextCursorOf(page: QueryResultPage): string | null {
  return ((page as { page?: PageInfo }).page?.next_cursor as string | null) ?? null;
}
