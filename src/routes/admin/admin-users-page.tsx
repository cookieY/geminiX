import { useTranslation } from "react-i18next";
import { UsersRound } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";

/**
 * Honest placeholder behind the admin capability guard. The real user
 * management page arrives with the F10 administration package; this route
 * exists so the capability-driven access path (server `can_access_admin`)
 * is observable end to end. It renders no fabricated user data.
 */
export default function AdminUsersPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("nav.admin.users")} />
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRound />
          </EmptyMedia>
          <EmptyTitle>{t("states.notDeliveredTitle")}</EmptyTitle>
          <EmptyDescription>{t("states.notDeliveredDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
