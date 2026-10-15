import { useTranslation } from "react-i18next";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Badge } from "@/shared/components/ui/badge";
import type { ReviewInputDefinition } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Shared editor for the review-input definition (§18.66 five-field model:
 * name / state / engine live in the page form, this editor carries rule
 * content + max severity). The definition is {knowledge_text, max_severity,
 * version}: the finding key is system-derived per row and injected into the
 * model context together with the rule text — there is deliberately NO field
 * for it (nor for finding templates, categories or fix suggestions: the
 * review model authors those per finding at run time). There is also NO
 * field for executable behavior: no code, no HTTP endpoint, no database
 * write. The definition is the sole object the structured-output,
 * privacy-scan and injection-check eval gates act on.
 */

export const SEVERITY_VALUES = ["info", "low", "medium", "high", "critical"] as const;

export interface ReviewInputEditorValue {
  definition: ReviewInputDefinition;
  parameters: Record<string, number | string | boolean | string[]>;
}

export function ReviewInputDefinitionEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ReviewInputEditorValue;
  onChange: (next: ReviewInputEditorValue) => void;
  /** Locks every definition field — used for built-in skills whose
   * definition face is system-owned (only the state may be toggled). */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { definition } = value;

  const patchDefinition = (patch: Partial<ReviewInputDefinition>) => {
    if (disabled) return;
    onChange({ ...value, definition: { ...definition, ...patch } });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="review-input-editor">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-input-knowledge-text">{t("admin.reviewInput.knowledgeText")}</Label>
        <Textarea
          id="review-input-knowledge-text"
          rows={6}
          value={definition.knowledge_text}
          onChange={(event) => { patchDefinition({ knowledge_text: event.target.value }); }}
          disabled={disabled}
          data-testid="review-input-knowledge-text"
        />
        <p className="text-muted-foreground text-xs">{t("admin.reviewInput.knowledgeTextHint")}</p>
      </div>
      {/* §18.66：唯一严重级别控件——发现允许的最高档（向下闭包 info..所选档）。
       * finding key 由系统按行派生并随规则正文注入模型上下文，用户不可见。 */}
      <div className="flex flex-col gap-1.5">
        <Label>{t("admin.reviewInput.severityWhitelist")}</Label>
        <div className="flex flex-wrap gap-1.5" data-testid="review-input-max-severity">
          {SEVERITY_VALUES.map((severity) => {
            const active = definition.max_severity === severity;
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={active}
                onClick={() => { patchDefinition({ max_severity: severity }); }}
                disabled={disabled}
                className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
                data-testid={`review-input-max-severity-${severity}`}
              >
                <Badge variant={active ? "default" : "outline"} className="cursor-pointer">
                  {t(`admin.reviewInput.severity_${severity}`)}
                </Badge>
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">{t("admin.reviewInput.severityWhitelistHint")}</p>
      </div>
    </div>
  );
}
