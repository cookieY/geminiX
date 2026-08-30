import { useTranslation } from "react-i18next";
import { LayoutDashboard } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";

/**
 * FE-F2 workspace placeholder. The home overview (greeting, update banner,
 * order trend, metric cards, announcements) is delivered by the Dashboard
 * work package; this page exists so the shell has a real route and carries
 * no fabricated metrics or demo statistics.
 */
export default function WorkspacePage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("nav.home")} />
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboard />
          </EmptyMedia>
          <EmptyTitle>{t("workspace.placeholderTitle")}</EmptyTitle>
          <EmptyDescription>{t("workspace.placeholderDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
