import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import type {
  ChangeDraft,
  Flow,
  ReviewFinding,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  createChangeDraft,
  replaceDraftSql,
  revealDraftSql,
  runDraftReview,
  submitChangeDraft,
  updateChangeDraft,
} from "@/api/generated/client/change-drafts/change-drafts";
import { useDraftEditorStore, selectDirty } from "@/features/review/draft-editor-store";
import { isTerminalPhase, presentPhase, type RunPhase } from "@/features/review/run-state";
import { CapacityBanner } from "@/features/review/bulk-browser/capacity-banner";
import { StatementBrowser } from "@/features/review/bulk-browser/statement-browser";
import { ImportDialog } from "@/features/review/bulk-import/import-dialog";
import {
  digestSqlText,
  type SqlDigest,
} from "@/features/review/bulk-import/sql-digest";
import {
  BULK_MODE_MIN_BYTES,
  BULK_MODE_MIN_STATEMENTS,
} from "@/features/review/bulk-constants";
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
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FileCode2,
  FileUp,
  Play,
  Save,
  Search,
  Send,
} from "lucide-react";

/**
 * Workspace Setup Wizard for the order submission journey (owner ruling
 * 2026-09-04, shadcn multi-step-form-02 style; migration contract §18.34):
 * step 1 collects the order metadata (flow + title + description), step 2 is
 * the SQL editor with the explicit AI precheck, step 3 confirms and submits
 * (or saves the draft). /changes/new hosts the create mode starting at step
 * 1; /changes/drafts/:id hosts the same wizard bound to an existing draft,
 * entering at step 2.
 *
 * The audited workspace machinery (draft editor store, explicit review,
 * monotonic phase fold, bulk browser, gate-mirroring dock, submit confirm)
 * is retained verbatim as the step 2/3 engine — all of its state lives at
 * the wizard level so the run keeps polling while the user is on another
 * step. Nothing on step 2 triggers a run by itself (打开编辑不自动Review).
 */

const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
const STEP_COUNT = 3;

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

const STEP_META = [
  { eyebrow: "info", titleKey: "precheck.wizard.title.info", descriptionKey: "precheck.wizard.description.info", icon: ClipboardList },
  { eyebrow: "sql", titleKey: "precheck.wizard.title.sql", descriptionKey: "precheck.wizard.description.sql", icon: FileCode2 },
  { eyebrow: "confirm", titleKey: "precheck.wizard.title.confirm", descriptionKey: "precheck.wizard.description.confirm", icon: Send },
] as const;

interface StepHeaderProps {
  step: number;
}

function StepHeader({ step }: StepHeaderProps) {
  const { t } = useTranslation();
  const meta = STEP_META[step] as (typeof STEP_META)[number];
  const Icon = meta.icon;
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {t("precheck.wizard.stepOf", { current: step + 1, total: STEP_COUNT })}
        </span>
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
          {t(`precheck.wizard.eyebrow.${meta.eyebrow}`)}
        </Badge>
      </div>
      <div className="flex items-start gap-3">
        <div className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4.5" aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl">{t(meta.titleKey)}</CardTitle>
          <p className="text-muted-foreground text-sm">{t(meta.descriptionKey)}</p>
        </div>
      </div>
      <div className="flex gap-1.5">
        {STEP_META.map((_, index) => (
          <div
            key={index}
            className={
              index <= step
                ? "bg-primary h-1 flex-1 rounded-full transition-colors duration-300"
                : "bg-border h-1 flex-1 rounded-full transition-colors duration-300"
            }
            aria-hidden
          />
        ))}
      </div>
    </>
  );
}

interface MetaFieldsProps {
  title: string;
  description: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  titleError?: string | null;
}

/** 标题/说明 fields shared by step 1 in both modes. */
function MetaFields({ title, description, onTitleChange, onDescriptionChange, titleError }: MetaFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-title-input">{t("precheck.new.dialog.titleLabel")}</Label>
        <Input
          id="draft-title-input"
          value={title}
          onChange={(event) => { onTitleChange(event.target.value); }}
          maxLength={256}
          placeholder={t("precheck.wizard.titlePlaceholder")}
          aria-invalid={titleError != null}
          data-testid="draft-title-input"
        />
        {titleError != null && (
          <p className="text-destructive text-xs" data-testid="wizard-title-error">{titleError}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="draft-description-input">{t("precheck.new.dialog.descriptionLabel")}</Label>
        <Textarea
          id="draft-description-input"
          value={description}
          onChange={(event) => { onDescriptionChange(event.target.value); }}
          rows={3}
          maxLength={4096}
          data-testid="draft-description-input"
        />
      </div>
    </div>
  );
}

interface FlowPickerProps {
  flows: Flow[];
  selectedFlowId: string | null;
  onSelect: (flowId: string) => void;
}

/** Selectable flow cards (create mode, step 1): the frozen stage chain with
 * its datasource names is the deciding information, so each card shows it.
 * The flow is frozen once the draft is created. With many granted flows the
 * picker searches by title and scrolls inside a bounded region instead of
 * stretching the page (owner ruling 2026-09-04). */
function FlowPicker({ flows, selectedFlowId, onSelect }: FlowPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  const visible = keyword === "" ? flows : flows.filter((flow) => flow.name.toLowerCase().includes(keyword));
  return (
    <div className="space-y-3" data-testid="wizard-flow-picker">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
          placeholder={t("precheck.wizard.searchPlaceholder")}
          className="pl-9"
          data-testid="wizard-flow-search"
        />
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm" data-testid="wizard-flow-search-empty">
          {t("precheck.wizard.searchEmpty")}
        </p>
      ) : (
        <div className="grid max-h-[380px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {visible.map((flow) => {
            const selected = flow.id === selectedFlowId;
            return (
              <button
                key={flow.id}
                type="button"
                onClick={() => { onSelect(flow.id); }}
                aria-pressed={selected}
                className={
                  selected
                    ? "flex flex-col gap-2 rounded-lg border border-primary bg-primary/5 p-4 text-left ring-1 ring-primary"
                    : "hover:border-primary/40 flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors"
                }
                data-testid={`use-flow-${flow.id}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {selected && <CheckCircle2 className="text-primary size-4" aria-hidden />}
                  {flow.name}
                </span>
                <StagePath flow={flow} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SubmissionWizard({ mode }: { mode: "create" | "draft" }) {
  const { t } = useTranslation();
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(mode === "draft" ? 1 : 0);
  const [direction, setDirection] = useState<number | undefined>(undefined);
  const reducedMotion = useReducedMotion() ?? false;
  const goToStep = useCallback((next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }, [step]);

  // ---- step 1 state (create mode) ----
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);

  // ---- shared data ----
  const draftQuery = useChangeDraft(draftId ?? "", mode === "draft");
  const flowsQuery = useCurrentUserChangeFlows();
  const draft = draftQuery.data ?? null;
  const flows = flowsQuery.data ?? [];
  const flow = (mode === "draft"
    ? flows.find((entry) => entry.id === draft?.flow_id)
    : flows.find((entry) => entry.id === selectedFlowId)) ?? null;

  // ---- step 1 state (draft mode, keyed remount via draft.id below) ----
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");

  // ---- workspace engine (steps 2-3); survives step switches so the run
  // keeps polling and the dock stays live on step 3. ----
  const store = useDraftEditorStore();
  const dirty = useDraftEditorStore(selectDirty);
  const flowUpdated = useFlowUpdated(draft?.flow_id ?? null);

  const [loadValue, setLoadValue] = useState<{ text: string; nonce: number } | null>(null);
  const [locate, setLocate] = useState<{ target: string; nonce: number } | null>(null);
  const [bulkLocate, setBulkLocate] = useState<{ ordinal: number; nonce: number } | null>(null);
  const [importedDigest, setImportedDigest] = useState<SqlDigest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [evidenceFinding, setEvidenceFinding] = useState<ReviewFinding | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
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
    // Step 1 metadata starts from the persisted draft (async load lands here).
    setMetaTitle(draft.title ?? "");
    setMetaDescription(draft.description ?? "");
  }, [draft, store]);

  // The shared event feed lives for the wizard's lifetime in draft mode.
  useEffect(() => {
    if (mode !== "draft") return;
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, [mode]);

  // Bulk mode (frontend PRD F5): drafts beyond one max-statement size or a
  // thousand statements never mount the Monaco editor — the virtualized
  // browser takes over so the full SQL is never rendered.
  const isBulk =
    (draft?.sql_size_bytes ?? 0) > BULK_MODE_MIN_BYTES ||
    (draft?.statement_count ?? 0) > BULK_MODE_MIN_STATEMENTS ||
    store.sql.length > BULK_MODE_MIN_BYTES;
  const bulkDigest = isBulk && store.sql !== "" ? importedDigest : null;

  const digestSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isBulk || store.sql === "" || digestSourceRef.current === store.sql) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        digestSourceRef.current = store.sql;
        setImportedDigest(digestSqlText(store.sql));
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isBulk, store.sql]);

  const { run, phase } = useReviewRun(draft);
  const findingsQuery = useReviewFindings(
    draft?.review_run_id ?? null,
    run !== null && isTerminalPhase(phase),
  );

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

  const handleImportConfirm = useCallback((text: string, digest: SqlDigest) => {
    setImportOpen(false);
    setImportedDigest(digest);
    digestSourceRef.current = text;
    setBulkLocate(null);
    store.setSql(text);
    saveMutation.mutate(text);
  }, [store, saveMutation]);

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
      const created = order as unknown as { id: string; display_number: string };
      store.markServerState("submitted");
      setActionError(null);
      setConfirmSubmit(false);
      // F6 flow: submission lands on the immutable order detail (the order
      // id is returned by the submission response itself).
      void navigate(`/changes/orders/${created.id}`);
    },
    onError: (error) => {
      // Rejection keeps the dialog open with the backend's answer — the UI
      // never flips to a success state on its own (验收门禁: 后端拒绝无假成
      // 功); the user can cancel or retry from the same context.
      showActionError(error, "submitChangeDraft");
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createChangeDraft({
        flow_id: selectedFlowId as string,
        title: createTitle.trim(),
        description: createDescription === "" ? undefined : createDescription,
      }),
    onSuccess: (created) => {
      const draftCreated = created as unknown as { id: string };
      void navigate(`/changes/drafts/${draftCreated.id}`);
    },
    onError: (error) => { showActionError(error, "createChangeDraft"); },
  });

  const metaSaveMutation = useMutation({
    mutationFn: () =>
      updateChangeDraft(draftId as string, {
        title: metaTitle.trim(),
        description: metaDescription === "" ? undefined : metaDescription,
      }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["change-draft", draftId] });
    },
    onError: (error) => { showActionError(error, "updateChangeDraft"); },
  });

  const handleRunReview = useCallback(() => {
    if (dirty) {
      // Save first: the run must freeze the exact SQL the user sees.
      saveMutation.mutate(store.sql, { onSuccess: () => { reviewMutation.mutate(); } });
      return;
    }
    reviewMutation.mutate();
  }, [dirty, saveMutation, reviewMutation, store.sql]);

  // ---- step transitions ----
  const continueFromInfo = (): void => {
    if (mode === "create") {
      if (selectedFlowId === null) {
        setStepError(t("precheck.wizard.error.needFlow"));
        return;
      }
      if (createTitle.trim() === "") {
        setStepError(t("precheck.wizard.error.needTitle"));
        return;
      }
      setStepError(null);
      createMutation.mutate();
      return;
    }
    // Draft mode: persist metadata edits, then advance to the SQL step.
    if (metaTitle.trim() === "") {
      setStepError(t("precheck.wizard.error.needTitle"));
      return;
    }
    setStepError(null);
    metaSaveMutation.mutate(undefined, { onSuccess: () => { goToStep(1); } });
  };

  const continueFromSql = (): void => {
    if (draft === null) return;
    if (!dirty && !draft.has_sql && store.sql === "") {
      setStepError(t("precheck.wizard.error.needSql"));
      return;
    }
    setStepError(null);
    if (dirty) {
      // The wizard only advances past a saved state — the confirm step
      // always reflects exactly the frozen SQL.
      saveMutation.mutate(store.sql, { onSuccess: () => { goToStep(2); } });
      return;
    }
    goToStep(2);
  };

  const saveDraftAndLeave = (): void => {
    const leave = () => { void navigate("/changes/mine"); };
    if (dirty) {
      saveMutation.mutate(store.sql, { onSuccess: leave });
      return;
    }
    leave();
  };

  // ---- loading / error surfaces ----
  if (mode === "create") {
    return renderCreate();
  }
  if (draftQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" data-testid="draft-workspace-page">
        <LoadingState />
      </div>
    );
  }
  if (draftQuery.isError) {
    return (
      <div className="flex flex-col gap-4" data-testid="draft-workspace-page">
        <ErrorState
          error={draftQuery.error}
          operationId="getChangeDraft"
          onRetry={() => void draftQuery.refetch()}
        />
      </div>
    );
  }
  if (draft === null) return null;
  return renderWizard();

  function renderCreate(): ReactNode {
    const infoContent = (
      <div className="space-y-6 py-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{t("precheck.wizard.section.flow")}</h4>
            <p className="text-muted-foreground text-sm">{t("precheck.wizard.section.flowHint")}</p>
          </div>
          {flowsQuery.isPending && <LoadingState />}
          {flowsQuery.isError && (
            <ErrorState
              error={flowsQuery.error}
              operationId="listCurrentUserFlows"
              onRetry={() => void flowsQuery.refetch()}
            />
          )}
          {flowsQuery.isSuccess && flows.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              {t("precheck.new.empty")}
            </p>
          )}
          {flows.length > 0 && (
            <FlowPicker flows={flows} selectedFlowId={selectedFlowId} onSelect={(id) => { setSelectedFlowId(id); setStepError(null); }} />
          )}
        </div>
        <Separator />
        <div className="space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{t("precheck.wizard.section.meta")}</h4>
            <p className="text-muted-foreground text-sm">{t("precheck.wizard.section.metaHint")}</p>
          </div>
          <MetaFields
            title={createTitle}
            description={createDescription}
            onTitleChange={(value) => { setCreateTitle(value); setStepError(null); }}
            onDescriptionChange={setCreateDescription}
          />
        </div>
      </div>
    );
    return renderWizard(infoContent);
  }

  function renderWizard(infoContent?: ReactNode): ReactNode {
    const phasePresented = mode === "draft" ? presentPhase(store.serverState, phase, dirty) : "idle";
    const variants = {
      initial: (dir: number) => ({ x: `${String(110 * dir)}%`, opacity: 0 }),
      animate: { x: "0%", opacity: 1 },
      exit: (dir: number) => ({ x: `${String(-110 * dir)}%`, opacity: 0 }),
    };

    const stepContent = (): ReactNode => {
      if (step === 0) {
        const errorLine = stepError !== null && mode === "create" ? (
          <p role="alert" className="text-destructive text-sm" data-testid="wizard-step-error">
            {stepError}
          </p>
        ) : null;
        if (mode === "create") {
          return (
            <div className="space-y-4">
              {infoContent}
              {errorLine}
            </div>
          );
        }
        return (
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">{t("precheck.wizard.section.flow")}</h4>
                <p className="text-muted-foreground text-sm">{t("precheck.wizard.section.flowFrozenHint")}</p>
              </div>
              <div className="rounded-lg border p-4" data-testid="wizard-flow-frozen">
                <p className="text-sm font-medium">{flow?.name ?? draft?.flow_id}</p>
                <div className="mt-2">
                  <StagePath flow={flow} />
                </div>
              </div>
            </div>
            <Separator />
            <div className="space-y-5">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">{t("precheck.wizard.section.meta")}</h4>
                <p className="text-muted-foreground text-sm">{t("precheck.wizard.section.metaHint")}</p>
              </div>
              <MetaFields
                title={metaTitle}
                description={metaDescription}
                onTitleChange={setMetaTitle}
                onDescriptionChange={setMetaDescription}
                titleError={stepError}
              />
            </div>
          </div>
        );
      }
      if (step === 1) return renderSqlStep(phasePresented);
      return renderConfirmStep(phasePresented);
    };

    return (
      <div className="flex justify-center p-4" data-testid={mode === "create" ? "changes-new-page" : "draft-workspace-page"}>
        <MotionConfig transition={{ duration: 0.5, type: "spring", bounce: 0 }} reducedMotion="user">
          <Card className="bg-background w-full max-w-4xl overflow-hidden pt-0 shadow-none">
            <div>
              <CardHeader className="gap-4 border-b px-6 py-5">
                <StepHeader step={step} />
              </CardHeader>

              <div className="relative overflow-hidden">
                <CardContent className="relative px-6 py-4">
                  {reducedMotion ? (
                    <div className="w-full">{stepContent()}</div>
                  ) : (
                    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                      <motion.div
                        key={step}
                        variants={variants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="w-full"
                        custom={direction}
                      >
                        {stepContent()}
                      </motion.div>
                    </AnimatePresence>
                  )}
                </CardContent>
              </div>

              <CardFooter className="flex items-center justify-between border-t py-4">
                <Button
                  variant="secondary"
                  onClick={() => { goToStep(step - 1); }}
                  disabled={step === 0}
                  data-testid="wizard-back"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  {t("precheck.wizard.back")}
                </Button>
                {step < STEP_COUNT - 1 ? (
                  <Button
                    onClick={continueFromInfoOrSql()}
                    disabled={
                      (step === 0 && mode === "create" && createMutation.isPending) ||
                      (step === 0 && mode === "draft" && metaSaveMutation.isPending) ||
                      (step === 1 && saveMutation.isPending)
                    }
                    data-testid="wizard-continue"
                  >
                    {t("precheck.wizard.continue")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                ) : (
                  <Button variant="outline" onClick={saveDraftAndLeave} data-testid="wizard-save-draft">
                    <Save className="size-4" aria-hidden />
                    {t("precheck.wizard.saveDraft")}
                  </Button>
                )}
              </CardFooter>
            </div>
          </Card>
        </MotionConfig>

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onConfirm={handleImportConfirm}
          uploading={saveMutation.isPending}
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

  function continueFromInfoOrSql(): () => void {
    return step === 0 ? continueFromInfo : continueFromSql;
  }

  function renderSqlStep(phasePresented: RunPhase): ReactNode {
    return (
      <div className="space-y-4 py-2">
        {(timedOutState.timedOut && (phasePresented === "queued" || phasePresented === "running")) && (
          <div
            role="alert"
            className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
            data-testid="review-timeout"
          >
            <CircleAlert className="size-4" aria-hidden />
            <span>{t("precheck.review.timeout")}</span>
            <Button variant="outline" size="sm" onClick={() => { void invalidateAll(); }}>
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
        {actionError !== null && (
          <p role="alert" className="text-destructive text-sm" data-testid="wizard-action-error">
            {actionError}
          </p>
        )}
        {stepError !== null && (
          <p role="alert" className="text-destructive text-sm" data-testid="wizard-step-error">
            {stepError}
          </p>
        )}

        {/* Bulk mode needs a definite card height: with the auto-height
         * card the virtualized list would grow with its content and the
         * virtualizer would treat every row as visible. */}
        <Card className={isBulk ? "flex h-[70vh] flex-col" : "flex min-h-[320px] flex-col"}>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setImportOpen(true); }}
                data-testid="open-bulk-import"
              >
                <FileUp className="size-3.5" aria-hidden />
                {t("precheck.bulk.import.action")}
              </Button>
              {draft?.has_sql && store.savedSql === null && (
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
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
            {isBulk ? (
              <>
                <CapacityBanner
                  digest={bulkDigest}
                  serverStatementCount={run?.statement_count ?? null}
                  serverGroupCount={run?.fingerprint_group_count ?? null}
                />
                {bulkDigest === null ? (
                  <div
                    className="text-muted-foreground flex flex-1 items-center justify-center rounded-md border border-dashed p-6 text-sm"
                    data-testid="bulk-digest-pending"
                  >
                    {store.sql === ""
                      ? t("precheck.bulk.browser.revealFirst")
                      : t("precheck.bulk.browser.digesting")}
                  </div>
                ) : (
                  <StatementBrowser
                    sql={store.sql}
                    digest={bulkDigest}
                    serverGroupCount={run?.fingerprint_group_count ?? null}
                    locate={bulkLocate}
                  />
                )}
              </>
            ) : (
              <SqlEditorPanel
                value={store.sql}
                onChange={(sql) => { store.setSql(sql); }}
                readOnly={store.serverState === "submitted"}
                loadValue={loadValue}
                onLocate={locate}
                data-testid="sql-editor"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("precheck.wizard.resultsCard")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="overview">
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
                          if (target === undefined) return;
                          if (isBulk) {
                            // Bulk findings reference the statement ordinal
                            // (`#N`) and locate jumps the virtualized browser.
                            const ordinal = /#(\d+)/.exec(target);
                            if (
                              ordinal !== null &&
                              Number(ordinal[1]) <= (bulkDigest?.statementCount ?? 0)
                            ) {
                              setBulkLocate({ ordinal: Number(ordinal[1]), nonce: Date.now() });
                            }
                            return;
                          }
                          if (store.sql.includes(target)) {
                            setLocate({ target, nonce: Date.now() });
                          }
                        }
                      : undefined
                  }
                  locateInEditor={(snippet) => {
                    if (isBulk) {
                      const ordinal = /#(\d+)/.exec(snippet);
                      return (
                        ordinal !== null && Number(ordinal[1]) <= (bulkDigest?.statementCount ?? 0)
                      );
                    }
                    return store.sql.includes(snippet);
                  }}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderConfirmStep(phasePresented: RunPhase): ReactNode {
    return (
      <div className="space-y-4 py-2">
        <div className="grid gap-3 sm:grid-cols-2" data-testid="wizard-summary">
          <div className="rounded-lg border p-4 sm:col-span-2">
            <p className="text-muted-foreground text-xs">{t("precheck.wizard.summary.flow")}</p>
            <p className="mt-1 text-sm font-medium">{flow?.name ?? draft?.flow_id}</p>
            <div className="mt-2">
              <StagePath flow={flow} />
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-xs">{t("precheck.new.dialog.titleLabel")}</p>
            <p className="mt-1 text-sm">{draft?.title}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-xs">{t("precheck.wizard.summary.sql")}</p>
            <p className="mt-1 text-sm" data-testid="wizard-summary-sql">
              {run?.statement_count != null
                ? t("precheck.wizard.summary.statements", { count: run.statement_count })
                : draft?.has_sql
                  ? t("precheck.wizard.summary.saved")
                  : t("precheck.wizard.summary.empty")}
            </p>
          </div>
        </div>

        <SubmissionDock
          draftState={store.serverState}
          phase={phasePresented}
          gate={run?.gate ?? null}
          dirty={dirty}
          flowUpdated={flowUpdated}
          reviewCurrent={run === null || run.draft_revision === draft?.revision}
          submitting={submitMutation.isPending}
          onSubmit={() => { setConfirmSubmit(true); }}
        />

        {/* Submit confirmation (F6 deliverable 提交确认与Gate原因): the dock
         * mirrors the gate, the dialog restates what submission freezes and
         * what the backend would still reject — the mutation only fires after
         * the explicit confirm. */}
        <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
          <DialogContent data-testid="submit-confirm-dialog">
            <DialogHeader>
              <DialogTitle>{t("precheck.submit.confirmTitle")}</DialogTitle>
              <DialogDescription>{t("precheck.submit.confirmDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">{t("precheck.wizard.summary.flow")}</p>
                <p className="mt-1">{flow?.name ?? draft?.flow_id}</p>
                <div className="mt-1">
                  <StagePath flow={flow} />
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t("precheck.submit.confirmGate")}</p>
                <p className="mt-1" data-testid="submit-confirm-gate">
                  {run?.gate.passed
                    ? t("precheck.submit.confirmGatePassed")
                    : t("precheck.submit.confirmGateFailed")}
                </p>
              </div>
              {actionError !== null && (
                <p role="alert" className="text-destructive text-sm" data-testid="submit-confirm-error">
                  {actionError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setConfirmSubmit(false); }} data-testid="submit-confirm-cancel">
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => { submitMutation.mutate(); }}
                disabled={submitMutation.isPending}
                data-testid="submit-confirm-accept"
              >
                {t("precheck.submit.confirmAction")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
}
