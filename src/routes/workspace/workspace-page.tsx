import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Hourglass, LayoutDashboard } from "lucide-react";
import { listCurrentUserFlows } from "@/api/generated/client/change-drafts/change-drafts";
import { FlowType } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

/**
 * Business home. FE-F3 keeps the honest "not delivered yet" placeholder for
 * the dashboard itself, but adds the first-login zero-permission contract
 * (auth PRD §11): a user with no flow grants and no admin capability sees the
 * explicit "waiting for admin configuration" state instead of a bare shell.
 * Grant data comes from the generated listCurrentUserFlows client for both
 * flow types — the page never guesses permissions client-side.
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
  const reviewFlows = useCurrentUserFlows(FlowType.change_review);
  const queryFlows = useCurrentUserFlows(FlowType.query_access);

  const isLoading = reviewFlows.isPending || queryFlows.isPending;
  const loadError = reviewFlows.error ?? queryFlows.error;
  const hasFlowGrants =
    ((reviewFlows.data?.items.length ?? 0) > 0 || (queryFlows.data?.items.length ?? 0) > 0);
  const isZeroPermission = user !== null && !user.can_access_admin && !hasFlowGrants;

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("nav.home")} />
      {isLoading ? (
        <LoadingState />
      ) : loadError != null ? (
        <ErrorState
          error={loadError}
          operationId="listCurrentUserFlows"
          onRetry={() => {
            void reviewFlows.refetch();
            void queryFlows.refetch();
          }}
        />
      ) : isZeroPermission ? (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Hourglass />
            </EmptyMedia>
            <EmptyTitle>{t("states.waitingForAdminTitle")}</EmptyTitle>
            <EmptyDescription>{t("states.waitingForAdminDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>{t("workspace.placeholderTitle")}</EmptyTitle>
            <EmptyDescription>{t("workspace.placeholderDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
