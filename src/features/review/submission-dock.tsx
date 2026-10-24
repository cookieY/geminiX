import type * as React from "react";
import { useTranslation } from "react-i18next";
import type { SubmissionGate } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { ArrowRight, Loader2, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
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
  /** Panel only: a secondary action rendered on the same row as the submit
   * button (owner ruling 2026-10-24: 提交审批 + 保存并返回 share one row). */
  aside?: React.ReactNode;
  /**
   * Presentation surface (owner layout ruling 2026-10-24): "dock" is the
   * legacy sticky bottom bar; "panel" embeds the same decision content into
   * the submission page's summary card — full-width submit, no own chrome.
   */
  variant?: "dock" | "panel";
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
  const panel = props.variant === "panel";

  const inner = (
    <>
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
      <p className="text-muted-foreground text-sm" data-testid="submission-readiness">
        {decision.submitEnabled
          ? t("precheck.submit.ready")
          : decision.reasonKey !== null
            ? t(decision.reasonKey)
            : t("precheck.blocked.gate")}
      </p>
      {panel ? (
        /* Interactive hover submit (shadcn button-19 block, verbatim owner
         * ruling 2026-10-24: outline pill — 黑底白字白点 at rest, the primary
         * dot floods to 白底黑字 on hover). The dot grows via
         * left/top/width/height (reviewed layout-transition exception in
         * scan-motion.mjs); variant="outline" is the block's own surface. */
        <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={props.onSubmit}
          disabled={!decision.submitEnabled || props.submitting}
          className="group relative h-10 flex-1 overflow-hidden rounded-full text-sm font-semibold"
          data-testid="submit-draft"
        >
          {/* The resting label does NOT slide out (owner 2026-10-24: 原字体
              不应有向右的动画) — the flooding dot simply covers it. */}
          <span className="inline-block pl-2">
            {props.submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("precheck.submit.action")}
          </span>
          <span
            aria-hidden
            className="text-primary-foreground absolute top-0 z-10 flex h-full w-full translate-x-full items-center justify-start gap-2 pl-6 opacity-0 transition-[transform,opacity] duration-300 group-hover:translate-x-0 group-hover:opacity-100"
          >
            {t("precheck.submit.action")}
            <ArrowRight className="size-4" aria-hidden />
          </span>
          <span
            aria-hidden
            className="bg-primary absolute top-1/2 left-3 h-2 w-2 -translate-y-1/2 scale-100 rounded-full transition-[left,top,width,height,transform] duration-300 group-hover:left-0 group-hover:top-0 group-hover:h-full group-hover:w-full group-hover:translate-y-0 group-hover:scale-[1.8]"
            />
          </Button>
          {props.aside}
        </div>
      ) : (
        <Button
          onClick={props.onSubmit}
          disabled={!decision.submitEnabled || props.submitting}
          data-testid="submit-draft"
        >
          {props.submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {t("precheck.submit.action")}
        </Button>
      )}
    </>
  );

  if (panel) {
    return (
      <div className="flex flex-col gap-2" data-testid="submission-dock">
        {inner}
      </div>
    );
  }

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
