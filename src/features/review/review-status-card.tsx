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
import { CheckCircle2, CircleDashed, Loader2, OctagonAlert, TriangleAlert } from "lucide-react";
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

export function ReviewStatusCard({ phase, run }: { phase: RunPhase; run: ReviewRun | null }) {
  const { t } = useTranslation();
  const badge = PHASE_BADGE[phase];
  const Icon = badge.icon;

  return (
    <Card data-testid="review-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`size-4 ${badge.spin ? "animate-spin" : ""}`} aria-hidden />
          {t("precheck.review.title")}
          <Badge variant="outline" className={badge.className}>
            {t(badge.key)}
          </Badge>
        </CardTitle>
        <CardDescription>{t("precheck.review.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {run !== null && (
          <>
            <div className="text-sm" data-testid="review-counts">
              {t("precheck.review.statements", { count: run.statement_count })} ·{" "}
              {t("precheck.review.fingerprints", { count: run.fingerprint_group_count })}
            </div>
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
                      <TableCell>{t("precheck.stagePath.stage", { position: stage.stage_position })}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 ${stageBadge.className}`}>
                          {t(stageBadge.key)}
                        </span>
                      </TableCell>
                      <TableCell>{stage.finding_count}</TableCell>
                      <TableCell>{stage.evidence_count}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {run.failure_code != null && (
              <p className="text-sm text-[var(--exec-failed)]" data-testid="review-failure">
                {t(`precheck.failure.${knownFailureKey(run.failure_code)}`)}
              </p>
            )}
          </>
        )}
        {run === null && <p className="text-muted-foreground text-sm">{t("precheck.review.noRun")}</p>}
      </CardContent>
    </Card>
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
