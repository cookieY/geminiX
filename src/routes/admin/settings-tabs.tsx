import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

/**
 * Settings area navigation (§18.47): the five namespace tabs shared by the
 * generic settings pages AND the standalone AI-budget page, so the tab bar
 * no longer disappears when landing on /admin/settings/ai-budget.
 */
export type SettingsRouteNamespace = "general" | "query" | "execution" | "branding" | "ai-budget";

export function SettingsNavTabs({ current }: { current: SettingsRouteNamespace }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tabs key={current} defaultValue={current} className="max-w-full">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="general" onClick={() => { void navigate("/admin/settings/general"); }}>
          {t("adminSettings.tab.general")}
        </TabsTrigger>
        <TabsTrigger value="query" onClick={() => { void navigate("/admin/settings/query"); }}>
          {t("adminSettings.tab.query")}
        </TabsTrigger>
        <TabsTrigger value="execution" onClick={() => { void navigate("/admin/settings/execution"); }}>
          {t("adminSettings.tab.execution")}
        </TabsTrigger>
        <TabsTrigger value="branding" onClick={() => { void navigate("/admin/settings/branding"); }}>
          {t("adminSettings.tab.branding")}
        </TabsTrigger>
        <TabsTrigger value="ai-budget" onClick={() => { void navigate("/admin/settings/ai-budget"); }}>
          {t("adminSettings.tab.aiBudget")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
