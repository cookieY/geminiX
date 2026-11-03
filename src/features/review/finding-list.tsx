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
import { CircleAlert, Crosshair, FileSearch, Lightbulb, Link2, TriangleAlert } from "lucide-react";
import { useSeverityFilter } from "./use-draft-workspace";
import { FindingText } from "./finding-text";

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
  | { status: "expired" }
  | { status: "loading" }
  | { status: "error"; error: unknown; operationId?: string }
  | { status: "incomplete"; findings: ReviewFinding[] }
  | { status: "ready"; findings: ReviewFinding[] };

export interface FindingListProps {
  state: FindingListState;
  onOpenEvidence: (findings: ReviewFinding[]) => void;
  onLocate?: (finding: ReviewFinding) => void;
  onRetry?: () => void;
  /** Whether a quoted snippet currently exists in the editor text. */
  locateInEditor?: (snippet: string) => boolean;
  /** Sits inside another card: drop this card's own surface and padding. */
  flat?: boolean;
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

/**
 * Presentation-layer grouping (owner ruling 2026-10-31): findings bound to
 * the same server-provided fingerprint group render as ONE card led by the
 * highest severity; the remaining same-group findings stay fully visible as
 * secondary sub-items (title + suggestion up front, technical message and
 * evidence one expand away). Nothing is deleted — this is the sanctioned
 * display-layer grouping, not a semantic merge; backend-authoritative
 * merging is proposed separately (RCP-20261031-FINDING-CONDITION-MERGE).
 */
const SEVERITY_RANK: Record<ReviewFinding["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

type FindingUnit =
  | { kind: "single"; finding: ReviewFinding }
  | { kind: "group"; primary: ReviewFinding; others: ReviewFinding[] };

function buildUnits(findings: ReviewFinding[]): FindingUnit[] {
  const members = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const groupId = finding.fingerprint_group_id;
    if (groupId == null || groupId === "") continue;
    const list = members.get(groupId) ?? [];
    list.push(finding);
    members.set(groupId, list);
  }
  const units: FindingUnit[] = [];
  const emitted = new Set<string>();
  for (const finding of findings) {
    const groupId = finding.fingerprint_group_id;
    if (groupId == null || groupId === "") {
      units.push({ kind: "single", finding });
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);
    const sorted = [...(members.get(groupId) ?? [])].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );
    const [top, ...rest] = sorted;
    if (top !== undefined && sorted.length >= 2) {
      units.push({ kind: "group", primary: top, others: rest });
    } else {
      units.push({ kind: "single", finding });
    }
  }
  return units;
}

export function FindingList({ state, onOpenEvidence, onLocate, onRetry, locateInEditor, flat = false }: FindingListProps) {
  const { t } = useTranslation();
  const { severity, setSeverity, visible } = useSeverityFilter();
  const findings =
    state.status === "ready" || state.status === "incomplete" ? state.findings : null;
  const visibleFindings = findings === null ? [] : visible(findings);

  return (
    <Card className={flat ? "gap-3 rounded-none bg-transparent py-0 ring-0 [--card-spacing:0px]" : undefined} data-testid="finding-list">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("precheck.findings.title")}</CardTitle>
        {findings !== null && findings.length > 0 && (
          <Select
            value={severity}
            onValueChange={(value) => {
              setSeverity(value as "all" | ReviewFinding["severity"]);
            }}
            items={{
              all: t("precheck.findings.filterAll"),
              info: t("precheck.severity.info"),
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
              <SelectItem value="info">{t("precheck.severity.info")}</SelectItem>
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
        {state.status === "expired" && (
          <Alert data-testid="findings-expired">
            <CircleAlert className="size-4" aria-hidden />
            <AlertTitle>{t("precheck.findings.expiredTitle")}</AlertTitle>
            <AlertDescription>{t("precheck.findings.expiredDescription")}</AlertDescription>
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
          ? buildUnits(visibleFindings).map((unit) => {
              const finding = unit.kind === "group" ? unit.primary : unit.finding;
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
                      <span aria-hidden className="bg-current size-1.5 shrink-0 rounded-full" />
                      {t(badge.key)}
                    </Badge>
                    <Badge variant="secondary">{t(categoryKey(finding.category))}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {t("precheck.stagePath.stage", { position: finding.stage_position })}
                    </span>
                  </header>
                  <h4 className="mt-2 leading-snug font-semibold break-words">
                    <FindingText text={finding.title} />
                  </h4>
                  <p className="mt-1.5 leading-relaxed break-words">
                    <FindingText text={finding.message} />
                  </p>
                  {finding.suggestion != null && finding.suggestion !== "" && (
                    <div
                      className="bg-muted/40 mt-2 rounded-r-md border-l-2 border-primary p-2.5"
                      data-testid="finding-suggestion"
                    >
                      <p className="flex items-center gap-1.5 text-xs font-medium">
                        <Lightbulb className="size-3.5" aria-hidden />
                        {t("precheck.findings.suggestion")}
                      </p>
                      <div className="mt-1 leading-relaxed break-words">
                        <FindingText text={finding.suggestion} />
                      </div>
                    </div>
                  )}
                  {unit.kind === "group" && (
                    <section className="mt-2.5" data-testid="finding-group-others">
                      <p className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
                        <Link2 className="size-3" aria-hidden />
                        {t("precheck.findings.groupOthers")}
                      </p>
                      <div className="mt-1.5 space-y-2.5">
                        {unit.others.map((sub) => {
                          const subBadge = SEVERITY_BADGE[sub.severity];
                          const subLocateTarget =
                            onLocate !== undefined &&
                            (locateInEditor?.(locateSnippet(sub) ?? "") ?? true)
                              ? locateSnippet(sub)
                              : null;
                          return (
                            <div
                              key={sub.id}
                              className="border-t pt-2.5"
                              data-testid="finding-sub-item"
                              data-severity={sub.severity}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={subBadge.className}>
                                  <span aria-hidden className="bg-current size-1.5 shrink-0 rounded-full" />
                                  {t(subBadge.key)}
                                </Badge>
                                <Badge variant="secondary">{t(categoryKey(sub.category))}</Badge>
                              </div>
                              <h5 className="mt-1 text-[13px] leading-snug font-medium break-words">
                                <FindingText text={sub.title} />
                              </h5>
                              {sub.suggestion != null && sub.suggestion !== "" && (
                                <p className="mt-1 text-[13px] leading-relaxed break-words">
                                  <span className="font-medium">
                                    {t("precheck.findings.suggestion")}：
                                  </span>
                                  <FindingText text={sub.suggestion} />
                                </p>
                              )}
                              <details className="mt-1" data-testid="finding-sub-detail">
                                <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                                  {t("precheck.findings.subDetail")}
                                </summary>
                                <p className="mt-1 text-[13px] leading-relaxed break-words">
                                  <FindingText text={sub.message} />
                                </p>
                                <footer className="mt-1.5 flex flex-wrap gap-2">
                                  {onLocate !== undefined && subLocateTarget !== null && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => { onLocate(sub); }}
                                      data-testid={`locate-${sub.id}`}
                                    >
                                      <Crosshair className="size-3.5" aria-hidden />
                                      {t("precheck.findings.locate")}
                                    </Button>
                                  )}
                                </footer>
                              </details>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  <footer className="mt-2 flex flex-wrap gap-2">
                    {(finding.evidence_ids.length > 0 ||
                      (unit.kind === "group" &&
                        unit.others.some((sub) => sub.evidence_ids.length > 0))) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { onOpenEvidence([finding, ...(unit.kind === "group" ? unit.others : [])]); }}
                      >
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
