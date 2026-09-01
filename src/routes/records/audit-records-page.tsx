import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lock, ScrollText } from "lucide-react";
import { listAuditEvents } from "@/api/generated/client/administration/administration";
import type { AuditEvent } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/components/ui/empty";
import { useState } from "react";

/**
 * 审计记录 (route /records; migration contract §2 maps legacy
 * /comptroller/order/record here). The declared contract exposes the audit
 * list only to the builtin admin (audit PRD §4: 只有admin可以访问) with
 * cursor pagination and NO filter parameters — the legacy time/user/action
 * filters have no declared surface, which is recorded as an RCP-pending
 * contract gap in the migration contract §17 rather than invented here.
 * Non-admin sessions get the honest 无可见审计范围 state; the read stays
 * append-only (90-day retention shown per row via expires_at).
 */

const OUTCOME_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  succeeded: "secondary",
  denied: "destructive",
  failed: "destructive",
};

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

export default function AuditRecordsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const [detail, setDetail] = useState<AuditEvent | null>(null);

  const eventsQuery = useQuery({
    queryKey: ["admin", "audit-events"],
    queryFn: async () => {
      const response = (await listAuditEvents({ limit: 200 })) as unknown as {
        items?: AuditEvent[];
        page?: { has_more?: boolean };
      };
      return { items: response.items ?? [], hasMore: response.page?.has_more ?? false };
    },
    enabled: session.status === "authenticated" && isAdmin,
    retry: false,
  });

  return (
    <div className="flex flex-col gap-4" data-testid="records-page">
      <PageBreadcrumb title={t("nav.auditRecords")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("records.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("records.description")}</p>
      </header>

      {!isAdmin && (
        <Empty className="rounded-xl border" data-testid="records-no-scope">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lock />
            </EmptyMedia>
            <EmptyTitle>{t("records.noScopeTitle")}</EmptyTitle>
            <EmptyDescription>{t("records.noScopeDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {isAdmin && eventsQuery.isPending && <LoadingState />}
      {isAdmin && eventsQuery.error !== null && (
        <ErrorState
          error={eventsQuery.error}
          operationId="listAuditEvents"
          onRetry={() => void eventsQuery.refetch()}
        />
      )}

      {isAdmin && !eventsQuery.isPending && eventsQuery.error === null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScrollText className="size-4" />
              {t("records.card")}
            </CardTitle>
            <CardDescription>{t("records.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {eventsQuery.data.items.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm" data-testid="records-empty">
                {t("records.empty")}
              </p>
            )}
            {eventsQuery.data.items.length > 0 && (
              <Table data-testid="records-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("records.column.time")}</TableHead>
                    <TableHead>{t("records.column.actor")}</TableHead>
                    <TableHead>{t("records.column.action")}</TableHead>
                    <TableHead>{t("records.column.resource")}</TableHead>
                    <TableHead>{t("records.column.outcome")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventsQuery.data.items.map((event) => (
                    <TableRow
                      key={event.id}
                      className="cursor-pointer"
                      onClick={() => { setDetail(event); }}
                      data-testid={`records-row-${event.id}`}
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        {formatTimestamp(event.occurred_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {event.actor_username_snapshot ?? event.actor_kind}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{event.action}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.resource_type}
                        {event.resource_id == null ? "" : ` · ${event.resource_id.slice(0, 8)}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={OUTCOME_VARIANT[event.outcome] ?? "outline"}>
                          {t(`records.outcome.${event.outcome}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto" data-testid="records-detail">
          {detail !== null && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{detail.action}</SheetTitle>
                <SheetDescription>{formatTimestamp(detail.occurred_at)}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-6 text-sm">
                <Row label={t("records.detail.eventType")} value={detail.event_type} />
                <Row label={t("records.detail.actor")} value={detail.actor_username_snapshot ?? detail.actor_kind} />
                <Row label={t("records.detail.resource")} value={`${detail.resource_type}${detail.resource_id === null ? "" : ` · ${String(detail.resource_id)}`}`} />
                <Row label={t("records.detail.outcome")} value={t(`records.outcome.${detail.outcome}`)} />
                <Row label={t("records.detail.requestId")} value={detail.request_id ?? "—"} />
                <Row label={t("records.detail.expiresAt")} value={formatTimestamp(detail.expires_at)} />
                {/* Structured metadata; secret changes only ever show "changed"
                    server-side (audit PRD §5). */}
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">{t("records.detail.metadata")}</span>
                  <pre className="bg-muted/50 overflow-x-auto rounded-md p-2 text-xs">
                    {JSON.stringify(detail.metadata ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-xs break-all">{value}</span>
    </div>
  );
}
