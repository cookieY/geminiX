import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

/**
 * Settings area navigation (§18.47): the five namespace tabs shared by the
 * generic settings pages AND the standalone notifications page, so the tab
 * bar no longer disappears when landing on /admin/settings/notifications.
 * AI预算已迁至审核引擎分组（owner 2026-10-31），不再是设置tab。
 */
export type SettingsRouteNamespace =
  | "general"
  | "query"
  | "execution"
  | "branding"
  | "notifications";

export function SettingsNavTabs({ current }: { current: SettingsRouteNamespace }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tabs key={current} defaultValue={current} className="max-w-full">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="general" data-testid={"settings-tab-general"} onClick={() => { void navigate("/admin/settings/general"); }}>
          {t("adminSettings.tab.general")}
        </TabsTrigger>
        <TabsTrigger value="query" data-testid={"settings-tab-query"} onClick={() => { void navigate("/admin/settings/query"); }}>
          {t("adminSettings.tab.query")}
        </TabsTrigger>
        <TabsTrigger value="execution" data-testid={"settings-tab-execution"} onClick={() => { void navigate("/admin/settings/execution"); }}>
          {t("adminSettings.tab.execution")}
        </TabsTrigger>
        <TabsTrigger value="branding" data-testid={"settings-tab-branding"} onClick={() => { void navigate("/admin/settings/branding"); }}>
          {t("adminSettings.tab.branding")}
        </TabsTrigger>
        <TabsTrigger value="notifications" data-testid={"settings-tab-notifications"} onClick={() => { void navigate("/admin/settings/notifications"); }}>
          {t("adminSettings.tab.notifications")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
