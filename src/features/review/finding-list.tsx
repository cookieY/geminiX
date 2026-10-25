import { useTranslation } from "react-i18next";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Badge } from "@/shared/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { EmptyState } from "@/shared/components/status/empty-state";
import { LoadingState } from "@/shared/components/status/loading-state";
import { ErrorState } from "@/shared/components/status/status-components";
import { CircleAlert, Crosshair, FileSearch, TriangleAlert } from "lucide-react";
import { useSeverityFilter } from "./use-draft-workspace";

/**
 * Structured finding list (migration contract §4 item 5): severity filter,
 * stage/group context, suggestion, evidence and SQL locating. Only the
 * contract fields render — model reasoning is not part of the API surface
 * and never appears in the UI (PRD F4: 不展示思维链).
 */

const SEVERITY_BADGE: Record<ReviewFinding["severity"], { key: string; className: string }> = {
  // F12 #009：info为不拦门的信息级（与low同视觉档，不抬升最高级）。
  info: { key: "precheck.severity.info", className: "text-muted-foreground" },
  low: { key: "precheck.severity.low", className: "text-muted-foreground" },
  medium: { key: "precheck.severity.medium", className: "text-[var(--risk-warning)]" },
  high: { key: "precheck.severity.high", className: "text-[var(--risk-high)]" },
  critical: { key: "precheck.severity.critical", className: "text-[var(--risk-critical)]" },
};

/**
 * Findings are only an empty result after a complete terminal review.
 * Keeping all query/lifecycle states explicit prevents pending, failed, or
 * incomplete reviews from being presented as "no risks".
 */
export type FindingListState =
  | { status: "idle" }
  | { status: "waiting" }
  | { status: "stale" }
  | { status: "loading" }
  | { status: "error"; error: unknown; operationId?: string }
  | { status: "incomplete"; findings: ReviewFinding[] }
  | { status: "ready"; findings: ReviewFinding[] };

export interface FindingListProps {
  state: FindingListState;
  onOpenEvidence: (finding: ReviewFinding) => void;
  onLocate?: (finding: ReviewFinding) => void;
  onRetry?: () => void;
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

export function FindingList({ state, onOpenEvidence, onLocate, onRetry, locateInEditor }: FindingListProps) {
  const { t } = useTranslation();
  const { severity, setSeverity, visible } = useSeverityFilter();
  const findings =
    state.status === "ready" || state.status === "incomplete" ? state.findings : null;
  const visibleFindings = findings === null ? [] : visible(findings);

  return (
    <Card data-testid="finding-list">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("precheck.findings.title")}</CardTitle>
        {findings !== null && findings.length > 0 && (
          <Select
            value={severity}
            onValueChange={(value) => { setSeverity(value as "all" | "low" | "medium" | "high" | "critical"); }
            }
            items={{
              all: t("precheck.findings.filterAll"),
              low: t("precheck.severity.low"),
              medium: t("precheck.severity.medium"),
              high: t("precheck.severity.high"),
              critical: t("precheck.severity.critical"),
            }}
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
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.status === "idle" && (
          <EmptyState
            title={t("precheck.findings.idleTitle")}
            description={t("precheck.findings.idleDescription")}
            testId="findings-idle"
          />
        )}
        {state.status === "waiting" && (
          <Alert
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="findings-waiting"
          >
            <Spinner aria-hidden />
            <AlertTitle>{t("precheck.findings.waitingTitle")}</AlertTitle>
            <AlertDescription>{t("precheck.findings.waitingDescription")}</AlertDescription>
          </Alert>
        )}
        {state.status === "stale" && (
          <Alert data-testid="findings-stale">
            <CircleAlert className="size-4" aria-hidden />
            <AlertTitle>{t("precheck.findings.staleTitle")}</AlertTitle>
            <AlertDescription>{t("precheck.findings.staleDescription")}</AlertDescription>
          </Alert>
        )}
        {state.status === "loading" && (
          <div data-testid="findings-loading">
            <LoadingState variant="inline" label={t("precheck.findings.loading")} />
          </div>
        )}
        {state.status === "error" && (
          <div data-testid="findings-error">
            <ErrorState
              error={state.error}
              operationId={state.operationId ?? "listReviewRunFindings"}
              onRetry={onRetry}
            />
          </div>
        )}
        {state.status === "incomplete" && (
          <Alert data-testid="findings-incomplete">
            <TriangleAlert className="text-[var(--risk-warning)]" aria-hidden />
            <AlertTitle>{t("precheck.findings.incompleteTitle")}</AlertTitle>
            <AlertDescription>{t("precheck.findings.incompleteDescription")}</AlertDescription>
          </Alert>
        )}
        {state.status === "ready" && state.findings.length === 0 && (
          <EmptyState
            title={t("precheck.findings.emptyAll")}
            description={t("precheck.findings.emptyAllDescription")}
            testId="findings-empty-all"
          />
        )}
        {findings !== null && findings.length > 0 && visibleFindings.length === 0 && (
          <EmptyState
            filtered
            title={t("precheck.findings.emptyFiltered")}
            testId="findings-empty"
          />
        )}
        {findings !== null && visibleFindings.length > 0
          ? visibleFindings.map((finding) => {
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
            })
          : null}
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
