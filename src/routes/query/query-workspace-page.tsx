import i18next from "@/shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Database,
  Download,
  History,
  LogOut,
  Play,
  ShieldAlert,
  X,
} from "lucide-react";
import type { QueryGrant, QueryResultPage } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Progress } from "@/shared/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { SqlEditorPanel } from "@/features/review/sql-editor-panel";
import { MetadataTree } from "@/features/query/metadata-tree";
import { ResultGrid, maskedMapFrom, type ResultTabState } from "@/features/query/result-grid";
import {
  DISPLAY_PAGE_SIZE,
  EXPORT_PAGE_SIZE,
  fetchPage,
  runSelect,
  useCloseSession,
  useMyGrants,
  useQuerySession,
  useSessionColumns,
} from "@/features/query/use-query-domain";
import {
  downloadXlsx,
  exportExecutionToXlsx,
  type ExportProgress,
} from "@/features/query/xlsx-export";

/**
 * Query Workspace (route /query/sessions/:id; migration contract §5).
 *
 * The session's frozen capability set is the datasource scope: switching
 * datasources stays inside it (UI spec §7.5), the tree exposes schemas →
 * tables → columns through the metadata endpoints, and one editor serves
 * single-SELECT statements. Client-side single-SELECT detection is a hint
 * only — the server's Query Safety Check is authoritative (4007 renders
 * inline).
 *
 * Grant lifecycle surfaces: the banner shows the active grant's remaining
 * validity with renewal and relinquish entries; a revocation flips the
 * session state (5s re-read + in-flight 4004) into a non-dismissible
 * blocked notice carrying the reason. Revocation actor/time are not part
 * of the frozen read contract — the RCP-pending gap is recorded in the
 * migration contract §17; 我的工单-查询工单 remains the authoritative
 * detail view.
 */

interface HistoryEntry {
  id: string;
  sql: string;
  schemaName: string;
  datasourceName: string;
  elapsedMs: number | null;
  at: string;
  failed: boolean;
}

const HISTORY_LIMIT = 100;

export default function QueryWorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sessionId = "" } = useParams();
  const session = useSession();
  const authenticated = session.status === "authenticated";

  const sessionQuery = useQuerySession(sessionId, authenticated, true);
  const grantsQuery = useMyGrants(authenticated);

  // A revocation reaches this page through the session poll; the grants
  // list (the reason source) must re-read at the same moment or the notice
  // falls back to the generic copy.
  useEffect(() => {
    if (sessionQuery.data?.state === "revoked") {
      void queryClient.invalidateQueries({ queryKey: ["query"] });
    }
  }, [queryClient, sessionQuery.data?.state]);
  const closeSession = useCloseSession();

  const row = sessionQuery.data ?? null;
  const [datasourceId, setDatasourceId] = useState<string>("");
  const [schemaName, setSchemaName] = useState("");
  const [sql, setSql] = useState("SELECT ");
  const [loadValue, setLoadValue] = useState<{ text: string; nonce: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<ResultTabState[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [continuationErrors, setContinuationErrors] = useState<Record<string, string | null>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [leftPanel, setLeftPanel] = useState<"tree" | "history">("tree");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [exportContext, setExportContext] = useState<ExportContext | null>(null);

  // Default datasource: first capability once the session loads.
  useEffect(() => {
    if (row === null || row.capabilities.length === 0) return;
    setDatasourceId((current) => {
      const first = row.capabilities[0];
      if (current !== "" && row.capabilities.some((capability) => capability.datasource_id === current)) {
        return current;
      }
      return first === undefined ? current : first.datasource_id;
    });
  }, [row]);

  const capability = useMemo(
    () => row?.capabilities.find((item) => item.datasource_id === datasourceId) ?? null,
    [datasourceId, row],
  );

  // The masked-column cross reference: loaded for the active schema/table
  // selection is impractical per query, so the workspace consults the
  // columns endpoint for the queried table after each run (best-effort,
  // metadata is live while run masking is frozen server-side).
  const [lastQueriedTable, setLastQueriedTable] = useState("");
  const columnsQuery = useSessionColumns(
    sessionId,
    datasourceId,
    schemaName,
    lastQueriedTable,
    authenticated && row?.state === "active" && lastQueriedTable !== "",
  );
  const maskedByName = useMemo(() => maskedMapFrom(columnsQuery.data), [columnsQuery.data]);

  const activeGrant: QueryGrant | null = useMemo(() => {
    const active = (grantsQuery.data ?? []).filter((grant) => grant.state === "active");
    if (active.length === 0) return null;
    return active.reduce((latest, current) => (current.created_at > latest.created_at ? current : latest));
  }, [grantsQuery.data]);

  const revokedGrant = useMemo(() => {
    const revoked = (grantsQuery.data ?? []).filter((grant) => grant.state === "revoked");
    if (revoked.length === 0) return null;
    return revoked.reduce((latest, current) => (current.created_at > latest.created_at ? current : latest));
  }, [grantsQuery.data]);

  const blocked = row !== null && row.state !== "active";
  // Per-datasource capability states (datasource_unavailable /
  // identity_changed) block runs and exports up-front with the reason
  // badge instead of surfacing only as a 3010 at execution time.
  const capabilityBlocked = capability !== null && capability.state !== "active";
  const insertTemplate = useCallback((nextSchema: string, tableName: string) => {
    const template = `SELECT *\nFROM ${nextSchema}.${tableName}\nLIMIT 100;`.replace(/;$/, "");
    setLoadValue({ text: template, nonce: Date.now() });
  }, []);

  const pushHistory = (entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current].slice(0, HISTORY_LIMIT));
  };

  const run = async () => {
    if (row === null || capability === null || schemaName === "") {
      setRunError(t("query.run.needSchema"));
      return;
    }
    setRunError(null);
    setRunning(true);
    const fromMatch = sql.match(/from\s+(?:`?([a-z_][a-z0-9_]*)`?\.)?`?([a-z_][a-z0-9_]*)`?/i);
    if (fromMatch !== null) setLastQueriedTable(fromMatch[2] ?? "");
    try {
      const page = await runSelect(sessionId, {
        datasource_id: datasourceId,
        schema_name: schemaName,
        sql,
        timeout_ms: 30000,
        page_size: DISPLAY_PAGE_SIZE,
      });
      const tab: ResultTabState = {
        executionId: page.execution_id,
        columns: page.columns,
        rows: [...page.rows],
        nextCursor: ((page as { page?: { next_cursor?: string | null } }).page?.next_cursor as string | null) ?? null,
        elapsedMs: page.elapsed_ms ?? null,
        exhausted: !((page as { page?: { has_more?: boolean } }).page?.has_more ?? false),
        maskedByName: new Map<string, boolean>(),
      };
      setTabs((current) => [tab, ...current].slice(0, 10));
      setActiveTab(tab.executionId);
      pushHistory({
        id: tab.executionId,
        sql,
        schemaName,
        datasourceName: capability.datasource_name,
        elapsedMs: tab.elapsedMs,
        at: new Date().toISOString(),
        failed: false,
      });
    } catch (error) {
      setRunError(describeErrorText(describeError(error, "executeSelect")));
      pushHistory({
        id: `failed-${String(Date.now())}`,
        sql,
        schemaName,
        datasourceName: capability.datasource_name,
        elapsedMs: null,
        at: new Date().toISOString(),
        failed: true,
      });
    } finally {
      setRunning(false);
    }
  };

  const loadMore = async (executionId: string) => {
    setLoadingMore(true);
    const tab = tabs.find((item) => item.executionId === executionId);
    if (tab === undefined || tab.nextCursor === null) {
      setLoadingMore(false);
      return;
    }
    try {
      const page: QueryResultPage = await fetchPage(executionId, tab.nextCursor, "display");
      setTabs((current) =>
        current.map((item) =>
          item.executionId === executionId
            ? {
                ...item,
                rows: [...item.rows, ...page.rows],
                nextCursor:
                  ((page as { page?: { next_cursor?: string | null } }).page?.next_cursor as string | null) ?? null,
                exhausted: !((page as { page?: { has_more?: boolean } }).page?.has_more ?? false),
              }
            : item,
        ),
      );
      setContinuationErrors((current) => ({ ...current, [executionId]: null }));
    } catch (error) {
      setContinuationErrors((current) => ({
        ...current,
        [executionId]: describeErrorText(describeError(error, "fetchQueryResultPage")),
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  // Refresh the masked column map for the active result tab's table when the
  // metadata response arrives (live vocabulary — see component doc).
  useEffect(() => {
    if (columnsQuery.data === undefined) return;
    setTabs((current) =>
      current.map((item) => (item.maskedByName.size === 0 ? { ...item, maskedByName } : item)),
    );
  }, [activeTab, columnsQuery.data, maskedByName]);

  if (sessionQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb title={t("nav.query")} />
        <LoadingState />
      </div>
    );
  }

  if (sessionQuery.error !== null) {
    return (
      <div className="flex flex-col gap-4" data-testid="query-workspace-error">
        <PageBreadcrumb title={t("nav.query")} />
        <ErrorState
          error={sessionQuery.error}
          operationId="getQuerySession"
          onRetry={() => void sessionQuery.refetch()}
        />
      </div>
    );
  }

  if (row === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb title={t("nav.query")} />
        <ErrorState error={new Error("session not found")} operationId="getQuerySession" onRetry={() => { void navigate("/query"); }} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-3" data-testid="query-workspace">
      <PageBreadcrumb title={t("query.workspace.title", { name: capability?.datasource_name ?? "" })} />

      {row.state === "revoked" && (
        <Alert variant="destructive" data-testid="query-revoked-notice">
          <ShieldAlert />
          <AlertTitle>{t("query.workspace.revokedTitle")}</AlertTitle>
          <AlertDescription>
            {revokedGrant !== null && revokedGrant.revoked_reason !== null
              ? t("query.workspace.revokedReason", { reason: revokedGrant.revoked_reason })
              : t("query.workspace.revokedGeneric")}
            {t("query.workspace.revokedSeeMine")}
          </AlertDescription>
        </Alert>
      )}
      {row.state === "closed" && (
        <Alert data-testid="query-closed-notice">
          <Ban />
          <AlertTitle>{t("query.workspace.closedTitle")}</AlertTitle>
          <AlertDescription>{t("query.workspace.closedDescription")}</AlertDescription>
        </Alert>
      )}
      {(row.state === "expired" || row.state === "user_deleted") && (
        <Alert variant="destructive" data-testid="query-expired-notice">
          <ShieldAlert />
          <AlertTitle>{t("query.workspace.expiredTitle")}</AlertTitle>
          <AlertDescription>{t("query.workspace.expiredDescription")}</AlertDescription>
        </Alert>
      )}

      {activeGrant !== null && (
        <div
          className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
          data-testid="query-grant-banner"
        >
          <Badge variant="secondary">{t("query.workspace.grantActive")}</Badge>
          <span>
            {t("query.workspace.grantExpires", {
              time: activeGrant.expires_at === null || activeGrant.expires_at === undefined
                ? "—"
                : new Date(activeGrant.expires_at).toLocaleString(),
            })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled
            title={t("query.workspace.renewHint")}
            data-testid="query-grant-renew-disabled"
          >
            {t("query.workspace.renew")}
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-3">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="pb-2">
            <Tabs value={leftPanel} onValueChange={(value) => { setLeftPanel(value as "tree" | "history"); }}>
              <TabsList className="w-full">
                <TabsTrigger value="tree" className="flex-1 text-xs" data-testid="query-left-tab-tree">
                  {t("query.workspace.treeTab")}
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 text-xs" data-testid="query-left-tab-history">
                  <History className="size-3" />
                  {t("query.workspace.historyTab")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="tree" className="mt-0 min-h-0">
                <div className="h-[calc(100vh-18rem)] min-h-0">
                  {row.state === "active" ? (
                    <MetadataTree session={row} activeDatasourceId={datasourceId} onTableSelected={insertTemplate} />
                  ) : (
                    <p className="text-muted-foreground p-3 text-xs">{t("query.workspace.treeBlocked")}</p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <div className="h-[calc(100vh-18rem)] overflow-y-auto">
                  {history.length === 0 && (
                    <p className="text-muted-foreground p-3 text-xs">{t("query.workspace.historyEmpty")}</p>
                  )}
                  {history.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setLoadValue({ text: entry.sql, nonce: Date.now() });
                        setLeftPanel("tree");
                      }}
                      className="hover:bg-accent block w-full truncate px-2 py-1.5 text-left font-mono text-[11px]"
                      title={entry.sql}
                      data-testid={`query-history-${entry.id}`}
                    >
                      <span className={entry.failed ? "text-destructive" : ""}>{entry.sql}</span>
                    </button>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardHeader>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardContent className="flex h-full min-h-0 flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="max-w-[240px] truncate font-mono text-xs">
                <Database className="size-3" />
                {capability?.datasource_name ?? datasourceId}
              </Badge>
              {capabilityBlocked && (
                <Badge variant="destructive" data-testid="query-capability-blocked">
                  {t(`query.capability.state.${(capability as { state: "datasource_unavailable" | "identity_changed" } | null)?.state ?? "datasource_unavailable"}`)}
                </Badge>
              )}
              <Input
                value={schemaName}
                onChange={(event) => { setSchemaName(event.target.value); }}
                placeholder={t("query.workspace.schemaPlaceholder")}
                className="h-8 w-40 font-mono text-xs"
                disabled={blocked}
                data-testid="query-schema-input"
              />
              <Button
                size="sm"
                onClick={() => void run()}
                disabled={running || blocked || capability === null || capabilityBlocked}
                data-testid="query-run"
              >
                <Play />
                {running ? t("query.run.running") : t("query.run.execute")}
              </Button>
              <span className="text-muted-foreground text-xs">{t("query.run.singleSelectHint")}</span>
              <div className="ml-auto flex items-center gap-2">
                {capability?.can_export === true && sql.trim() !== "" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={blocked || capabilityBlocked || schemaName === ""}
                    onClick={() => { setExportContext({ datasourceId, schemaName, sql }); }}
                    data-testid="query-export"
                  >
                    <Download />
                    {t("query.export.button")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => { setCloseOpen(true); }}
                  data-testid="query-exit"
                >
                  <LogOut />
                  {t("query.workspace.exit")}
                </Button>
              </div>
            </div>

            {/* Fixed-height chain (F5 virtualization lesson): Monaco must
                measure a stable box or its overlays spill over the result
                area once results render and the flex space shrinks. */}
            <div className="h-[34vh] min-h-[240px] shrink-0">
              <SqlEditorPanel value={sql} onChange={setSql} loadValue={loadValue} readOnly={blocked} data-testid="query-sql-editor" />
            </div>

            {runError !== null && (
              <Alert variant="destructive" className="py-2" data-testid="query-run-error">
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              {tabs.length === 0 ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-md border border-dashed text-xs">
                  {t("query.result.empty")}
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
                  <TabsList className="w-full overflow-x-auto">
                    {tabs.map((tab, index) => (
                      <TabsTrigger key={tab.executionId} value={tab.executionId} className="text-xs">
                        {t("query.result.tabTitle", { index: tabs.length - index })}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {tabs.map((tab) => (
                    <TabsContent key={tab.executionId} value={tab.executionId} className="min-h-0 flex-1">
                      <ResultGrid
                        tab={tab}
                        loadingMore={loadingMore}
                        onLoadMore={() => void loadMore(tab.executionId)}
                        continuationError={continuationErrors[tab.executionId] ?? null}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <CloseSessionDialog
        open={closeOpen}
        reason={closeReason}
        onReason={setCloseReason}
        onCancel={() => { setCloseOpen(false); }}
        onSubmit={() => {
          void closeSession
            .mutateAsync({ sessionId, reason: closeReason })
            .then(() => {
              setCloseOpen(false);
              void navigate("/query");
            })
            .catch(() => {
              // The dialog stays open; the mutation error renders via the
              // session re-read rather than a silent failure.
            });
        }}
        submitting={closeSession.isPending}
      />

      <ExportDialog context={exportContext} sessionId={sessionId} onClose={() => { setExportContext(null); }} />
    </div>
  );
}

function CloseSessionDialog({
  open,
  reason,
  onReason,
  onCancel,
  onSubmit,
  submitting,
}: {
  open: boolean;
  reason: string;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("query.exit.title")}</DialogTitle>
          <DialogDescription>{t("query.exit.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="query-exit-reason">{t("query.exit.reason")}</Label>
          <Textarea
            id="query-exit-reason"
            value={reason}
            onChange={(event) => { onReason(event.target.value); }}
            maxLength={4096}
            data-testid="query-exit-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim() === "" || submitting}
            onClick={() => { onSubmit(); }}
            data-testid="query-exit-confirm"
          >
            {submitting ? t("common.saving") : t("query.exit.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ExportContext {
  datasourceId: string;
  schemaName: string;
  sql: string;
}

function ExportDialog({
  context,
  sessionId,
  onClose,
}: {
  context: ExportContext | null;
  sessionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [done, setDone] = useState<{ rows: number; executionId: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  // The dialog stays mounted (context=null hides it), so every close must
  // fully reset the run state — a stale startedRef would silently swallow
  // the next export and keep showing the previous success.
  // Closing cancels any still-running export loop and fully resets the
  // dialog run state (R2 H-3/L-9); the next context re-arms the refs.
  const closeExport = () => {
    cancelledRef.current = true;
    startedRef.current = false;
    setProgress(null);
    setDone(null);
    setFailure(null);
    onClose();
  };



  useEffect(() => {
    if (context === null) return;
    if (startedRef.current) return;
    startedRef.current = true;
    cancelledRef.current = false;
    cancelledRef.current = false;
    setProgress({ pagesRead: 0, rowsExported: 0, finished: false, failure: null });
    setDone(null);
    setFailure(null);
    // Server cursors are strictly forward: the display cursor has already
    // streamed the visible rows, so the export starts its OWN execution of
    // the same SELECT with the export page size and walks it with
    // purpose=export — every page re-authorizes the frozen can_export
    // server-side (4003) and revocation mid-export fails honestly (4004).
    void (async () => {
      try {
        const first = await runSelect(sessionId, {
          datasource_id: context.datasourceId,
          schema_name: context.schemaName,
          sql: context.sql,
          timeout_ms: 30000,
          page_size: EXPORT_PAGE_SIZE,
        });
        const executionId = first.execution_id;
        await exportExecutionToXlsx(
          first,
          (cursor) => fetchPage(executionId, cursor, "export"),
          {
            onProgress: setProgress,
            onDone: (bytes, rows) => {
              downloadXlsx(bytes, `query-export-${executionId}.xlsx`);
              setDone({ rows, executionId });
            },
            onFailure: (message, rows) => {
              setFailure(t("query.export.failedWithRange", { message, rows }));
            },
          },
          () => cancelledRef.current,
        );
      } catch (error) {
        setFailure(describeErrorText(describeError(error, "executeSelect")));
      }
    })();
  }, [context, sessionId, t]);

  if (context === null) return null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="query-export-dialog">
        <DialogHeader>
          <DialogTitle>{t("query.export.title")}</DialogTitle>
          <DialogDescription>{t("query.export.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {progress !== null && !done && failure === null && (
            <>
              <Progress value={progress.finished ? 100 : Math.min(95, progress.pagesRead * 10)} />
              <p className="text-muted-foreground text-xs" data-testid="query-export-progress">
                {t("query.export.progress", { pages: progress.pagesRead, rows: progress.rowsExported })}
              </p>
            </>
          )}
          {done !== null && (
            <p className="text-xs" data-testid="query-export-done">
              {t("query.export.done", { rows: done.rows })}
            </p>
          )}
          {done === null && progress === null && (
            <p className="text-muted-foreground text-xs">{t("common.loading")}</p>
          )}
          {failure !== null && (
            <Alert variant="destructive" data-testid="query-export-failure">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          {done === null && failure === null && (
            <Button
              variant="outline"
              onClick={() => {
                cancelledRef.current = true;
              }}
              data-testid="query-export-cancel"
            >
              <X />
              {t("query.export.cancel")}
            </Button>
          )}
          <Button onClick={closeExport} data-testid="query-export-close">{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}
