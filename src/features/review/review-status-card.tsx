import { StatusBadge } from "@/shared/components/status/status-badge";
import type { StatusTone } from "@/shared/lib/status-tone";
import { useTranslation } from "react-i18next";
import type { ReviewRun } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Separator } from "@/shared/components/ui/separator";
import { EmptyState } from "@/shared/components/status/empty-state";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Loader2,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { RunPhase } from "./run-state";

/**
 * Review status and progress card (migration contract §4 items 3/4): the
 * observable run state, per-stage results, statement/fingerprint counts.
 * Every phase is expressed with text, icon and semantic color — color alone
 * never carries the state (UI spec §15).
 */

const PHASE_BADGE: Record<RunPhase, { key: string; icon: typeof Loader2; className: string; spin: boolean }> = {
  idle: { key: "precheck.phase.idle", icon: CircleDashed, className: "text-muted-foreground", spin: false },
  queued: { key: "precheck.phase.queued", icon: Loader2, className: "text-muted-foreground", spin: true },
  running: { key: "precheck.phase.running", icon: Loader2, className: "text-primary", spin: true },
  ready: { key: "precheck.phase.ready", icon: CheckCircle2, className: "text-[var(--risk-safe)]", spin: false },
  blocked: { key: "precheck.phase.blocked", icon: OctagonAlert, className: "text-[var(--risk-critical)]", spin: false },
  partial: { key: "precheck.phase.partial", icon: TriangleAlert, className: "text-[var(--risk-high)]", spin: false },
  failed: { key: "precheck.phase.failed", icon: OctagonAlert, className: "text-[var(--exec-failed)]", spin: false },
  outdated: { key: "precheck.phase.outdated", icon: TriangleAlert, className: "text-[var(--exec-partial-failed)]", spin: false },
};

const STAGE_TONE: Record<string, StatusTone> = { pending: "stone", running: "indigo", passed: "emerald", blocked: "red", partial: "orange", failed: "red" };

const STAGE_BADGE: Record<string, { key: string; className: string }> = {
  pending: { key: "precheck.stage.pending", className: "text-muted-foreground" },
  running: { key: "precheck.stage.running", className: "text-primary" },
  passed: { key: "precheck.stage.passed", className: "text-[var(--risk-safe)]" },
  blocked: { key: "precheck.stage.blocked", className: "text-[var(--risk-critical)]" },
  partial: { key: "precheck.stage.partial", className: "text-[var(--risk-high)]" },
  failed: { key: "precheck.stage.failed", className: "text-[var(--exec-failed)]" },
};

function stageBadgeOf(state: string): { key: string; className: string } {
  const badge = STAGE_BADGE[state];
  if (badge !== undefined) return badge;
  return { key: "precheck.stage.pending", className: "text-muted-foreground" };
}

export interface ReviewStatusCardProps {
  phase: RunPhase;
  run: ReviewRun | null;
  hasRunId: boolean;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ReviewStatusCard({
  phase,
  run,
  hasRunId,
  isPending,
  isError,
  error,
  onRetry,
}: ReviewStatusCardProps) {
  const { t } = useTranslation();
  const badge = isError
    ? {
        key: "precheck.review.errorBadge",
        icon: CircleAlert,
        className: "text-destructive",
        spin: false,
      }
    : hasRunId && (isPending || run === null) && phase === "idle"
      ? {
          key: "precheck.review.loadingBadge",
          icon: Loader2,
          className: "text-primary",
          spin: true,
        }
      : PHASE_BADGE[phase];
  const Icon = badge.icon;
  const summaries = run?.stage_results.filter(hasReviewSummary) ?? [];

  return (
    <Card data-testid="review-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className={`size-4 ${badge.spin ? "animate-spin" : ""}`} aria-hidden />
          {t("precheck.review.title")}
          <Badge variant="outline" className={badge.className}>
            {t(badge.key)}
          </Badge>
        </CardTitle>
        <CardDescription>{t("precheck.review.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!hasRunId && <EmptyState title={t("precheck.review.noRun")} />}
        {hasRunId && isError && (
          <div data-testid="review-status-error">
            <ErrorState
              error={error}
              operationId="getReviewRun"
              onRetry={onRetry}
            />
          </div>
        )}
        {hasRunId && !isError && run === null && (
          <div data-testid="review-status-loading">
            <LoadingState variant="inline" label={t("precheck.review.loading")} />
          </div>
        )}
        {hasRunId && !isError && run !== null && (
          <>
            <div className="text-sm" data-testid="review-counts">
              {t("precheck.review.statements", { count: run.statement_count })} ·{" "}
              {t("precheck.review.fingerprints", { count: run.fingerprint_group_count })}
            </div>
            {run.usage != null && (
              <p className="text-muted-foreground text-xs" data-testid="review-usage">
                {t("precheck.review.usageLine", {
                  model: run.usage.model_name,
                  provider: run.usage.provider_name,
                  input: run.usage.input_tokens,
                  output: run.usage.output_tokens,
                })}
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("precheck.review.stage")}</TableHead>
                  <TableHead>{t("precheck.review.state")}</TableHead>
                  <TableHead>{t("precheck.review.findings")}</TableHead>
                  <TableHead>{t("precheck.review.evidence")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.stage_results.map((stage) => {
                  const stageBadge = stageBadgeOf(stage.state);
                  return (
                    <TableRow key={stage.stage_position}>
                      <TableCell className="font-semibold text-foreground">{t("precheck.stagePath.stage", { position: stage.stage_position })}</TableCell>
                      <TableCell>
                        <StatusBadge tone={STAGE_TONE[stage.state] ?? "stone"}>
                          {t(stageBadge.key)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">{stage.finding_count}</TableCell>
                      <TableCell className="font-semibold text-foreground">{stage.evidence_count}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {summaries.length > 0 && (
              <>
                <Separator />
                <section
                  className="flex flex-col gap-3"
                  aria-label={t("precheck.review.summary")}
                  data-testid="review-summary"
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    {t("precheck.review.summary")}
                  </h3>
                  <dl className="flex flex-col gap-3">
                    {summaries.map((stage) => (
                      <div className="flex flex-col gap-1" key={stage.stage_position}>
                        <dt className="text-xs font-medium text-muted-foreground">
                          {t("precheck.stagePath.stage", { position: stage.stage_position })}
                        </dt>
                        <dd
                          className="text-sm leading-6 text-foreground"
                          lang={stage.summary_locale}
                        >
                          {stage.summary}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </>
            )}
            {run.failure_code != null && (
              <p className="text-sm text-[var(--exec-failed)]" data-testid="review-failure">
                {t(`precheck.failure.${knownFailureKey(run.failure_code)}`)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function hasReviewSummary(
  stage: ReviewRun["stage_results"][number],
): stage is ReviewRun["stage_results"][number] & {
  summary: string;
  summary_locale: "zh-CN" | "en-US";
} {
  return (
    typeof stage.summary === "string" &&
    stage.summary.trim() !== "" &&
    (stage.summary_locale === "zh-CN" || stage.summary_locale === "en-US")
  );
}

/** failure_code is an open string; only known outcomes get specific copy. */
function knownFailureKey(code: string): string {
  switch (code) {
    case "provider_unavailable":
      return "provider_unavailable";
    case "budget_exhausted":
      return "budget_exhausted";
    case "timed_out":
      return "timed_out";
    default:
      return "generic";
  }
}
