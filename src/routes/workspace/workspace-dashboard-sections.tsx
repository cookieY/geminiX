import { Suspense, lazy, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Database,
  FileStack,
  Hourglass,
  Megaphone,
  ShieldCheck,
  Stamp,
  Terminal,
  TrendingUp,
  Users,
} from "lucide-react";
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
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";

const WorkspaceOrderTrendChart = lazy(() => import("./workspace-order-trend-chart"));

/**
 * Workspace dashboard sections (dashboard PRD §2/§3/§9; UI spec §5.1 首页,
 * §7.6). The admin home follows the owner's reference mapping (ruling
 * 2026-09-02): status banner (template "Update" slot) → order-trend hero
 * beside the announcement card (template "Sales Overview" + "Total Assets"
 * slots) → the three reference stat cards. Every number comes from the
 * declared dashboards API — no fabricated metrics, trends, totals or
 * versions (the service release version has no contract surface yet).
 * The 60s auto-refresh default comes from the PRD; the announcement renders
 * the server-sanitized HTML (sanitizer authority stays server-side, PRD §6).
 */

export function useMyDashboardQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "me"],
    queryFn: async () => (await getMyDashboard()) as unknown as MyDashboard,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useOperationsDashboardQuery(windowDays: number, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "dashboard", "operations", windowDays],
    queryFn: async () =>
      (await getOperationsDashboard({ window_days: windowDays })) as unknown as OperationsDashboard,
    enabled,
    // Window switches keep the previous chart on screen instead of
    // collapsing the card to a skeleton on every refetch.
    placeholderData: keepPreviousData,
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

/** Reference-image stat card: label + value left, framed icon right. */
function OperationsStatCard({ label, value, testId, icon }: CountCardProps) {
  return (
    <Card data-testid="workspace-admin-stat-card">
      <CardContent className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-normal">{label}</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
            {value === undefined ? "—" : value}
          </p>
        </div>
        <div className="rounded-md border border-border p-2.5">{icon}</div>
      </CardContent>
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

/** Template "Total Assets" card slot per the owner mapping — the system
 * announcement (title, publication time, server-sanitized HTML). Static
 * marker dot: the template's animate-ping is deliberately not copied
 * (screenshot baselines are byte-compared). */
export function AnnouncementCard({ publication }: { publication: AnnouncementPublication | null }) {
  const { t } = useTranslation();
  if (publication === null) return null;
  return (
    <Card data-testid="workspace-announcement" className="h-full">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone size={16} className="text-muted-foreground" />
          {t("dashboard.announcement.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-chart-1 size-2 rounded-full" aria-hidden />
          <p className="text-sm font-medium">{publication.revision.title}</p>
          <span className="bg-border size-1 rounded-full" aria-hidden />
          <p className="text-muted-foreground text-sm font-normal">
            {t("dashboard.announcement.publishedAt", {
              time: publication.published_at.replace("T", " ").replace("Z", " UTC"),
            })}
          </p>
        </div>
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

/** Service runtime status (template "Update" banner slot). System health is
 * the contract surface for "服务当前运行状态"; the release version has no
 * backend endpoint yet, so none is shown. */
export function SystemStatusBanner({ health }: { health: SystemHealthDashboard | undefined }) {
  const { t } = useTranslation();
  if (health === undefined) return null;
  const total = health.components.length;
  const unhealthy = health.components.filter((component) => component.status !== "healthy");
  const healthy = total - unhealthy.length;
  const dotClass =
    unhealthy.some((component) => component.status === "unavailable")
      ? "bg-destructive"
      : unhealthy.length > 0
        ? "bg-warning"
        : "bg-success";
  return (
    <Card data-testid="workspace-status-banner" className="py-3">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
            <p className="text-sm font-medium">{t("dashboard.admin.statusTitle")}</p>
            <span className="bg-border size-1 rounded-full" aria-hidden />
            <p className="text-sm font-normal">
              {unhealthy.length === 0
                ? t("dashboard.admin.statusHealthy")
                : t("dashboard.admin.statusIssues", { issues: unhealthy.length })}
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            {t("dashboard.admin.statusCheckedAt", {
              time: health.checked_at.replace("T", " ").replace("Z", " UTC"),
            })}
          </p>
        </div>
        <Badge variant={unhealthy.length === 0 ? "secondary" : "destructive"}>
          {t("dashboard.admin.statusComponentsOk", { ok: healthy, total })}
        </Badge>
      </CardContent>
    </Card>
  );
}

const WINDOW_OPTIONS = [7, 14, 30, 90] as const;

function OrderTrendCard({
  operations,
  windowDays,
  onWindowChange,
}: {
  operations: OperationsDashboard | undefined;
  windowDays: number;
  onWindowChange: (days: number) => void;
}) {
  const { t } = useTranslation();
  const meta = operations?.meta;
  return (
    <Card data-testid="workspace-admin-operations" className="h-full">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp size={16} className="text-muted-foreground" />
          {t("dashboard.admin.orderTrend")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-normal">{t("dashboard.admin.orderTotal")}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums" data-testid="admin-order-total">
                {operations === undefined ? "—" : operations.change_order_total}
              </span>
              {meta !== undefined && (
                <span className="text-muted-foreground text-xs">
                  {t("dashboard.admin.window", {
                    from: meta.window_start,
                    to: meta.window_end,
                    zone: meta.system_timezone,
                  })}
                  {meta.completeness === "partial" ? ` · ${t("dashboard.admin.partial")}` : ""}
                </span>
              )}
            </div>
          </div>
          <Select
            value={String(windowDays)}
            onValueChange={(value) => {
              if (value) onWindowChange(Number(value));
            }}
          >
            <SelectTrigger
              data-testid="admin-trend-window"
              aria-label={t("dashboard.admin.windowLabel")}
              className="h-auto w-fit cursor-pointer gap-1.5 px-3 py-2 text-sm font-medium"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)} className="cursor-pointer">
                  {t("dashboard.admin.windowDays", { days })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {operations !== undefined && operations.order_trend.length === 0 ? (
          // Dashboard PRD §6: charts handle empty data explicitly.
          <Empty className="rounded-lg border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrendingUp />
              </EmptyMedia>
              <EmptyTitle>{t("dashboard.admin.emptyTrend")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Suspense fallback={<Skeleton className="h-[240px] w-full" aria-hidden />}>
            <WorkspaceOrderTrendChart points={operations?.order_trend ?? []} />
          </Suspense>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminDashboardSection({
  enabled,
  announcement,
  children,
}: {
  enabled: boolean;
  announcement: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState(30);
  const operations = useOperationsDashboardQuery(windowDays, enabled);
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

  return (
    <div className="flex flex-col gap-3" data-testid="workspace-admin-dashboards">
      <SystemStatusBanner health={health.data} />
      <div className="grid gap-3 lg:grid-cols-12" data-testid="workspace-home-main-row">
        <div className="lg:col-span-7">
          <OrderTrendCard
            operations={operations.data}
            windowDays={windowDays}
            onWindowChange={setWindowDays}
          />
        </div>
        <div className="lg:col-span-5">{announcement}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="workspace-admin-stat-cards">
        <OperationsStatCard
          label={t("dashboard.admin.queryTotal")}
          value={operations.data?.query_execution_total}
          testId="admin-query-total"
          icon={<Terminal className="size-4" />}
        />
        <OperationsStatCard
          label={t("dashboard.admin.userTotal")}
          value={operations.data?.user_total}
          testId="admin-user-total"
          icon={<Users className="size-4" />}
        />
        <OperationsStatCard
          label={t("dashboard.admin.datasourceTotal")}
          value={operations.data?.datasource_total}
          testId="admin-datasource-total"
          icon={<Database className="size-4" />}
        />
      </div>
      {children}
      <h2 className="text-base font-semibold">{t("dashboard.admin.title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard label={t("dashboard.admin.completed")} value={operations.data?.completed_total} testId="admin-completed-total" icon={<ShieldCheck className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.failed")} value={operations.data?.failed_total} testId="admin-failed-total" icon={<AlertTriangle className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.partialFailed")} value={operations.data?.partial_failed_total} testId="admin-partial-failed-total" icon={<AlertTriangle className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.ddlStatements")} value={operations.data?.ddl_statement_total} testId="admin-ddl-total" icon={<FileStack className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.approvalP50")} value={operations.data?.approval_duration_p50_ms} testId="admin-approval-p50" icon={<Hourglass className="size-3.5" />} />
        <CountCard label={t("dashboard.admin.approvalP95")} value={operations.data?.approval_duration_p95_ms} testId="admin-approval-p95" icon={<Hourglass className="size-3.5" />} />
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
    </div>
  );
}
