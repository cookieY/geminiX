import { Suspense, lazy, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Database, Megaphone, Terminal, TrendingUp, Users } from "lucide-react";
import { getMyDashboard } from "@/api/generated/client/dashboard/dashboard";
import { getOperationsDashboard } from "@/api/generated/client/administration/administration";
import type {
  AnnouncementPublication,
  MyDashboard,
  OperationsDashboard,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
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
import { formatCompactCount } from "@/shared/lib/format";

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

/** Purely decorative sparkline for the reference stat cards (owner ruling
 * 2026-09-02): no axes or values, deterministic points so screenshot
 * baselines stay byte-stable, and layered beneath the label/value text. */
function sparkValues(seed: number, count = 24): number[] {
  let state = seed;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values.push(4 + (state / 2147483648) * 24);
  }
  return values;
}

function SparkBars({ seed, stroke }: { seed: number; stroke: string }) {
  const values = sparkValues(seed);
  const step = 100 / values.length;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="absolute inset-y-0 right-2 left-20 h-full w-auto"
      data-testid="stat-bars"
    >
      {values.map((value, i) => (
        <rect
          key={i}
          x={(i * step + step * 0.22).toFixed(2)}
          y={(30 - value).toFixed(2)}
          width={(step * 0.56).toFixed(2)}
          height={value.toFixed(2)}
          fill={stroke}
        />
      ))}
    </svg>
  );
}

interface StatCardProps {
  label: string;
  value: number | undefined;
  testId: string;
  icon: React.ReactNode;
  sparkSeed: number;
  sparkStroke: string;
}

/** Reference-image stat card: label + value left, framed icon right, and the
 * decorative bars filling the whole card height (+20% per owner ruling
 * 2026-09-02) — the SVG sits at Card level so it covers the padding too. */
function OperationsStatCard({ label, value, testId, icon, sparkSeed, sparkStroke }: StatCardProps) {
  return (
    <Card data-testid="workspace-admin-stat-card" className="relative min-h-[108px]">
      <SparkBars seed={sparkSeed} stroke={sparkStroke} />
      <CardContent className="relative z-10 flex h-full flex-row items-start justify-between gap-3">
        <div className="relative z-10 flex flex-col gap-1">
          <p className="text-sm font-normal">{label}</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
            {value === undefined ? "—" : formatCompactCount(value)}
          </p>
        </div>
        <div className="relative z-10 rounded-md border border-border bg-card/60 p-2.5 opacity-50">{icon}</div>
      </CardContent>
    </Card>
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
                {operations === undefined ? "—" : formatCompactCount(operations.change_order_total)}
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
            items={Object.fromEntries(
              WINDOW_OPTIONS.map((days) => [
                String(days),
                t("dashboard.admin.windowDays", { days }),
              ]),
            )}
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
}: {
  enabled: boolean;
  announcement: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState(30);
  const operations = useOperationsDashboardQuery(windowDays, enabled);

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="workspace-admin-dashboards">
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
          sparkSeed={11}
          sparkStroke="var(--chart-series-2)"
        />
        <OperationsStatCard
          label={t("dashboard.admin.userTotal")}
          value={operations.data?.user_total}
          testId="admin-user-total"
          icon={<Users className="size-4" />}
          sparkSeed={47}
          sparkStroke="var(--chart-series-user)"
        />
        <OperationsStatCard
          label={t("dashboard.admin.datasourceTotal")}
          value={operations.data?.datasource_total}
          testId="admin-datasource-total"
          icon={<Database className="size-4" />}
          sparkSeed={83}
          sparkStroke="var(--chart-series-2)"
        />
      </div>
    </div>
  );
}
