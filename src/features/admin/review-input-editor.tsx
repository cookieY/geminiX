import { useTranslation } from "react-i18next";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Badge } from "@/shared/components/ui/badge";
import type {
  ReviewInputDefinition,
  ReviewInputDefinitionSeverityWhitelistItem,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Shared editor for the four-field review-input definition (migration
 * contract §9.3.2 / ai-review-production PRD: knowledge_text,
 * finding_template, severity_whitelist, version). Prompt Tools and internal
 * experience entries share exactly this structure — and only this
 * structure. There is deliberately NO field for executable behavior: no
 * code, no HTTP endpoint, no database write (gate: 无外部代码HTTP或写库
 * Custom Tool UI). The definition is the sole object the structured-output,
 * privacy-scan, injection-check and eval gates act on.
 */

export const SEVERITY_VALUES = ["info", "low", "medium", "high", "critical"] as const;
export const CATEGORY_VALUES = [
  "correctness",
  "performance",
  "availability",
  "security",
  "governance",
  "compatibility",
  "operability",
] as const;

export interface ReviewInputEditorValue {
  definition: ReviewInputDefinition;
  parameters: Record<string, number | string | boolean | string[]>;
}

export function ReviewInputDefinitionEditor({
  value,
  onChange,
}: {
  value: ReviewInputEditorValue;
  onChange: (next: ReviewInputEditorValue) => void;
}) {
  const { t } = useTranslation();
  const { definition } = value;
  const template = definition.finding_template;

  const patchDefinition = (patch: Partial<ReviewInputDefinition>) => {
    onChange({ ...value, definition: { ...definition, ...patch } });
  };
  const patchTemplate = (patch: Partial<ReviewInputDefinition["finding_template"]>) => {
    patchDefinition({ finding_template: { ...template, ...patch } });
  };

  const toggleSeverity = (severity: string) => {
    const current = definition.severity_whitelist;
    const next = current.includes(severity as ReviewInputDefinitionSeverityWhitelistItem)
      ? current.filter((s) => s !== severity)
      : ([...current, severity] as ReviewInputDefinitionSeverityWhitelistItem[]);
    if (next.length === 0) return; // minItems 1 — never render an empty whitelist
    patchDefinition({ severity_whitelist: next });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="review-input-editor">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-input-knowledge-text">{t("admin.reviewInput.knowledgeText")}</Label>
        <Textarea
          id="review-input-knowledge-text"
          rows={4}
          value={definition.knowledge_text}
          onChange={(event) => { patchDefinition({ knowledge_text: event.target.value }); }}
          data-testid="review-input-knowledge-text"
        />
        <p className="text-muted-foreground text-xs">{t("admin.reviewInput.knowledgeTextHint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-input-finding-key">{t("admin.reviewInput.findingKey")}</Label>
          <Input
            id="review-input-finding-key"
            value={template.finding_key ?? ""}
            onChange={(event) => { patchTemplate({ finding_key: event.target.value }); }}
            placeholder="experience.orders.fullscan"
            data-testid="review-input-finding-key"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("admin.reviewInput.category")}</Label>
          <Select
            value={template.category ?? "correctness"}
            onValueChange={(next) => {
              if (next === null) return;
              patchTemplate({ category: next });
            }}
          >
            <SelectTrigger data-testid="review-input-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_VALUES.map((category) => (
                <SelectItem key={category} value={category}>
                  {t(`admin.reviewInput.category_${category}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-input-title">{t("admin.reviewInput.title")}</Label>
        <Input
          id="review-input-title"
          value={template.title ?? ""}
          onChange={(event) => { patchTemplate({ title: event.target.value }); }}
          data-testid="review-input-title"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-input-message">{t("admin.reviewInput.message")}</Label>
        <Textarea
          id="review-input-message"
          rows={2}
          value={template.message ?? ""}
          onChange={(event) => { patchTemplate({ message: event.target.value }); }}
          data-testid="review-input-message"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-input-suggestion">{t("admin.reviewInput.suggestion")}</Label>
        <Textarea
          id="review-input-suggestion"
          rows={2}
          value={template.suggestion ?? ""}
          onChange={(event) => { patchTemplate({ suggestion: event.target.value }); }}
          data-testid="review-input-suggestion"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("admin.reviewInput.templateSeverity")}</Label>
        <div className="flex flex-wrap gap-1.5" data-testid="review-input-template-severity">
          {SEVERITY_VALUES.map((severity) => {
            const active = template.severity === severity;
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={active}
                onClick={() => { patchTemplate({ severity: active ? undefined : severity }); }}
                className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
                data-testid={`review-input-template-severity-${severity}`}
              >
                <Badge variant={active ? "default" : "outline"} className="cursor-pointer">
                  {t(`admin.reviewInput.severity_${severity}`)}
                </Badge>
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">{t("admin.reviewInput.templateSeverityHint")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("admin.reviewInput.severityWhitelist")}</Label>
        <div className="flex flex-wrap gap-1.5" data-testid="review-input-severity-whitelist">
          {SEVERITY_VALUES.map((severity) => {
            const active = definition.severity_whitelist.includes(severity);
            return (
              <button
                key={severity}
                type="button"
                aria-pressed={active}
                onClick={() => { toggleSeverity(severity); }}
                className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
                data-testid={`review-input-severity-${severity}`}
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
