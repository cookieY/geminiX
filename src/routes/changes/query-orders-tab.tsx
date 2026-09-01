import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Terminal } from "lucide-react";
import type { QueryAccessRequest, QueryGrant, QuerySession } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { useMyAccessRequests, useMyGrants, useMySessions } from "@/features/query/use-query-domain";
import { ErrorState } from "@/shared/components/status/status-components";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

/**
 * 查询工单 Tab (UI spec §5.2 — the unified view inside 我的工单). Rows come
 * from whichever server objects exist for the current user: access requests
 * and grants when query approval produced them, session records otherwise.
 * The detail sheet shows the frozen datasource set, the request state, the
 * grant state and — when revoked — the revocation reason. Operator and
 * time of revocation are NOT in the frozen read contract; the gap is
 * recorded in the migration contract §17 as RCP-pending.
 */

type QueryOrderRow =
  | { kind: "request"; id: string; request: QueryAccessRequest; grant: QueryGrant | null }
  | { kind: "session"; id: string; session: QuerySession };

function formatTimestamp(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.replace("T", " ").replace("Z", " UTC");
}

export function QueryOrdersTab() {
  const { t } = useTranslation();
  const session = useSession();
  const authenticated = session.status === "authenticated";
  const requestsQuery = useMyAccessRequests(authenticated);
  const grantsQuery = useMyGrants(authenticated);
  const sessionsQuery = useMySessions(authenticated);
  const [detail, setDetail] = useState<QueryOrderRow | null>(null);

  const requests = requestsQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const grantById = new Map(grants.map((grant) => [grant.id, grant]));

  const rows: QueryOrderRow[] = [
    ...requests.map((request): QueryOrderRow => ({
      kind: "request",
      id: request.id,
      request,
      grant: request.grant_id === null || request.grant_id === undefined ? null : grantById.get(request.grant_id) ?? null,
    })),
    ...sessions.map((row): QueryOrderRow => ({ kind: "session", id: row.id, session: row })),
  ].sort((a, b) => (a.kind === "request" ? a.request.created_at : a.session.created_at).localeCompare(
    b.kind === "request" ? b.request.created_at : b.session.created_at,
  ));

  const loadError = requestsQuery.error ?? grantsQuery.error ?? sessionsQuery.error;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("orders.query.title")}</CardTitle>
        <CardDescription>{t("orders.query.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loadError !== null && (
          <ErrorState
            error={loadError}
            operationId="listQueryAccessRequests"
            onRetry={() => {
              void requestsQuery.refetch();
              void sessionsQuery.refetch();
            }}
          />
        )}
        {loadError === null && requestsQuery.isPending && (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("common.loading")}</p>
        )}
        {loadError === null && !requestsQuery.isPending && rows.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm" data-testid="orders-query-empty">
            {t("orders.query.empty")}
          </p>
        )}
        {loadError === null && !requestsQuery.isPending && rows.length > 0 && (
          <Table data-testid="orders-query-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.query.column.kind")}</TableHead>
                <TableHead>{t("orders.query.column.datasources")}</TableHead>
                <TableHead>{t("orders.query.column.state")}</TableHead>
                <TableHead>{t("orders.query.column.createdAt")}</TableHead>
                <TableHead>{t("orders.query.column.terminal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => { setDetail(row); }}
                  data-testid={`orders-query-row-${row.id}`}
                >
                  <TableCell>
                    {row.kind === "request" ? (
                      <Badge variant="outline">{t("orders.query.kind.request")}</Badge>
                    ) : (
                      <Badge variant="outline">
                        <Terminal className="size-3" />
                        {t("orders.query.kind.session")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 truncate font-mono text-xs">
                    {row.kind === "request"
                      ? row.request.datasource_ids.join(" · ")
                      : row.session.capabilities.map((capability) => capability.datasource_name).join(" · ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {row.kind === "request"
                        ? t(`query.request.state.${row.request.state}`)
                        : t(`query.session.state.${row.session.state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatTimestamp(row.kind === "request" ? row.request.created_at : row.session.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.kind === "request" && row.grant !== null
                      ? t(`query.grant.state.${row.grant.state}`)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto" data-testid="orders-query-detail">
          {detail !== null && (
            <>
              <SheetHeader>
                <SheetTitle>{t("orders.query.detail.title")}</SheetTitle>
                <SheetDescription>{t("orders.query.detail.description")}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-6">
                {detail.kind === "request" ? (
                  <>
                    <DetailRow label={t("orders.query.detail.state")}>
                      <Badge variant="secondary">{t(`query.request.state.${detail.request.state}`)}</Badge>
                    </DetailRow>
                    <DetailRow label={t("orders.query.detail.datasources")}>
                      <span className="font-mono text-xs break-all">{detail.request.datasource_ids.join(" · ")}</span>
                    </DetailRow>
                    <DetailRow label={t("orders.query.detail.createdAt")}>
                      {formatTimestamp(detail.request.created_at)}
                    </DetailRow>
                    {detail.grant !== null && (
                      <>
                        <DetailRow label={t("orders.query.detail.grantState")}>
                          <Badge variant="secondary">{t(`query.grant.state.${detail.grant.state}`)}</Badge>
                        </DetailRow>
                        <DetailRow label={t("orders.query.detail.expiresAt")}>
                          {formatTimestamp(detail.grant.expires_at)}
                        </DetailRow>
                        {detail.grant.state === "revoked" && detail.grant.revoked_reason !== null && (
                          <div
                            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
                            data-testid="orders-query-revoke-reason"
                          >
                            <div className="flex items-center gap-1 font-medium">
                              <ShieldCheck className="size-3.5" />
                              {t("orders.query.detail.revoked")}
                            </div>
                            <p className="text-muted-foreground mt-1">{detail.grant.revoked_reason}</p>
                            <p className="text-muted-foreground/70 mt-1">{t("orders.query.detail.revokedMetaPending")}</p>
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <DetailRow label={t("orders.query.detail.state")}>
                      <Badge variant="secondary">{t(`query.session.state.${detail.session.state}`)}</Badge>
                    </DetailRow>
                    <DetailRow label={t("orders.query.detail.datasources")}>
                      <span className="font-mono text-xs break-all">
                        {detail.session.capabilities.map((capability) => capability.datasource_name).join(" · ")}
                      </span>
                    </DetailRow>
                    <DetailRow label={t("orders.query.detail.createdAt")}>
                      {formatTimestamp(detail.session.created_at)}
                    </DetailRow>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}
