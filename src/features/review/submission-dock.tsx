import { useTranslation } from "react-i18next";
import type { SubmissionGate } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Send, ShieldAlert } from "lucide-react";
import {
  gateBlockers,
  submissionDecision,
  type RunPhase,
} from "./run-state";

/**
 * Submission readiness dock (migration contract §4 item 7): the bottom
 * decision area mirrors the backend gate — Ready + passing gate is the only
 * state that unlocks 提交审批, every blocker explains itself in place. The
 * enabled button is presentation only; the backend re-validates everything
 * inside the submission transaction (PRD §2 constraint 9).
 */

export interface SubmissionDockProps {
  draftState: "draft" | "reviewing" | "ready" | "blocked" | "partial" | "failed" | "outdated" | "submitted" | null;
  phase: RunPhase;
  gate: SubmissionGate | null;
  dirty: boolean;
  flowUpdated: boolean;
  /** The run's frozen revision matches the current draft revision. */
  reviewCurrent: boolean;
  submitting: boolean;
  onSubmit: () => void;
}

export function SubmissionDock(props: SubmissionDockProps) {
  const { t } = useTranslation();
  const decision = submissionDecision({
    draftState: props.draftState,
    runPhase: props.phase,
    gate: props.gate,
    dirty: props.dirty,
    flowUpdated: props.flowUpdated,
    reviewCurrent: props.reviewCurrent,
  });
  const blockers = gateBlockers(props.gate);

  return (
    <footer
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 border-t backdrop-blur"
      data-testid="submission-dock"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3">
        {props.flowUpdated && (
          <Alert data-testid="flow-updated-alert">
            <ShieldAlert className="size-4" aria-hidden />
            <AlertTitle>{t("precheck.flowUpdated.title")}</AlertTitle>
            <AlertDescription>{t("precheck.flowUpdated.description")}</AlertDescription>
          </Alert>
        )}
        {!props.flowUpdated && blockers.length > 0 && (
          <Alert variant="destructive" data-testid="gate-blockers">
            <ShieldAlert className="size-4" aria-hidden />
            <AlertTitle>{t("precheck.blocked.gate")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {blockers.map((blocker) => (
                  <li key={blocker.code}>{t(blocker.messageKey)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground flex-1 text-sm" data-testid="submission-readiness">
            {decision.submitEnabled
              ? t("precheck.submit.ready")
              : decision.reasonKey !== null
                ? t(decision.reasonKey)
                : t("precheck.blocked.gate")}
          </p>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <Button
            onClick={props.onSubmit}
            disabled={!decision.submitEnabled || props.submitting}
            data-testid="submit-draft"
          >
            <Send className="size-4" aria-hidden />
            {t("precheck.submit.action")}
          </Button>
        </div>
      </div>
    </footer>
  );
}
