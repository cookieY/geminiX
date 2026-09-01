import i18next from "@/shared/i18n";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CalendarClock, ChevronRight, Database, FilePlus2 } from "lucide-react";
import type { Flow, QueryAccessRequest, QueryGrant } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError, businessErrCodeByName } from "@/shared/api/error-display";
import { BusinessError } from "@/shared/api/mutator";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/components/ui/empty";
import {
  useCreateAccessRequest,
  useCreateSession,
  useMyAccessRequests,
  useMyGrants,
  useMyQueryFlows,
  useMySessions,
} from "@/features/query/use-query-domain";

/**
 * 查询入口 (route /query; migration contract §2, UI spec §7.5).
 *
 * Flow cards are the primary entry. Whether entering needs a grant is
 * SERVER-driven: the grant-less attempt succeeds when query approval is
 * disabled (Q002 direct path) and answers QUERY_GRANT_REQUIRED otherwise,
 * which the page converts into the 申请访问 guidance — the frontend never
 * reads the admin-only query settings namespace to guess the mode.
 *
 * Grant matching: the request view carries no flow id (the backend keeps
 * flow_id_snapshot internal), so an active grant is attached to a flow by
 * construction — its approved datasource set is a subset of the flow's
 * capabilities. The subset rule is derived purely from server facts and is
 * recorded as a presentation boundary in the migration contract §17.
 */

function formatExpiry(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

interface FlowGrantMatch {
  grant: QueryGrant;
  request: QueryAccessRequest;
}

function matchGrantForFlow(flow: Flow, requests: QueryAccessRequest[], grants: QueryGrant[]): FlowGrantMatch | null {
  const grantById = new Map(grants.map((grant) => [grant.id, grant]));
  const capabilityIds = new Set((flow.query_capabilities ?? []).map((capability) => capability.datasource_id));
  const candidates: FlowGrantMatch[] = [];
  for (const request of requests) {
    if (request.state !== "grant_active" || request.grant_id === null || request.grant_id === undefined) continue;
    const grant = grantById.get(request.grant_id);
    if (grant === undefined || grant.state !== "active") continue;
    const subset = request.datasource_ids.every((id) => capabilityIds.has(id));
    if (subset) candidates.push({ grant, request });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    current.grant.created_at > latest.grant.created_at ? current : latest,
  );
}

export default function QueryEntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const authenticated = session.status === "authenticated";
  const flowsQuery = useMyQueryFlows(authenticated);
  const requestsQuery = useMyAccessRequests(authenticated);
  const grantsQuery = useMyGrants(authenticated);
  const sessionsQuery = useMySessions(authenticated);
  const createSession = useCreateSession();

  const [requestFlow, setRequestFlow] = useState<Flow | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [needsAccessHint, setNeedsAccessHint] = useState<string | null>(null);

  const flows = flowsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const sessions = (sessionsQuery.data ?? []).filter((row) => row.state === "active");
  const matches = useMemo(
    () => new Map(flows.map((flow) => [flow.id, matchGrantForFlow(flow, requests, grants)])),
    [flows, grants, requests],
  );

  const enter = async (flow: Flow, match: FlowGrantMatch | null): Promise<void> => {
    setEntryError(null);
    setNeedsAccessHint(null);
    try {
      const created = await createSession.mutateAsync({
        flow_id: flow.id,
        grant_id: match === null ? null : match.grant.id,
        datasource_ids:
          match === null
            ? (flow.query_capabilities ?? []).map((capability) => capability.datasource_id)
            : [...match.request.datasource_ids],
      });
      void navigate(`/query/sessions/${created.id}`);
    } catch (error) {
      if (
        error instanceof BusinessError &&
        error.err_code === businessErrCodeByName("QUERY_GRANT_REQUIRED")
      ) {
        setNeedsAccessHint(flow.name);
        return;
      }
      setEntryError(describeErrorText(describeError(error, "createQuerySession")));
    }
  };

  const anyLoading = flowsQuery.isPending || requestsQuery.isPending || grantsQuery.isPending;
  const loadError = flowsQuery.error ?? requestsQuery.error ?? grantsQuery.error;

  return (
    <div className="flex flex-col gap-4" data-testid="query-entry">
      <PageBreadcrumb title={t("nav.query")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("query.entry.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("query.entry.description")}</p>
      </header>

      {entryError !== null && (
        <Alert variant="destructive" data-testid="query-entry-error">
          <AlertTitle>{t("query.entry.failed")}</AlertTitle>
          <AlertDescription>{entryError}</AlertDescription>
        </Alert>
      )}
      {needsAccessHint !== null && (
        <Alert data-testid="query-needs-access-hint">
          <AlertTitle>{t("query.entry.needsAccessTitle")}</AlertTitle>
          <AlertDescription>{t("query.entry.needsAccessDescription", { name: needsAccessHint })}</AlertDescription>
        </Alert>
      )}

      {loadError !== null && (
        <ErrorState
          error={loadError}
          operationId="listCurrentUserFlows"
          onRetry={() => {
            void flowsQuery.refetch();
            void requestsQuery.refetch();
            void grantsQuery.refetch();
          }}
        />
      )}
      {loadError === null && anyLoading && <LoadingState />}

      {loadError === null && !anyLoading && (
        <>
          {flows.length === 0 && sessions.length === 0 && (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Database />
                </EmptyMedia>
                <EmptyTitle>{t("query.entry.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("query.entry.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {flows.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("query.entry.flowsCard")}</CardTitle>
                <CardDescription>{t("query.entry.flowsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {flows.map((flow) => {
                  const match = matches.get(flow.id) ?? null;
                  return (
                    <div
                      key={flow.id}
                      className="flex flex-row items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      data-testid={`query-flow-${flow.id}`}
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium">{flow.name}</span>
                        <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                          <Database className="size-3" />
                          {(flow.query_capabilities ?? []).length}
                          {t("query.entry.datasourceCount")}
                          {(flow.query_capabilities ?? []).some((capability) => capability.can_export) && (
                            <Badge variant="secondary">{t("query.entry.exportable")}</Badge>
                          )}
                        </span>
                        {match !== null && (
                          <span className="flex items-center gap-1 text-xs" data-testid={`query-flow-expiry-${flow.id}`}>
                            <CalendarClock className="size-3" />
                            {t("query.entry.grantExpires", { time: formatExpiry(match.grant.expires_at) })}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-row gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setRequestFlow(flow); }} data-testid={`query-flow-apply-${flow.id}`}>
                          <FilePlus2 />
                          {t("query.entry.applyAccess")}
                        </Button>
                        <Button size="sm" onClick={() => { void enter(flow, match); }} data-testid={`query-flow-enter-${flow.id}`}>
                          {t("query.entry.enter")}
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {sessions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("query.entry.sessionsCard")}</CardTitle>
                <CardDescription>{t("query.entry.sessionsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sessions.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => { void navigate(`/query/sessions/${row.id}`); }}
                    className="flex flex-row items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-accent"
                    data-testid={`query-session-${row.id}`}
                  >
                    <span className="text-muted-foreground truncate font-mono text-xs">{row.id}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary">{t(`query.session.state.${row.state}`)}</Badge>
                      <span className="text-muted-foreground text-xs">{formatExpiry(row.created_at)}</span>
                      <ChevronRight className="size-4" />
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AccessRequestDialog flow={requestFlow} onClose={() => { setRequestFlow(null); }} />
    </div>
  );
}

function AccessRequestDialog({ flow, onClose }: { flow: Flow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const createRequest = useCreateAccessRequest();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  const capabilities = flow?.query_capabilities ?? [];
  const valid = reason.trim() !== "" && until !== "" && selected.length > 0;

  const toggle = (datasourceId: string) => {
    setSelected((current) =>
      current.includes(datasourceId)
        ? current.filter((id) => id !== datasourceId)
        : [...current, datasourceId],
    );
  };

  const submit = async () => {
    if (flow === null) return;
    setErrorText(null);
    try {
      await createRequest.mutateAsync({
        flow_id: flow.id,
        datasource_ids: selected,
        requested_until: new Date(`${until}T23:59:59Z`).toISOString(),
        reason,
      });
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "createQueryAccessRequest")));
    }
  };

  return (
    <Dialog open={flow !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="query-access-request-dialog">
        <DialogHeader>
          <DialogTitle>{t("query.apply.title", { name: flow?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("query.apply.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("query.apply.datasources")}</Label>
            <p className="text-muted-foreground text-xs">{t("query.apply.datasourcesHint")}</p>
            <div className="flex flex-col gap-1">
              {capabilities.map((capability) => (
                <label
                  key={capability.datasource_id}
                  className="flex cursor-pointer flex-row items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(capability.datasource_id)}
                    onChange={() => { toggle(capability.datasource_id); }}
                    data-testid={`query-apply-ds-${capability.datasource_id}`}
                  />
                  <span className="truncate font-mono text-xs">{capability.datasource_id}</span>
                  {capability.can_export && <Badge variant="secondary">{t("query.entry.exportable")}</Badge>}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-apply-until">{t("query.apply.until")}</Label>
            <Input
              id="query-apply-until"
              type="date"
              value={until}
              onChange={(event) => { setUntil(event.target.value); }}
              data-testid="query-apply-until"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-apply-reason">{t("query.apply.reason")}</Label>
            <Textarea
              id="query-apply-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); }}
              maxLength={4096}
              data-testid="query-apply-reason"
            />
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="query-apply-error">
              <AlertTitle>{t("query.apply.failed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => { void submit(); }}
            disabled={!valid || createRequest.isPending}
            data-testid="query-apply-submit"
          >
            {createRequest.isPending ? t("common.saving") : t("query.apply.submit")}
          </Button>
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
