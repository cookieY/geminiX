import { useTranslation } from "react-i18next";
import type { Flow } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Badge } from "@/shared/components/ui/badge";
import { ArrowRight, Database } from "lucide-react";

/**
 * Flow and stage-path summary for the draft workspace header (migration
 * contract §4 item 1). Datasource display names are not exposed to
 * submitters by the API (listDatasources is admin-scoped), so the path shows
 * the stage positions with the frozen datasource references — server
 * identifiers, not guessed names.
 */
export function StagePath({ flow }: { flow: Flow | null | undefined }) {
  const { t } = useTranslation();
  const stages = flow?.stages ?? [];
  if (stages.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t("precheck.stagePath.unavailable")}</p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="stage-path">
      {stages.map((stage, index) => (
        <span key={stage.position} className="flex items-center gap-2">
          {index > 0 && <ArrowRight className="text-muted-foreground size-4" aria-hidden />}
          <Badge variant="outline" className="gap-1">
            <Database className="size-3" aria-hidden />
            {t("precheck.stagePath.stage", { position: stage.position })}
          </Badge>
        </span>
      ))}
    </div>
  );
}
