import { useTranslation } from "react-i18next";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Crosshair, FileSearch } from "lucide-react";
import { useSeverityFilter } from "./use-draft-workspace";

/**
 * Structured finding list (migration contract §4 item 5): severity filter,
 * stage/group context, suggestion, evidence and SQL locating. Only the
 * contract fields render — model reasoning is not part of the API surface
 * and never appears in the UI (PRD F4: 不展示思维链).
 */

const SEVERITY_BADGE: Record<ReviewFinding["severity"], { key: string; className: string }> = {
  low: { key: "precheck.severity.low", className: "text-muted-foreground" },
  medium: { key: "precheck.severity.medium", className: "text-[var(--risk-warning)]" },
  high: { key: "precheck.severity.high", className: "text-[var(--risk-high)]" },
  critical: { key: "precheck.severity.critical", className: "text-[var(--risk-critical)]" },
};

export interface FindingListProps {
  findings: ReviewFinding[];
  onOpenEvidence: (finding: ReviewFinding) => void;
  onLocate?: (finding: ReviewFinding) => void;
  /** Whether a quoted snippet currently exists in the editor text. */
  locateInEditor?: (snippet: string) => boolean;
}

/** The closed category vocabulary from api/contracts/ai-review-output.schema.json. */
const CATEGORY_KEYS: Record<string, string> = {
  correctness: "precheck.category.correctness",
  performance: "precheck.category.performance",
  availability: "precheck.category.availability",
  security: "precheck.category.security",
  governance: "precheck.category.governance",
  compatibility: "precheck.category.compatibility",
  operability: "precheck.category.operability",
};

export function FindingList({ findings, onOpenEvidence, onLocate, locateInEditor }: FindingListProps) {
  const { t } = useTranslation();
  const { severity, setSeverity, visible } = useSeverityFilter();
  const visibleFindings = visible(findings);

  return (
    <Card data-testid="finding-list">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("precheck.findings.title")}</CardTitle>
        <Select
          value={severity}
          onValueChange={(value) => { setSeverity(value as "all" | "low" | "medium" | "high" | "critical"); }
          }
        >
          <SelectTrigger className="w-32" aria-label={t("precheck.findings.filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("precheck.findings.filterAll")}</SelectItem>
            <SelectItem value="low">{t("precheck.severity.low")}</SelectItem>
            <SelectItem value="medium">{t("precheck.severity.medium")}</SelectItem>
            <SelectItem value="high">{t("precheck.severity.high")}</SelectItem>
            <SelectItem value="critical">{t("precheck.severity.critical")}</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleFindings.length === 0 && (
          <p className="text-muted-foreground text-sm" data-testid="findings-empty">
            {t("precheck.findings.empty")}
          </p>
        )}
        {visibleFindings.map((finding) => {
          const badge = SEVERITY_BADGE[finding.severity];
          const locateTarget =
            onLocate !== undefined && (locateInEditor?.(locateSnippet(finding) ?? "") ?? true)
              ? locateSnippet(finding)
              : null;
          return (
            <article
              key={finding.id}
              className="rounded-md border p-3 text-sm"
              data-testid="finding-item"
              data-severity={finding.severity}
            >
              <header className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={badge.className}>
                  {t(badge.key)}
                </Badge>
                <Badge variant="secondary">{t(categoryKey(finding.category))}</Badge>
                <span className="text-muted-foreground text-xs">
                  {t("precheck.stagePath.stage", { position: finding.stage_position })}
                </span>
              </header>
              <h4 className="mt-2 font-medium">{finding.title}</h4>
              <p className="mt-1">{finding.message}</p>
              {finding.suggestion !== null && (
                <p className="text-muted-foreground mt-1">
                  {t("precheck.findings.suggestion")}: {finding.suggestion}
                </p>
              )}
              <footer className="mt-2 flex flex-wrap gap-2">
                {finding.evidence_ids.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => { onOpenEvidence(finding); }}>
                    <FileSearch className="size-3.5" aria-hidden />
                    {t("precheck.evidence.open")}
                  </Button>
                )}
                {onLocate !== undefined && locateTarget !== null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { onLocate(finding); }}
                    data-testid={`locate-${finding.id}`}
                  >
                    <Crosshair className="size-3.5" aria-hidden />
                    {t("precheck.findings.locate")}
                  </Button>
                )}
              </footer>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * SQL locating is presentation-only: a finding can be located when its text
 * quotes an exact SQL snippet (backtick-delimited in the server message) and
 * that snippet exists in the editor. No backend coordinates are invented —
 * findings without a quoted, matching snippet offer no locate affordance.
 */
function categoryKey(category: string): string {
  return CATEGORY_KEYS[category] ?? "precheck.category.other";
}

function locateSnippet(finding: ReviewFinding): string | null {
  const match = /`([^`]+)`/.exec(finding.message);
  return match?.[1] ?? null;
}
