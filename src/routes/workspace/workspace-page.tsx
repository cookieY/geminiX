import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Hourglass, RefreshCw } from "lucide-react";
import { listCurrentUserFlows } from "@/api/generated/client/change-drafts/change-drafts";
import { FlowType } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { Button } from "@/shared/components/ui/button";
import {
  AdminDashboardSection,
  AnnouncementBanner,
  MyDashboardCards,
  useCurrentAnnouncementQuery,
  useMyDashboardQuery,
} from "@/routes/workspace/workspace-dashboard-sections";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

/**
 * Business home. Every logged-in user sees the homepage info — greeting,
 * announcement banner and their per-user counters (owner ruling 2026-09-02,
 * migration contract §18.6). The first-login zero-permission contract (auth
 * PRD §11) renders the "waiting for admin configuration" state as a notice
 * card alongside that info, never instead of it. Grant data comes from the
 * generated listCurrentUserFlows client for both flow types — the page never
 * guesses permissions client-side, so the notice appears only once both flow
 * queries resolved empty; a flows-query error may suppress the notice but
 * never the homepage info.
 */

interface FlowsPage {
  items: unknown[];
}

function useCurrentUserFlows(flowType: FlowType) {
  return useQuery({
    queryKey: ["auth", "flows", flowType],
    queryFn: async () => {
      return (await listCurrentUserFlows({ flow_type: flowType })) as unknown as FlowsPage;
    },
    retry: false,
    staleTime: 30_000,
  });
}

export default function WorkspacePage() {
  const { t } = useTranslation();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const reviewFlows = useCurrentUserFlows(FlowType.change_review);
  const queryFlows = useCurrentUserFlows(FlowType.query_access);
  const isAdmin = user?.can_access_admin === true;
  const dashboardQuery = useMyDashboardQuery(user !== null);
  const announcementQuery = useCurrentAnnouncementQuery(user !== null);

  // Dashboard PRD §9: 60s auto-refresh plus a manual refresh control.
  const refreshing =
    dashboardQuery.isFetching ||
    announcementQuery.isFetching ||
    reviewFlows.isFetching ||
    queryFlows.isFetching;
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["auth", "flows"] });
  };

  const hasFlowGrants =
    (reviewFlows.data?.items.length ?? 0) > 0 || (queryFlows.data?.items.length ?? 0) > 0;
  const isZeroPermission =
    user !== null && !user.can_access_admin && reviewFlows.isSuccess && queryFlows.isSuccess
    && !hasFlowGrants;

  return (
    <div className="flex flex-col gap-5" data-testid="workspace-page">
      <PageBreadcrumb title={t("nav.home")} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("workspace.greeting", { name: user?.display_name ?? user?.username ?? "" })}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {dashboardQuery.data === undefined
              ? ""
              : t("workspace.refreshedAt", {
                  time: dashboardQuery.data.refreshed_at
                    .replace("T", " ")
                    .replace("Z", " UTC"),
                })}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("workspace.refresh")}
          data-testid="workspace-refresh"
          disabled={refreshing}
          onClick={refreshAll}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>
      {isZeroPermission && (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Hourglass />
            </EmptyMedia>
            <EmptyTitle>{t("states.waitingForAdminTitle")}</EmptyTitle>
            <EmptyDescription>{t("states.waitingForAdminDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {announcementQuery.data !== undefined && (
        <AnnouncementBanner publication={announcementQuery.data} />
      )}
      <MyDashboardCards dashboard={dashboardQuery.data} />
      <AdminDashboardSection enabled={isAdmin} />
    </div>
  );
}
