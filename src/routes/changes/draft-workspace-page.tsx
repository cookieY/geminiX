import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ChangeDraft,
  ReviewFinding,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  replaceDraftSql,
  revealDraftSql,
  runDraftReview,
  submitChangeDraft,
} from "@/api/generated/client/change-drafts/change-drafts";
import { useDraftEditorStore, selectDirty } from "@/features/review/draft-editor-store";
import { isTerminalPhase, presentPhase, type RunPhase } from "@/features/review/run-state";
import { EvidenceSheet } from "@/features/review/evidence-sheet";
import { FindingList } from "@/features/review/finding-list";
import { ReviewStatusCard } from "@/features/review/review-status-card";
import { SqlEditorPanel } from "@/features/review/sql-editor-panel";
import { StagePath } from "@/features/review/stage-path";
import { SubmissionDock } from "@/features/review/submission-dock";
import { startReviewEvents, stopReviewEvents } from "@/features/review/review-events";
import {
  useChangeDraft,
  useCurrentUserChangeFlows,
  useFlowUpdated,
  useReviewFindings,
  useReviewRun,
} from "@/features/review/use-draft-workspace";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { CircleAlert, FileCode2, Play, Save } from "lucide-react";

/**
 * AI Precheck Workspace (route /changes/drafts/:id; frontend PRD F4,
 * migration contract §4): SQL editor on the left, the precheck workspace on
 * the right (SQL:AI ≈ 7:3 per the validated concept hierarchy), the
 * submission dock at the bottom. The review is always explicit — nothing on
 * this page triggers a run by itself (work-package gate: 打开编辑不自动
 * Review); SQL changes void a prior result locally the instant they happen.
 */

const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

function idempotencyKey(): string {
  return `draft-${crypto.randomUUID()}`;
}

function ifMatch(revision: number | null): Record<string, string> {
  return { "If-Match": `"${String(revision ?? 1)}"` };
}

/** Optimistic-concurrency header built from the live store state: inside a
 * save→run chain the zustand update from the PUT response has already landed
 * here even though React has not re-rendered yet. */
function liveIfMatch(): Record<string, string> {
  return ifMatch(useDraftEditorStore.getState().savedRevision);
}

export default function DraftWorkspacePage() {
  const { t } = useTranslation();
  const { draftId } = useParams<{ draftId: string }>();
  const queryClient = useQueryClient();
  const draftQuery = useChangeDraft(draftId ?? "");
  const flowsQuery = useCurrentUserChangeFlows();
  const draft = draftQuery.data ?? null;

  const store = useDraftEditorStore();
  const dirty = useDraftEditorStore(selectDirty);
  const flowUpdated = useFlowUpdated(draft?.flow_id ?? null);

  const [loadValue, setLoadValue] = useState<{ text: string; nonce: number } | null>(null);
  const [locate, setLocate] = useState<{ target: string; nonce: number } | null>(null);
  const [evidenceFinding, setEvidenceFinding] = useState<ReviewFinding | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<string | null>(null);
  const [timedOutState, setTimedOutState] = useState<{ phase: RunPhase; timedOut: boolean }>({
    phase: "idle",
    timedOut: false,
  });

  // Attach the editor store once per draft: the server draft carries no SQL
  // plaintext (it never does), so the editor starts empty until an explicit
  // reveal loads it.
  const attachedDraftId = useRef<string | null>(null);
  useEffect(() => {
    if (draft === null || attachedDraftId.current === draft.id) return;
    attachedDraftId.current = draft.id;
    store.attach({ id: draft.id, state: draft.state, revision: draft.revision, sql: null });
  }, [draft, store]);

  // The shared event feed lives for the page's lifetime; the client keeps
  // its resume point across mounts, so returning to the page continues the
  // stream without re-consumed events (页面刷新后可以恢复Run).
  useEffect(() => {
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, []);

  const { run, phase } = useReviewRun(draft);
  const findingsQuery = useReviewFindings(
    draft?.review_run_id ?? null,
    run !== null && isTerminalPhase(phase),
  );

  // Honest long-run feedback: the OpenAPI has no review-run cancel, so the
  // page says exactly what happened — the run exceeded the expected window —
  // and offers refresh; it never fakes a cancelled or completed state. The
  // phase-change reset happens during render; the timer effect only flips
  // the flag asynchronously.
  if (timedOutState.phase !== phase) {
    setTimedOutState({ phase, timedOut: false });
  }
  useEffect(() => {
    if (phase !== "queued" && phase !== "running") return;
    const timer = setTimeout(() => {
      setTimedOutState((previous) => ({ ...previous, timedOut: true }));
    }, REVIEW_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, run?.id]);

  // Leave guard: unsaved SQL would be lost silently in a refresh.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); };
  }, [dirty]);

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["change-draft", draftId] });
    await queryClient.invalidateQueries({ queryKey: ["review-run"] });
  }, [queryClient, draftId]);

  const showActionError = (error: unknown, operationId: string) => {
    const display = describeError(error, operationId);
    const requestId = display.requestId !== null ? ` (${display.requestId})` : "";
    setActionError(`${t(display.messageKey)}${requestId}`);
  };

  const saveMutation = useMutation({
    mutationFn: (sql: string) =>
      replaceDraftSql(draftId as string, { sql }, { headers: liveIfMatch() }),
    onSuccess: (saved) => {
      const savedDraft = saved as unknown as ChangeDraft;
      store.markSaved(savedDraft.revision, savedDraft.state, store.sql);
      setActionError(null);
      void invalidateAll();
    },
    onError: (error) => { showActionError(error, "replaceDraftSql"); },
  });

  const revealMutation = useMutation({
    mutationFn: () => revealDraftSql(draftId as string, { purpose: "draft-edit" }),
    onSuccess: (reveal) => {
      const payload = reveal as unknown as { sql: string };
      if (draft === null) return;
      store.attach({
        id: draft.id,
        state: draft.state,
        revision: draft.revision,
        sql: payload.sql,
      });
      setLoadValue({ text: payload.sql, nonce: Date.now() });
      setActionError(null);
    },
    onError: (error) => { showActionError(error, "revealDraftSql"); },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      runDraftReview(draftId as string, {
        headers: {
          ...liveIfMatch(),
          "Idempotency-Key": idempotencyKey(),
        },
      }),
    onSuccess: () => {
      setActionError(null);
      void invalidateAll();
    },
    onError: (error) => { showActionError(error, "runDraftReview"); },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitChangeDraft(draftId as string, {
        headers: {
          ...liveIfMatch(),
          "Idempotency-Key": idempotencyKey(),
        },
      }),
    onSuccess: (order) => {
      const created = order as unknown as { display_number: string };
      setSubmittedOrder(created.display_number);
      store.markServerState("submitted");
      setActionError(null);
      void invalidateAll();
    },
    onError: (error) => { showActionError(error, "submitChangeDraft"); },
  });

  const handleRunReview = useCallback(() => {
    if (dirty) {
      // Save first: the run must freeze the exact SQL the user sees.
      saveMutation.mutate(store.sql, { onSuccess: () => { reviewMutation.mutate(); } });
      return;
    }
    reviewMutation.mutate();
  }, [dirty, saveMutation, reviewMutation, store.sql]);

  if (draftQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" data-testid="draft-workspace-page">
        <PageBreadcrumb title={t("precheck.workspace.title")} />
        <LoadingState />
      </div>
    );
  }

  if (draftQuery.isError) {
    return (
      <div className="flex flex-col gap-4" data-testid="draft-workspace-page">
        <PageBreadcrumb title={t("precheck.workspace.title")} />
        <ErrorState
          error={draftQuery.error}
          operationId="getChangeDraft"
          onRetry={() => void draftQuery.refetch()}
        />
      </div>
    );
  }

  if (draft === null) return null;

  const flow = (flowsQuery.data ?? []).find((entry) => entry.id === draft.flow_id) ?? null;
  const phasePresented = presentPhase(store.serverState, phase, dirty);

  return (
    <div className="flex flex-col gap-4" data-testid="draft-workspace-page">
      <PageBreadcrumb title={draft.title ?? t("precheck.workspace.title")} />
      {submittedOrder !== null && (
        <Card data-testid="submit-success">
          <CardHeader>
            <CardTitle className="text-base">{t("precheck.submit.successTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{t("precheck.submit.successDescription", { number: submittedOrder })}</p>
          </CardContent>
        </Card>
      )}
      {timedOutState.timedOut && (phasePresented === "queued" || phasePresented === "running") && (
        <div
          role="alert"
          className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
          data-testid="review-timeout"
        >
          <CircleAlert className="size-4" aria-hidden />
          <span>{t("precheck.review.timeout")}</span>
          <Button variant="outline" size="sm" onClick={() => void invalidateAll()}>
            {t("errors.retry")}
          </Button>
        </div>
      )}
      {flowUpdated && (
        <div
          role="alert"
          className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
          data-testid="flow-updated-banner"
        >
          <CircleAlert className="size-4" aria-hidden />
          <span>{t("precheck.flowUpdated.banner")}</span>
        </div>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-[60vh]">
        <ResizablePanel defaultSize="62%" minSize="40%">
          <div className="flex h-full flex-col gap-4 pr-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("precheck.workspace.flowCard")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <StagePath flow={flow} />
                <p className="text-muted-foreground text-xs">{t("precheck.workspace.flowFrozen")}</p>
              </CardContent>
            </Card>

            <Card className="flex min-h-[320px] flex-1 flex-col">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileCode2 className="size-4" aria-hidden />
                  {t("precheck.workspace.sqlCard")}
                  {dirty && (
                    <span className="text-muted-foreground text-xs">
                      {t("precheck.workspace.unsaved")}
                    </span>
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {draft.has_sql && store.savedSql === null && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { revealMutation.mutate(); }}
                      disabled={revealMutation.isPending}
                      data-testid="reveal-sql"
                    >
                      {t("precheck.workspace.loadSql")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { saveMutation.mutate(store.sql); }}
                    disabled={!dirty || saveMutation.isPending}
                    data-testid="save-sql"
                  >
                    <Save className="size-3.5" aria-hidden />
                    {t("precheck.workspace.saveSql")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleRunReview}
                    disabled={
                      reviewMutation.isPending ||
                      (saveMutation.isPending && dirty) ||
                      phasePresented === "queued" ||
                      phasePresented === "running" ||
                      store.serverState === "submitted" ||
                      flowUpdated
                    }
                    data-testid="run-review"
                  >
                    <Play className="size-3.5" aria-hidden />
                    {t("precheck.workspace.runReview")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                {actionError !== null && (
                  <p role="alert" className="text-destructive text-sm">
                    {actionError}
                  </p>
                )}
                <SqlEditorPanel
                  value={store.sql}
                  onChange={(sql) => { store.setSql(sql); }}
                  readOnly={store.serverState === "submitted"}
                  loadValue={loadValue}
                  onLocate={locate}
                  data-testid="sql-editor"
                />
              </CardContent>
            </Card>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38%" minSize="26%">
          <Tabs defaultValue="overview" className="pl-3">
            <TabsList>
              <TabsTrigger value="overview" data-testid="tab-overview">{t("precheck.tabs.overview")}</TabsTrigger>
              <TabsTrigger value="findings" data-testid="tab-findings">{t("precheck.tabs.findings")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <ReviewStatusCard phase={phasePresented} run={run} />
            </TabsContent>
            <TabsContent value="findings">
              <FindingList
                findings={findingsQuery.data ?? []}
                onOpenEvidence={(finding) => { setEvidenceFinding(finding); }}
                onLocate={
                  isTerminalPhase(phasePresented)
                    ? (finding) => {
                        const target = /`([^`]+)`/.exec(finding.message)?.[1];
                        if (target !== undefined && store.sql.includes(target)) {
                          setLocate({ target, nonce: Date.now() });
                        }
                      }
                    : undefined
                }
                locateInEditor={(snippet) => store.sql.includes(snippet)}
              />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>

      <SubmissionDock
        draftState={store.serverState}
        phase={phasePresented}
        gate={run?.gate ?? null}
        dirty={dirty}
        flowUpdated={flowUpdated}
        reviewCurrent={run === null || run.draft_revision === draft.revision}
        submitting={submitMutation.isPending}
        onSubmit={() => { submitMutation.mutate(); }}
      />

      <EvidenceSheet
        finding={evidenceFinding}
        open={evidenceFinding !== null}
        onOpenChange={(open) => {
          if (!open) setEvidenceFinding(null);
        }}
      />
    </div>
  );
}
