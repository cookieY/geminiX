import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileStack, Hourglass, ShieldCheck, Stamp, Terminal } from "lucide-react";
import { getMyDashboard } from "@/api/generated/client/dashboard/dashboard";
import {
  getOperationsDashboard,
  getReviewQualityDashboard,
  getSystemHealthDashboard,
} from "@/api/generated/client/administration/administration";
import type {
  AnnouncementPublication,
  MyDashboard,
  OperationsDashboard,
  ReviewQualityDashboard,
  SystemHealthDashboard,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

/**
 * Workspace dashboard sections (dashboard PRD §2/§9; UI spec §5.1 首页).
 * Every number comes from the declared dashboards API — no fabricated
 * metrics, trends or totals. The 60s auto-refresh default comes from the
 * PRD; the announcement renders the server-sanitized HTML (sanitizer
 * authority stays server-side, dashboard PRD §6).
 */

export function useMyDashboardQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "me"],
    queryFn: async () => (await getMyDashboard()) as unknown as MyDashboard,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useCurrentAnnouncementQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["announcements", "current"],
    queryFn: async () =>
      (await getCurrentAnnouncement()) as unknown as AnnouncementPublication | null,
    enabled,
    staleTime: 60_000,
  });
}

async function getCurrentAnnouncement() {
  const { getCurrentAnnouncement: fetcher } = await import(
    "@/api/generated/client/announcements/announcements"
  );
  return fetcher();
}

interface CountCardProps {
  label: string;
  value: number | undefined;
  testId: string;
  icon: React.ReactNode;
}

function CountCard({ label, value, testId, icon }: CountCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums" data-testid={testId}>
          {value === undefined ? "—" : value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

export function MyDashboardCards({ dashboard }: { dashboard: MyDashboard | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="workspace-dashboard-cards">
      <CountCard
        label={t("dashboard.my.drafts")}
        value={dashboard?.draft_count}
        testId="dashboard-draft-count"
        icon={<FileStack className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.submitted")}
        value={dashboard?.submitted_order_count}
        testId="dashboard-submitted-count"
        icon={<FileStack className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.pendingApproval")}
        value={dashboard?.pending_approval_count}
        testId="dashboard-pending-approval-count"
        icon={<Stamp className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.pendingExecution")}
        value={dashboard?.pending_execution_count}
        testId="dashboard-pending-execution-count"
        icon={<Hourglass className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.blockedReview")}
        value={dashboard?.blocked_review_count}
        testId="dashboard-blocked-review-count"
        icon={<AlertTriangle className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.activeGrants")}
        value={dashboard?.active_query_grant_count}
        testId="dashboard-grant-count"
        icon={<ShieldCheck className="size-3.5" />}
      />
      <CountCard
        label={t("dashboard.my.activeSessions")}
        value={dashboard?.active_query_session_count}
        testId="dashboard-session-count"
        icon={<Terminal className="size-3.5" />}
      />
    </div>
  );
}

export function AnnouncementBanner({ publication }: { publication: AnnouncementPublication | null }) {
  const { t } = useTranslation();
  if (publication === null) return null;
  return (
    <Card data-testid="workspace-announcement">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{publication.revision.title}</CardTitle>
        <CardDescription>
          {t("dashboard.announcement.publishedAt", {
            time: publication.published_at.replace("T", " ").replace("Z", " UTC"),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Server-sanitized HTML (sanitizer_policy_version recorded on the
            revision); the client renders, it does not re-sanitize. */}
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-sm"
          dangerouslySetInnerHTML={{ __html: publication.revision.sanitized_html }}
        />
      </CardContent>
    </Card>
  );
}

export function AdminDashboardSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const operations = useQuery({
    queryKey: ["admin", "dashboard", "operations"],
    queryFn: async () => (await getOperationsDashboard()) as unknown as OperationsDashboard,
    enabled,
    refetchInterval: 60_000,
  });
  const quality = useQuery({
    queryKey: ["admin", "dashboard", "review-quality"],
    queryFn: async () => (await getReviewQualityDashboard()) as unknown as ReviewQualityDashboard,
    enabled,
    refetchInterval: 60_000,
  });
  const health = useQuery({
    queryKey: ["admin", "dashboard", "system-health"],
    queryFn: async () => (await getSystemHealthDashboard()) as unknown as SystemHealthDashboard,
    enabled,
    refetchInterval: 60_000,
  });

  if (!enabled) return null;
  const completeness = operations.data?.meta.completeness;

  return (
    <section className="flex flex-col gap-3" data-testid="workspace-admin-dashboards">
      <h2 className="text-base font-semibold">{t("dashboard.admin.title")}</h2>
      {operations.data !== undefined && (
        <p className="text-muted-foreground text-xs">
          {t("dashboard.admin.window", {
            from: operations.data.meta.window_start,
            to: operations.data.meta.window_end,
            zone: operations.data.meta.system_timezone,
          })}
          {completeness === "partial" ? ` · ${t("dashboard.admin.partial")}` : ""}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="workspace-admin-operations">
        <CountCard label={t("dashboard.admin.orderTotal")} value={operations.data?.change_order_total} testId="admin-order-total" icon={<FileStack className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.queryTotal")} value={operations.data?.query_execution_total} testId="admin-query-total" icon={<Terminal className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.userTotal")} value={operations.data?.user_total} testId="admin-user-total" icon={<ShieldCheck className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.datasourceTotal")} value={operations.data?.datasource_total} testId="admin-datasource-total" icon={<Terminal className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.completed")} value={operations.data?.completed_total} testId="admin-completed-total" icon={<ShieldCheck className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.failed")} value={operations.data?.failed_total} testId="admin-failed-total" icon={<AlertTriangle className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.partialFailed")} value={operations.data?.partial_failed_total} testId="admin-partial-failed-total" icon={<AlertTriangle className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.ddlStatements")} value={operations.data?.ddl_statement_total} testId="admin-ddl-total" icon={<FileStack className="size-3.5" />} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card data-testid="workspace-admin-quality">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">{t("dashboard.admin.reviewQuality")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            {quality.data === undefined ? (
              <span className="text-muted-foreground">{t("common.loading")}</span>
            ) : (
              <>
                <Badge variant="secondary">{t("dashboard.admin.ready", { count: quality.data.ready_total })}</Badge>
                <Badge variant="secondary">{t("dashboard.admin.blocked", { count: quality.data.blocked_total })}</Badge>
                <Badge variant="secondary">{t("dashboard.admin.partialRuns", { count: quality.data.partial_total })}</Badge>
                <Badge variant="secondary">{t("dashboard.admin.failedRuns", { count: quality.data.failed_total })}</Badge>
                <Badge variant="secondary">
                  {t("dashboard.admin.fingerprintCoverage", {
                    percent: Math.round(quality.data.fingerprint_coverage_ratio * 100),
                  })}
                </Badge>
              </>
            )}
          </CardContent>
        </Card>
        <Card data-testid="workspace-admin-health">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">{t("dashboard.admin.systemHealth")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-xs">
            {health.data === undefined ? (
              <span className="text-muted-foreground">{t("common.loading")}</span>
            ) : (
              health.data.components.map((component) => (
                <div key={component.component} className="flex items-center justify-between gap-2">
                  <span>{component.component}</span>
                  <Badge variant={component.status === "healthy" ? "secondary" : "destructive"}>
                    {component.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
