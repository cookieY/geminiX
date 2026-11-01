import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ChangeDraft,
  Flow,
  ReviewFinding,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  listMyFlowDatasourceColumns,
  listMyFlowDatasourceSchemas,
  listMyFlowDatasourceTables,
  createChangeDraft,
  replaceDraftSql,
  revealDraftSql,
  runDraftReview,
  updateChangeDraft,
} from "@/api/generated/client/change-drafts/change-drafts";
import { submitChangeDraft } from "@/api/generated/client/change-orders/change-orders";
import { DateTimePicker } from "@/shared/components/ui/date-time-picker";
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
import {
  FindingList,
  type FindingListState,
} from "@/features/review/finding-list";
import { ReviewStatusCard } from "@/features/review/review-status-card";
import {
  SqlEditorPanel,
  type SqlCompletionCatalog,
} from "@/features/review/sql-editor-panel";
import { StagePath } from "@/features/review/stage-path";
import { FlowTimelineCard } from "@/features/review/flow-timeline-card";
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
import { BusinessError, TransportError } from "@/shared/api/mutator";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { TAB_PANEL_VARIANTS, TransitionPanel } from "@/shared/components/ui/transition-panel";
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
  CircleAlert,
  FileCode2,
  FileUp,
  Play,
} from "lucide-react";

function reviewOutputLanguage(language: string): "zh-CN" | "en-US" {
  return language.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

/**
 * Workspace for the order submission journey (one-page continuous form +
 * sticky right-hand summary, owner ruling 2026-10-24, superseding the
 * §18.34 three-step wizard): the left column walks 变更流程 → 标题与说明 →
 * SQL 变更内容 as one continuous form separated by hairlines; the right
 * column carries a live 工单摘要 card whose action area hosts the submission
 * dock (gate-mirroring readiness, blockers, submit) and the draft actions.
 * /changes/new hosts the create mode (flow + metadata + a SQL placeholder
 * until the draft exists); /changes/drafts/:id binds the same page to an
 * existing draft with the editor live.
 *
 * RCP-20261101-EPHEMERAL-PRECHECK：AI 预审是瞬态的——AI预审按钮把当前编辑
 * 器SQL逐字送到 POST /review-runs，不落草稿、不写SQL、不领养；run id 只存
 * 在页面客户端状态里（服务端不再写回草稿行），展示与轮询都用最后一次预
 * 审的 run id。过期（TTL/重启，读取报错）按「预审结果已过期」呈现。保存
 * 并返回是草稿与SQL的唯一写入方；提交把 {sql, run_id, metadata} 送到
 * POST /change-orders，由服务端比对送审文本。
 *
 * The audited workspace machinery (draft editor store, explicit review,
 * monotonic phase fold, bulk browser, gate-mirroring dock, submit confirm)
 * is retained verbatim as the engine — all of its state lives at the page
 * level so the run keeps polling while the user scrolls. Nothing here
 * triggers a run by itself (打开编辑不自动Review).
 */

const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

const PRECHECK_TONE_CLASS = {
  idle: { text: "text-muted-foreground", dot: "bg-muted-foreground/50" },
  busy: { text: "text-foreground", dot: "bg-foreground/60" },
  pass: { text: "text-success", dot: "bg-success" },
  fail: { text: "text-destructive", dot: "bg-destructive" },
  stale: { text: "text-warning", dot: "bg-warning" },
} as const;

interface DraftMetadataSnapshot {
  title: string;
  description: string | undefined;
  requested_scheduled_for: string | null;
}

function draftMetadataSnapshot(
  title: string,
  description: string,
  requestedFor: string,
): DraftMetadataSnapshot {
  return {
    title: title.trim(),
    description: description === "" ? undefined : description,
    requested_scheduled_for: requestedForToIso(requestedFor),
  };
}

function sameDraftMetadata(
  left: DraftMetadataSnapshot,
  right: DraftMetadataSnapshot,
): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.requested_scheduled_for === right.requested_scheduled_for;
}


function idempotencyKey(): string {
  return `draft-${crypto.randomUUID()}`;
}

// §18.74：草稿所有变更端点（sql/元数据/审核/提交）的If-Match都比对
// 草稿行version（后端updateDraftVersioned/Submit均比version）；SQL内容
// revision只是审核绑定的内容号，审核完成后两数分叉，绝不能作If-Match。
function ifMatch(version: number | null): Record<string, string> {
  return { "If-Match": `"${String(version ?? 1)}"` };
}

/** Optimistic-concurrency header built from the live store state: inside a
 * save→run chain the zustand update from the PUT response has already landed
 * here even though React has not re-rendered yet. */
function liveIfMatch(): Record<string, string> {
  return ifMatch(useDraftEditorStore.getState().savedVersion);
}

interface MetaFieldsProps {
  title: string;
  description: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  titleError?: string | null;
  /** §18.56方案B：期望执行时间（datetime-local字符串，空=未设置）。 */
  requestedFor: string;
  onRequestedForChange: (value: string) => void;
  requestedForError?: string | null;
}

/** 标题/说明/期望执行时间 fields of the 标题与说明 section in both modes. */
function MetaFields({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  requestedFor,
  onRequestedForChange,
  titleError,
  requestedForError,
}: MetaFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-title-input" className="text-sm font-semibold">{t("precheck.new.dialog.titleLabel")}</Label>
        <Input
          id="draft-title-input"
          value={title}
          onChange={(event) => { onTitleChange(event.target.value); }}
          maxLength={256}
          placeholder={t("precheck.wizard.titlePlaceholder")}
          aria-invalid={titleError != null}
          className="h-10 text-sm md:text-sm"
          data-testid="draft-title-input"
        />
        {titleError != null && (
          <p className="text-destructive text-xs" data-testid="wizard-title-error">{titleError}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-requested-for" className="text-sm font-semibold">{t("precheck.wizard.requestedScheduleLabel")}</Label>
        <DateTimePicker
          id="draft-requested-for"
          value={requestedFor}
          onChange={onRequestedForChange}
          enforceFuture
          ariaLabel={t("precheck.wizard.requestedScheduleLabel")}
          placeholder={t("precheck.wizard.requestedSchedulePlaceholder")}
          testId="draft-requested-for"
          className="w-full sm:w-64"
          inputClassName="h-10 w-full text-sm"
        />
        <p className="text-muted-foreground text-[13px]" data-testid="draft-requested-for-hint">
          {t("precheck.wizard.requestedScheduleHint")}
        </p>
        {requestedForError != null && (
          <p className="text-destructive text-xs" data-testid="wizard-requested-for-error">{requestedForError}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="draft-description-input" className="text-sm font-semibold">{t("precheck.new.dialog.descriptionLabel")}</Label>
        <Textarea
          id="draft-description-input"
          value={description}
          onChange={(event) => { onDescriptionChange(event.target.value); }}
          rows={4}
          maxLength={4096}
          className="text-sm md:text-sm"
          data-testid="draft-description-input"
        />
      </div>
    </div>
  );
}

/** §18.56方案B：datetime-local（本地时区）→ RFC3339 UTC；空/非法返回null。 */
export function requestedForToIso(value: string): string | null {
  if (value === "") return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  return due.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC3339 → datetime-local（展示/预填用）；null/过去时刻返回""。 */
export function isoToRequestedFor(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(due.getFullYear())}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

interface FlowPickerProps {
  flows: Flow[];
  selectedFlowId: string | null;
  onSelect: (flowId: string) => void;
}

/** Selectable flow cards (create mode): the frozen stage chain with its
 * datasource names is the deciding information, so each card shows it. The
 * flow is frozen once the draft is created. With many granted flows the
 * picker searches by title and scrolls inside a bounded region instead of
 * stretching the page (owner ruling 2026-09-04). One-page layout
 * (2026-10-24): the cards run three-up horizontally as radio cards —
 * selection is signalled by the bright border AND the check icon. */
function FlowPicker({ flows, selectedFlowId, onSelect }: FlowPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  const visible = keyword === "" ? flows : flows.filter((flow) => flow.name.toLowerCase().includes(keyword));
  return (
    <div className="flex flex-col gap-3" data-testid="wizard-flow-picker">
      <div className="max-w-64">
        <TableSearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("precheck.wizard.searchPlaceholder")}
          testId="wizard-flow-search"
        />
      </div>
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            filtered
            title={t("precheck.wizard.searchEmpty")}
            testId="wizard-flow-search-empty"
          />
        </div>
      ) : (
        <div className="grid max-h-[380px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
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
                    ? "flex flex-col gap-2 rounded-xl border border-foreground/70 bg-foreground/[0.04] p-4 text-left ring-1 ring-foreground/20"
                    : "hover:border-foreground/30 flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors"
                }
                data-testid={`use-flow-${flow.id}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {flow.name}
                  {/* Reference plan-card radio: the border thickness draws the
                      selection donut — colour-free by construction. */}
                  <span
                    aria-hidden
                    className={
                      selected
                        ? "size-4 shrink-0 rounded-full border-[5px] border-foreground"
                        : "size-4 shrink-0 rounded-full border-2 border-foreground/25"
                    }
                  />
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

/** One continuous-form section: 标题＋简短说明＋字段, separated from the next
 * section by a hairline (shared background — no per-section card). */
function FormSection({
  title,
  hint,
  action,
  children,
  last = false,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "px-6 py-5 lg:px-8" : "border-b px-6 py-5 lg:px-8"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-[13px]">{hint}</p>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  testId,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
  /** Unfilled values (未填写/未选择): quieter than real data. */
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground flex-none text-[13px]">{label}</dt>
      <dd
        className={
          muted
            ? "text-muted-foreground min-w-0 truncate text-right"
            : "min-w-0 truncate text-right font-medium"
        }
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

export default function SubmissionWizard({ mode }: { mode: "create" | "draft" }) {
  const { t, i18n } = useTranslation();
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ---- create-mode state ----
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createRequestedFor, setCreateRequestedFor] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  // Implicit drafts (owner ruling 2026-10-24 + RCP-20261101): the server
  // submission envelope is created silently by 保存并返回 — now the ONLY
  // writer of draft + SQL (预审与提交都不再领养、不再写SQL)。Until adoption
  // the SQL lives in plain local state; after adoption the page behaves
  // exactly like the draft mode, in place.
  const [localDraftId, setLocalDraftId] = useState<string | null>(null);
  const adoptedDraftIdRef = useRef<string | null>(null);
  // 领养的两个半段（POST建壳 + SQL PUT）是否都已完成：PUT失败的领养
  // 是"未完成动作"，后续acting操作先补齐它（完成用户已发起的事，不是
  // 替用户保存新改动——owner裁定2026-10-31）。
  const adoptionSqlCompleteRef = useRef(false);
  const [adoptionPending, setAdoptionPending] = useState(false);
  const [createSql, setCreateSql] = useState("");
  const createSqlRef = useRef(createSql);
  const ensureDraftPromiseRef = useRef<Promise<string | null> | null>(null);
  const reviewStartInFlightRef = useRef(false);
  // 镜像reviewStartInFlightRef的响应式状态：点击到runDraftReview真正
  // 发起之间隔着ensureDraft与SQL保存（大SQL可达数秒），这段时间
  // reviewMutation.isPending仍为false——不进pending的话按钮毫无进行中
  // 反馈，用户以为点击失效而重复点击造成重复预审。
  const [reviewStartPending, setReviewStartPending] = useState(false);
  const adopted = mode === "create" && localDraftId !== null;
  /** Route drafts and adopted implicit drafts share the persisted metadata
   * state; create-before-adoption keeps metadata in plain local state and
   * carries it in the adoption create call. */
  const metaBound = mode === "draft" || adopted;
  /** The draft this page currently operates on (explicit route draft or the
   * silently adopted implicit one). */
  const activeDraftId = mode === "draft" ? draftId ?? null : localDraftId;

  // ---- shared data ----
  const draftQuery = useChangeDraft(
    (mode === "draft" ? draftId : localDraftId) ?? "",
    mode === "draft" || localDraftId !== null,
  );
  const flowsQuery = useCurrentUserChangeFlows();
  const draft = draftQuery.data ?? null;
  const flows = flowsQuery.data ?? [];
  const flow = (mode === "draft" || adopted
    ? flows.find((entry) => entry.id === draft?.flow_id)
    : flows.find((entry) => entry.id === selectedFlowId)) ?? null;

  // ---- draft-mode metadata state (keyed remount via draft.id below) ----
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  // §18.56方案B：期望执行时间（datetime-local；空=清除）。
  const [metaRequestedFor, setMetaRequestedFor] = useState("");
  const metadataEditRevisionRef = useRef(0);
  const visibleMetadataRef = useRef<DraftMetadataSnapshot>(
    draftMetadataSnapshot("", "", ""),
  );

  // ---- workspace engine; lives at the page level so the run keeps polling
  // while the user scrolls the form or reads the summary. ----
  const store = useDraftEditorStore();
  const dirty = useDraftEditorStore(selectDirty);
  const flowUpdated = useFlowUpdated(draft?.flow_id ?? null);

  const [loadValue, setLoadValue] = useState<{ text: string; nonce: number } | null>(null);
  const [locate, setLocate] = useState<{ target: string; nonce: number } | null>(null);
  const [bulkLocate, setBulkLocate] = useState<{ ordinal: number; nonce: number } | null>(null);
  const [importedDigest, setImportedDigest] = useState<SqlDigest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [evidenceFindings, setEvidenceFindings] = useState<ReviewFinding[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  // ---- 瞬态预审（RCP-20261101）----
  // 最后一次 POST /review-runs 返回的 run id 与当时逐字送审的SQL：全部
  // 只在页面客户端状态里。staleness 是纯本地比对（编辑器文本 ≠ 送审文
  // 本），服务端不再把 run id 写回草稿行，页面卸载后结果即不可恢复。
  const [lastPrecheckRunId, setLastPrecheckRunId] = useState<string | null>(null);
  // 上次送审文本是渲染相关事实（staleness呈现），用state而非ref——
  // ref在渲染期读取会被react-hooks/refs正确禁止。
  const [lastPrecheckSql, setLastPrecheckSql] = useState<string | null>(null);
  // 轮询读Run已消失（TTL过期/服务重启，404或1002）——呈现「已过期」并清
  // 空上次Run展示；重新预审后复位。

  // tabs-02 pattern (owner ruling 2026-10-24): controlled results tab pair so
  // the content switch runs through TransitionPanel's slide+blur motion —
  // same behaviour as the mine page tabs.
  const [resultsTab, setResultsTab] = useState<"overview" | "findings">("overview");
  const [timedOutState, setTimedOutState] = useState<{ phase: RunPhase; timedOut: boolean }>({
    phase: "idle",
    timedOut: false,
  });

  // Attach the editor store once per draft: the server draft carries no SQL
  // plaintext (it never does), so the editor starts empty until an explicit
  // reveal loads it.
  const attachedDraftId = useRef<string | null>(null);
  // The implicit-adoption path has just put the current session's plaintext
  // into the store. Its first draft query may land afterwards; that response
  // enriches metadata/version but must not masquerade as a fresh visit and
  // wipe the SQL. A component remount resets this ref, preserving Reveal.
  const sessionContentDraftId = useRef<string | null>(null);
  // Adoption seeds the visible metadata from the local create form. Preserve
  // edits made while POST or the first draft query is in flight instead of
  // replacing them with the older server snapshot when that query lands.
  const sessionMetadataDraftId = useRef<string | null>(null);
  useEffect(() => {
    if (draft === null || attachedDraftId.current === draft.id) return;
    attachedDraftId.current = draft.id;
    const preserveSessionContent =
      sessionContentDraftId.current === draft.id &&
      useDraftEditorStore.getState().draftId === draft.id;
    if (preserveSessionContent) {
      store.markVersioned(draft.version, draft.state);
    } else {
      store.attach({ id: draft.id, state: draft.state, version: draft.version, sql: null });
    }
    if (sessionMetadataDraftId.current !== draft.id) {
      // A normal draft route starts from persisted metadata.
      setMetaTitle(draft.title ?? "");
      setMetaDescription(draft.description ?? "");
      setMetaRequestedFor(isoToRequestedFor(draft.requested_scheduled_for));
      visibleMetadataRef.current = draftMetadataSnapshot(
        draft.title ?? "",
        draft.description ?? "",
        isoToRequestedFor(draft.requested_scheduled_for),
      );
    }
  }, [draft, store]);

  // The shared event feed lives for the page's lifetime in draft mode.
  useEffect(() => {
    if (mode !== "draft") return;
    void startReviewEvents();
    return () => { stopReviewEvents(); };
  }, [mode]);

  // Bulk mode (frontend PRD F5): drafts beyond one max-statement size or a
  // thousand statements never mount the Monaco editor — the virtualized
  // browser takes over so the full SQL is never rendered.
  const localSqlText = mode === "create" && localDraftId === null ? createSql : store.sql;
  const isBulk =
    (draft?.sql_size_bytes ?? 0) > BULK_MODE_MIN_BYTES ||
    (draft?.statement_count ?? 0) > BULK_MODE_MIN_STATEMENTS ||
    localSqlText.length > BULK_MODE_MIN_BYTES ||
    // RCP-20261101：导入纯本地后，批量形态由本地digest判出（无服务端
    // 行可供 sql_size_bytes/statement_count 回读）。
    (importedDigest?.statementCount ?? 0) > BULK_MODE_MIN_STATEMENTS;
  const bulkDigest = isBulk && localSqlText !== "" ? importedDigest : null;

  const digestSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isBulk || localSqlText === "" || digestSourceRef.current === localSqlText) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        digestSourceRef.current = localSqlText;
        setImportedDigest(digestSqlText(localSqlText));
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isBulk, localSqlText]);

  const {
    run,
    phase,
    isPending: reviewRunPending,
    isError: reviewRunError,
    error: reviewRunErrorDetail,
    refetch: refetchReviewRun,
  } = useReviewRun(lastPrecheckRunId);
  const findingsQuery = useReviewFindings(
    lastPrecheckRunId,
    run !== null && isTerminalPhase(phase),
  );
  const hasPrecheckResult = lastPrecheckRunId !== null;
  // RCP-20261101：staleness = 编辑器文本 ≠ 上次送审文本（仅在有预审结果
  // 时才成立——旧语义里与草稿 revision/dirty 的耦合全部作废）。
  const sqlChangedSincePrecheck =
    hasPrecheckResult && lastPrecheckSql !== null && localSqlText !== lastPrecheckSql;
  // 轮询读Run失败时区分「已过期」（Run消失：HTTP 404 或业务码1002）与真
  // 故障——前者换过期呈现，后者保持错误展示，永不掩盖真实失败原因。
  // 纯派生（不写state）：过期期间保留runId轮询引用无副作用——读取端
  // 已按expired短路，恢复由用户重新预审驱动。
  const precheckExpired =
    hasPrecheckResult &&
    reviewRunError &&
    ((reviewRunErrorDetail instanceof TransportError && reviewRunErrorDetail.problem.status === 404) ||
      (reviewRunErrorDetail instanceof BusinessError && reviewRunErrorDetail.err_code === 1002));

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

  // Leave guard: unsaved SQL would be lost silently in a refresh — the
  // pre-adoption local SQL of the create mode counts too.
  const unsavedCreateSql = mode === "create" && localDraftId === null && createSql !== "";
  useEffect(() => {
    if (!dirty && !unsavedCreateSql) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); };
  }, [dirty, unsavedCreateSql]);

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["change-draft", activeDraftId] });
    await queryClient.invalidateQueries({ queryKey: ["review-run"] });
  }, [queryClient, activeDraftId]);

  // §18.74：查询刷新带回更高行version时单调同步进store——审核run终态在
  // 服务端异步推进version，不同步则后续If-Match全部过期。
  useEffect(() => {
    if (draft === null) return;
    const saved = useDraftEditorStore.getState().savedVersion;
    if (saved !== null && draft.version > saved) {
      store.markVersioned(draft.version, draft.state);
    }
  }, [draft, store]);

  // 瞬态Run不再推进草稿行version（RCP-20261101），Run终态无需重读草稿。

  const showActionError = useCallback((error: unknown, operationId: string) => {
    const display = describeError(error, operationId);
    const requestId = display.requestId !== null ? ` (${display.requestId})` : "";
    // BUG-006/010：meta.detail携带后端诊断文本（如preflight拒因、驱动
    // 错误原文）时逐字追加，执行人不再只见泛化文案。
    const detail = display.detail !== null ? ` ${display.detail}` : "";
    setActionError(`${t(display.messageKey)}${detail}${requestId}`);
  }, [t]);

  const saveMutation = useMutation({
    mutationFn: ({ draftId, sql }: { draftId: string; sql: string }) =>
      replaceDraftSql(draftId, { sql }, { headers: liveIfMatch() }),
    onSuccess: (saved, { draftId, sql }) => {
      const savedDraft = saved as unknown as ChangeDraft;
      store.markSaved(savedDraft.version, savedDraft.state, sql);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["change-draft", draftId] });
    },
    onError: (error) => { showActionError(error, "replaceDraftSql"); },
  });

  const editorIsCurrent = useCallback((expectedSql: string): boolean => {
    const current = useDraftEditorStore.getState();
    return current.draftId !== null
      && current.sql === expectedSql
      && !selectDirty(current);
  }, []);

  const savedSqlMatchesEditor = useCallback((savedSql: string): boolean => {
    const current = useDraftEditorStore.getState();
    return current.savedSql === savedSql && editorIsCurrent(savedSql);
  }, [editorIsCurrent]);

  const metadataIsCurrent = useCallback(
    (snapshot: DraftMetadataSnapshot, revision: number): boolean =>
      metadataEditRevisionRef.current === revision
      && sameDraftMetadata(visibleMetadataRef.current, snapshot),
    [],
  );

  const createMutation = useMutation({
    mutationFn: (metadata: DraftMetadataSnapshot) =>
      createChangeDraft({
        flow_id: selectedFlowId as string,
        title: metadata.title,
        description: metadata.description,
        requested_scheduled_for: metadata.requested_scheduled_for ?? undefined,
      }),
    onError: (error) => { showActionError(error, "createChangeDraft"); },
  });

  /**
   * Implicit-draft adoption (owner ruling 2026-10-24): create the server
   * submission envelope — silently, in place — on the first acting
   * operation. The flow + title gate stays (the envelope cannot exist
   * without them) but it surfaces as a near-field error at the moment of
   * the action, never as a mandatory user step. Local SQL travels with the
   * adoption so the editor never blanks.
   */
  const ensureDraft = useCallback(async (): Promise<string | null> => {
    if (ensureDraftPromiseRef.current !== null) return ensureDraftPromiseRef.current;
    const needsAdoption = activeDraftId === null && adoptedDraftIdRef.current === null;
    if (needsAdoption) {
      // 校验保持同步：拒绝必须在点击的同一同步批次内置错并撤下
      // pending（校验错误不应表现为"进行中"），也绝不留下会让下一次
      // 点击被去重吞掉的已结算promise。
      const rejectDraft = (message: string): null => {
        setStepError(message);
        reviewStartInFlightRef.current = false;
        setReviewStartPending(false);
        return null;
      };
      const requestedIssue = (value: string): string | null => {
        if (value === "") return null;
        if (requestedForToIso(value) === null) return t("precheck.wizard.requestedScheduleInvalid");
        if (new Date(value).getTime() <= Date.now()) return t("precheck.wizard.requestedSchedulePast");
        return null;
      };
      if (selectedFlowId === null) {
        return rejectDraft(t("precheck.wizard.error.needFlow"));
      }
      if (createTitle.trim() === "") {
        return rejectDraft(t("precheck.wizard.error.needTitle"));
      }
      const issue = requestedIssue(createRequestedFor);
      if (issue !== null) {
        return rejectDraft(issue);
      }
    }
    const completion = (async (): Promise<string | null> => {
      // 领养补齐：上一次领养的SQL PUT未落地（POST已权威建壳）时，先
      // 补齐它，让本次acting操作面对与编辑器一致的已存SQL；重试仍
      // 失败则拒绝本次操作，不创建第二个草稿。这是完成用户已发起的
      // 动作，不是替用户保存新改动（owner裁定2026-10-31）。
      const adoptedDraftId = adoptedDraftIdRef.current;
      if (adoptedDraftId !== null && !adoptionSqlCompleteRef.current) {
        const current = useDraftEditorStore.getState();
        if (current.sql !== "" && current.savedVersion !== null) {
          try {
            const saved = (await replaceDraftSql(adoptedDraftId, { sql: current.sql }, {
              headers: ifMatch(current.savedVersion),
            })) as unknown as ChangeDraft;
            store.markSaved(saved.version, saved.state, current.sql);
          } catch (error) {
            showActionError(error, "replaceDraftSql");
            return null;
          }
        }
        adoptionSqlCompleteRef.current = true;
      }
      if (activeDraftId !== null) return activeDraftId;
      if (adoptedDraftId !== null) return adoptedDraftId;
      setStepError(null);
      setAdoptionPending(true);
      const metadataAtCreate = visibleMetadataRef.current;
      let created: {
        id: string;
        version: number;
        state: ChangeDraft["state"];
      };
      try {
        created = (await createMutation.mutateAsync(metadataAtCreate)) as unknown as {
          id: string;
          version: number;
          state: ChangeDraft["state"];
        };
      } catch (error) {
        showActionError(error, "createChangeDraft");
        return null;
      }

      // The POST is now authoritative: keep this page attached to the created
      // row even if the following SQL PUT fails. Retrying the first action must
      // update this draft, never create an orphan replacement.
      const sqlAtCreate = createSqlRef.current;
      adoptedDraftIdRef.current = created.id;
      sessionContentDraftId.current = created.id;
      sessionMetadataDraftId.current = created.id;
      const metadataAtAdoption = visibleMetadataRef.current;
      setMetaTitle(metadataAtAdoption.title);
      setMetaDescription(metadataAtAdoption.description ?? "");
      setMetaRequestedFor(isoToRequestedFor(metadataAtAdoption.requested_scheduled_for));
      store.attach({
        id: created.id,
        state: created.state,
        version: created.version,
        sql: null,
      });
      if (sqlAtCreate !== "") store.setSql(sqlAtCreate);
      setLocalDraftId(created.id);
      setLoadValue({ text: sqlAtCreate, nonce: Date.now() });

      if (sqlAtCreate !== "") {
        try {
          const saved = (await replaceDraftSql(created.id, { sql: sqlAtCreate }, {
            headers: ifMatch(created.version),
          })) as unknown as ChangeDraft;
          store.markSaved(saved.version, saved.state, sqlAtCreate);
        } catch (error) {
          showActionError(error, "replaceDraftSql");
          return null;
        }
      }
      adoptionSqlCompleteRef.current = true;

      // The create or SQL PUT can span user typing. markSaved acknowledges only
      // the submitted text, so any later input remains visible and dirty.
      const sqlAfterSave = createSqlRef.current;
      if (sqlAfterSave !== sqlAtCreate) store.setSql(sqlAfterSave);
      return created.id;
    })();
    ensureDraftPromiseRef.current = completion;
    try {
      return await completion;
    } finally {
      if (ensureDraftPromiseRef.current === completion) {
        ensureDraftPromiseRef.current = null;
        setAdoptionPending(false);
      }
    }
  }, [activeDraftId, createMutation, createRequestedFor, createTitle, selectedFlowId, showActionError, store, t]);

  // 批量导入只在本地落SQL（RCP-20261101）：服务端写入只剩 保存并返回；
  // 创建态未领养时导入文本进 createSql 本地态，领养/草稿态进编辑器store。
  const handleImportConfirm = useCallback((text: string, digest: SqlDigest) => {
    setImportOpen(false);
    setImportedDigest(digest);
    digestSourceRef.current = text;
    setBulkLocate(null);
    if (mode === "create" && localDraftId === null) {
      createSqlRef.current = text;
      setCreateSql(text);
    } else {
      store.setSql(text);
    }
  }, [localDraftId, mode, store]);

  const revealMutation = useMutation({
    mutationFn: () => revealDraftSql(activeDraftId as string, { purpose: "draft-edit" }),
    onSuccess: (reveal) => {
      const payload = reveal as unknown as { sql: string };
      if (draft === null) return;
      store.attach({
        id: draft.id,
        state: draft.state,
        version: draft.version,
        sql: payload.sql,
      });
      setLoadValue({ text: payload.sql, nonce: Date.now() });
      setActionError(null);
    },
    onError: (error) => { showActionError(error, "revealDraftSql"); },
  });

  // 瞬态AI预审（RCP-20261101）：把当前编辑器SQL逐字送审，不落草稿、不写
  // SQL、不领养；run id 回到客户端状态，展示与轮询都由它驱动。
  const reviewMutation = useMutation({
    mutationFn: ({ sql }: { sql: string }) =>
      runDraftReview(
        {
          flow_id: (draft?.flow_id ?? selectedFlowId) as string,
          draft_id: activeDraftId ?? undefined,
          sql,
        },
        {
          headers: {
            "Idempotency-Key": idempotencyKey(),
            "Accept-Language": reviewOutputLanguage(i18n.language),
          },
        },
      ),
    onSuccess: (started, { sql }) => {
      setActionError(null);
      const runId = (started as { run_id?: string } | null)?.run_id;
      if (typeof runId !== "string" || runId === "") return;
      setLastPrecheckSql(sql);
      setLastPrecheckRunId(runId);
      void queryClient.invalidateQueries({ queryKey: ["review-run", runId] });
    },
    onError: (error) => { showActionError(error, "runDraftReview"); },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      // 保存信息 folded into the submit path (owner ruling 2026-10-24):
      // metadata edits must land on the bound draft envelope before the
      // order freezes them. Draftless create-mode submission carries the
      // same snapshot in the body instead.
      if (metaBound && activeDraftId !== null) {
        await metaSaveMutation.mutateAsync({
          metadata: visibleMetadataRef.current,
          revision: metadataEditRevisionRef.current,
        });
      }
      return submitChangeDraft(
        {
          flow_id: (draft?.flow_id ?? selectedFlowId) as string,
          draft_id: activeDraftId ?? undefined,
          sql: localSqlText,
          run_id: lastPrecheckRunId as string,
          metadata: mode === "create"
            ? {
                title: (metaBound ? metaTitle : createTitle).trim(),
                description: (metaBound ? metaDescription : createDescription) === ""
                    ? undefined
                    : (metaBound ? metaDescription : createDescription),
                requested_scheduled_for:
                  requestedForToIso(metaBound ? metaRequestedFor : createRequestedFor)
                  ?? undefined,
              }
            : undefined,
        },
        {
          headers: {
            "Idempotency-Key": idempotencyKey(),
          },
        },
      );
    },
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

  const metaSaveMutation = useMutation({
    mutationFn: ({ metadata }: { metadata: DraftMetadataSnapshot; revision: number }) =>
      updateChangeDraft(activeDraftId as string, metadata, { headers: liveIfMatch() }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["change-draft", activeDraftId] });
    },
    onError: (error) => { showActionError(error, "updateChangeDraft"); },
  });

  // Completion catalog (RCP-20260904-SUBMITTER-METADATA-PROJECTION): the
  // frozen flow's stage datasources are read for schemas/tables/columns —
  // one query per stage datasource; failures degrade to the mapping-name
  // catalog (keyword completions keep working). Schema mappings still
  // contribute the submitter-facing logical names.
  const stageDatasourceIds = useMemo(
    () => [...new Set((flow?.stages ?? []).map((stage) => stage.datasource_id))],
    [flow],
  );
  const metadataQueries = useQueries({
    queries: stageDatasourceIds.map((datasourceId) => ({
      queryKey: ["submitter-metadata", flow?.id ?? "", datasourceId],
      enabled: mode === "draft" && flow?.id != null,
      retry: false,
      staleTime: 60_000,
      queryFn: async () => {
        // The mutator unwraps the success envelope — the SDK returns the
        // data payload directly ({ items }).
        const flowId = flow?.id;
        if (flowId === undefined) return { schemas: [], tables: [], columns: [] };
        const schemas = (await listMyFlowDatasourceSchemas(flowId, datasourceId)) as unknown as {
          items: Array<{ name: string }>;
        };
        const tables: Array<{ schema: string | null; name: string }> = [];
        const columns: Array<{ schema: string | null; table: string; name: string }> = [];
        for (const schema of schemas.items) {
          const tablesPage = (await listMyFlowDatasourceTables(flowId, datasourceId, {
            schema_name: schema.name,
          })) as unknown as { items: Array<{ schema_name: string; table_name: string }> };
          for (const table of tablesPage.items) {
            tables.push({ schema: table.schema_name, name: table.table_name });
          }
          for (const table of tablesPage.items.slice(0, 20)) {
            const columnsPage = (await listMyFlowDatasourceColumns(flowId, datasourceId, {
              schema_name: schema.name,
              table_name: table.table_name,
            })) as unknown as { items: Array<{ column_name: string }> };
            for (const column of columnsPage.items) {
              columns.push({ schema: schema.name, table: table.table_name, name: column.column_name });
            }
          }
        }
        return { schemas: schemas.items.map((entry) => entry.name), tables, columns };
      },
    })),
  });
  const completionCatalog = useMemo<SqlCompletionCatalog>(() => {
    // RCP-20261031-REMOVE-FLOW-SCHEMA-MAPPINGS：流程阶段不再携带逻辑
    // schema映射，库名联想完全来自元数据目录（查询会话作用域端点）。
    const merged: SqlCompletionCatalog = {
      schemas: [],
      tables: [],
      columns: [],
    };
    for (const query of metadataQueries) {
      const data = query.data;
      if (data === undefined) continue;
      merged.schemas.push(...data.schemas);
      merged.tables.push(...data.tables);
      merged.columns.push(...data.columns);
    }
    return merged;
  }, [metadataQueries]);

  // Owner ruling 2026-10-31 + RCP-20261101：预审绝不捎带保存——AI预审按钮
  // 把当前编辑器SQL逐字送到瞬态端点评审；创建态仅就近校验流程已选（无草
  // 稿壳可领养）。点击仍同步置pending（reviewStartPending，owner优先裁
  // 定），慢启动绝不诱发重复预审。
  const handleRunReview = useCallback(() => {
    if (reviewStartInFlightRef.current) return;
    reviewStartInFlightRef.current = true;
    setReviewStartPending(true);
    const finish = () => {
      reviewStartInFlightRef.current = false;
      setReviewStartPending(false);
    };
    if (mode === "create" && selectedFlowId === null && draft?.flow_id == null) {
      setStepError(t("precheck.wizard.error.needFlow"));
      finish();
      return;
    }
    setStepError(null);
    reviewMutation.mutate({ sql: localSqlText }, { onSettled: finish });
  }, [draft?.flow_id, localSqlText, mode, reviewMutation, selectedFlowId, t]);

  // ---- 保存并返回: the single secondary action (owner ruling 2026-10-24,
  // 保存信息 folded away) — persist SQL then metadata, then leave. ----
  const saveDraftAndLeave = (): void => {
    const leave = () => { void navigate("/changes/mine"); };
    const metadataSnapshot = visibleMetadataRef.current;
    const metadataRevision = metadataEditRevisionRef.current;
    const metadataUnchanged = () => metadataIsCurrent(metadataSnapshot, metadataRevision);
    if (mode === "create" && (activeDraftId === null || !adoptionSqlCompleteRef.current)) {
      // The one explicit opt-in to the draft: adopt implicitly, then leave.
      // 半截领养（POST已建壳、SQL PUT失败）也走这里：ensureDraft先补齐
      // 用户已发起的保存（§18.90），补齐用的If-Match取领养时刻版本，
      // 不落成"第二次PUT对着已推进版本"的错位。
      void (async () => {
        const draftId = await ensureDraft();
        if (draftId === null) return;
        const current = useDraftEditorStore.getState();
        if (!selectDirty(current)) {
          if (metadataUnchanged()) leave();
          return;
        }
        saveMutation.mutate({ draftId, sql: current.sql }, {
          onSuccess: (_saved, variables) => {
            if (savedSqlMatchesEditor(variables.sql) && metadataUnchanged()) leave();
          },
        });
      })();
      return;
    }
    if (metaBound && metaTitle.trim() === "") {
      setStepError(t("precheck.wizard.error.needTitle"));
      return;
    }
    const current = useDraftEditorStore.getState();
    if (selectDirty(current)) {
      // SQL first: markSaved keeps the store version chain monotonic for the
      // metadata PUT that follows.
      saveMutation.mutate({ draftId: activeDraftId as string, sql: current.sql }, {
        onSuccess: (_saved, variables) => {
          if (!savedSqlMatchesEditor(variables.sql)) return;
          if (metaBound) {
            metaSaveMutation.mutate({ metadata: metadataSnapshot, revision: metadataRevision }, {
              onSuccess: () => {
                if (editorIsCurrent(variables.sql) && metadataUnchanged()) leave();
              },
            });
          }
          else leave();
        },
      });
      return;
    }
    if (metaBound) {
      metaSaveMutation.mutate({ metadata: metadataSnapshot, revision: metadataRevision }, {
        onSuccess: () => {
          if (editorIsCurrent(current.sql) && metadataUnchanged()) leave();
        },
      });
    }
    else leave();
  };

  // ---- loading / error surfaces ----
  if (mode === "create") {
    return renderPage();
  }
  if (draftQuery.isPending) {
    return (
      <PageLayout data-testid="draft-workspace-page">
        <LoadingState variant="page" />
      </PageLayout>
    );
  }
  if (draftQuery.isError) {
    return (
      <PageLayout data-testid="draft-workspace-page">
        <ErrorState
          error={draftQuery.error}
          operationId="getChangeDraft"
          onRetry={() => void draftQuery.refetch()}
        />
      </PageLayout>
    );
  }
  if (draft === null) return null;
  return renderPage();

  /** The presented precheck state for the summary card: label plus the
   * semantic tone the real state earns (green pass / red fail / amber
   * outdated) — idle and in-flight stay neutral. */
  function precheckStatus(): { label: string; tone: "idle" | "busy" | "pass" | "fail" | "stale" } {
    if (!hasPrecheckResult || precheckExpired) {
      return { label: t("precheck.wizard.precheck.idle"), tone: "idle" };
    }
    const presented = presentPhase(phase, sqlChangedSincePrecheck, hasPrecheckResult);
    if (presented === "idle") return { label: t("precheck.wizard.precheck.idle"), tone: "idle" };
    if (presented === "queued" || presented === "running")
      return { label: t("precheck.wizard.precheck.running"), tone: "busy" };
    if (presented === "outdated")
      return { label: t("precheck.wizard.precheck.outdated"), tone: "stale" };
    return run !== null && run.gate.passed
      ? { label: t("precheck.wizard.precheck.passed"), tone: "pass" }
      : { label: t("precheck.wizard.precheck.failed"), tone: "fail" };
  }


  /** Summary values share one source of truth with the form fields. */
  function summaryValues() {
    const presented = presentPhase(phase, sqlChangedSincePrecheck, hasPrecheckResult);
    // F-UX-001：摘要与元数据字段同源——draft模式（重开已存草稿）与
    // create领养态都读meta*（由草稿载入水合）；旧代码按adopted分支，
    // draft模式下摘要读了恒空的createTitle，标题永远显示"未填写"。
    const title = metaBound ? metaTitle.trim() : createTitle.trim();
    const requestedFor = metaBound ? metaRequestedFor : createRequestedFor;
    const datasources = [...new Set((flow?.stages ?? []).map((stage) => stage.datasource_name))];
    return {
      presented,
      title: title === "" ? t("precheck.wizard.summary.empty") : title,
      sql:
        run?.statement_count != null
          ? t("precheck.wizard.summary.statements", { count: run.statement_count })
          : (mode === "draft" || adopted) && draft?.has_sql
            ? t("precheck.wizard.summary.saved")
            : t("precheck.wizard.summary.empty"),
      requestedFor:
        requestedFor === ""
          ? t("precheck.wizard.summary.unselected")
          : requestedFor.replace("T", " "),
      datasources:
        datasources.length > 0
          ? datasources.join("、")
          : t("precheck.wizard.summary.unselected"),
    };
  }

  function renderSummaryCard(): ReactNode {
    const values = summaryValues();
    return (
      <Card className="gap-0 overflow-hidden py-0" data-testid="wizard-summary">
        <CardHeader className="border-b py-4">
          <CardTitle>{t("precheck.wizard.summaryTitle")}</CardTitle>
          <p className="text-muted-foreground text-[13px] leading-relaxed">{t("precheck.wizard.summaryHint")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5 py-3.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide">
            {t("precheck.wizard.summary.groupInfo")}
          </p>
          <dl className="flex flex-col gap-3">
            {/* 审核流程改由下方独立时间线卡呈现（owner 2026-10-31）。 */}
            <SummaryRow
              label={t("precheck.new.dialog.titleLabel")}
              value={values.title}
              muted={values.title === t("precheck.wizard.summary.empty")}
            />
            <SummaryRow
              label={t("precheck.wizard.summary.sql")}
              value={values.sql}
              testId="wizard-summary-sql"
              muted={values.sql === t("precheck.wizard.summary.empty")}
            />
            <SummaryRow
              label={t("precheck.wizard.summary.precheck")}
              muted={precheckStatus().tone === "idle"}
              value={
                <span
                  className={`inline-flex items-center gap-1.5 ${PRECHECK_TONE_CLASS[precheckStatus().tone].text}`}
                  data-testid="wizard-summary-precheck"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${PRECHECK_TONE_CLASS[precheckStatus().tone].dot}`}
                  />
                  {precheckStatus().label}
                </span>
              }
            />
            <SummaryRow
              label={t("precheck.wizard.summary.requestedFor")}
              value={values.requestedFor}
              muted={values.requestedFor === t("precheck.wizard.summary.unselected")}
            />
            <SummaryRow
              label={t("precheck.wizard.summary.datasources")}
              muted={flow === null}
              value={
                flow === null ? (
                  values.datasources
                ) : (
                  <span
                    className="text-muted-foreground font-normal"
                    title={t("precheck.wizard.summary.frozenByFlow")}
                  >
                    {values.datasources}
                  </span>
                )
              }
            />
          </dl>
        </CardContent>
        {/* Action area: one primary focus per page (owner ruling 2026-10-24).
         * The dock is the single submission authority in both modes — it stays
         * honestly blocked until a passing ephemeral precheck of the exact
         * editor SQL unlocks it (RCP-20261101). The surface lifts one step
         * above the card body (reference ruling 2026-10-24). */}
        <div className="bg-secondary/40 flex flex-col gap-2.5 border-t px-3.5 py-3">
          {stepError !== null && (
            <p role="alert" className="text-destructive text-sm" data-testid="wizard-step-error">
              {stepError}
            </p>
          )}
          {actionError !== null && (
            <p role="alert" className="text-destructive text-sm" data-testid="wizard-action-error">
              {actionError}
            </p>
          )}
          <SubmissionDock
            variant="panel"
            draftState={
              activeDraftId !== null
                ? store.serverState === "submitted" ? "submitted" : "draft"
                : null
            }
            phase={values.presented}
            gate={run?.gate ?? null}
            sqlChangedSincePrecheck={sqlChangedSincePrecheck}
            flowUpdated={flowUpdated}
            submitting={submitMutation.isPending || adoptionPending}
            onSubmit={() => {
              // RCP-20261101：提交不再落SQL——请求体携带编辑器SQL与预审run
              // id，由服务端逐字比对；此处只做创建态就近校验（流程/标题/
              // 期望时间），通过即打开确认弹窗。
              if (mode === "create") {
                if (selectedFlowId === null && draft?.flow_id == null) {
                  setStepError(t("precheck.wizard.error.needFlow"));
                  return;
                }
                if ((metaBound ? metaTitle : createTitle).trim() === "") {
                  setStepError(t("precheck.wizard.error.needTitle"));
                  return;
                }
                const requestedFor = metaBound ? metaRequestedFor : createRequestedFor;
                if (requestedFor !== "") {
                  if (requestedForToIso(requestedFor) === null) {
                    setStepError(t("precheck.wizard.requestedScheduleInvalid"));
                    return;
                  }
                  if (new Date(requestedFor).getTime() <= Date.now()) {
                    setStepError(t("precheck.wizard.requestedSchedulePast"));
                    return;
                  }
                }
              }
              setStepError(null);
              setConfirmSubmit(true);
            }}
            aside={
              /* 保存并返回 is the single secondary action (owner ruling
               * 2026-10-24): it persists metadata + SQL, then leaves. */
              <PendingButton
                variant="outline"
                className="h-10 flex-1 rounded-full text-sm font-semibold"
                pending={
                  adoptionPending ||
                  metaSaveMutation.isPending ||
                  saveMutation.isPending ||
                  createMutation.isPending
                }
                onClick={saveDraftAndLeave}
                data-testid="wizard-save-draft"
              >
                {t("precheck.wizard.saveAndReturn")}
              </PendingButton>
            }
          />
        </div>
      </Card>
    );
  }

  function renderFlowSection(): ReactNode {
    if (mode === "draft" || adopted) {
      return (
        <FormSection
          title={t("precheck.wizard.section.flow")}
          hint={t("precheck.wizard.section.flowFrozenHint")}
        >
          <div className="rounded-xl border p-4" data-testid="wizard-flow-frozen">
            <p className="text-sm font-semibold">{flow?.name ?? draft?.flow_id}</p>
            <div className="mt-2">
              <StagePath flow={flow} />
            </div>
          </div>
        </FormSection>
      );
    }
    return (
      <FormSection
        title={t("precheck.wizard.section.flow")}
        hint={t("precheck.wizard.section.flowHint")}
      >
        {flowsQuery.isPending && <LoadingState variant="table" columns={3} />}
        {flowsQuery.isError && (
          <ErrorState
            error={flowsQuery.error}
            operationId="listCurrentUserFlows"
            onRetry={() => void flowsQuery.refetch()}
          />
        )}
        {flowsQuery.isSuccess && flows.length === 0 && (
          <div className="rounded-lg border">
            <EmptyState
              title={t("precheck.new.empty")}
              testId="wizard-flow-empty"
            />
          </div>
        )}
        {flows.length > 0 && (
          <FlowPicker flows={flows} selectedFlowId={selectedFlowId} onSelect={(id) => { setSelectedFlowId(id); setStepError(null); }} />
        )}
      </FormSection>
    );
  }

  function renderMetaSection(): ReactNode {
    return (
      <FormSection
        title={t("precheck.wizard.section.meta")}
        hint={t("precheck.wizard.section.metaHint")}
      >
        <MetaFields
          title={metaBound ? metaTitle : createTitle}
          description={metaBound ? metaDescription : createDescription}
          onTitleChange={(value) => {
            metadataEditRevisionRef.current += 1;
            visibleMetadataRef.current = {
              ...visibleMetadataRef.current,
              title: value.trim(),
            };
            if (metaBound) {
              setMetaTitle(value);
            } else {
              setCreateTitle(value);
              setStepError(null);
            }
          }}
          onDescriptionChange={(value) => {
            metadataEditRevisionRef.current += 1;
            visibleMetadataRef.current = {
              ...visibleMetadataRef.current,
              description: value === "" ? undefined : value,
            };
            if (metaBound) {
              setMetaDescription(value);
            } else {
              setCreateDescription(value);
            }
          }}
          requestedFor={metaBound ? metaRequestedFor : createRequestedFor}
          onRequestedForChange={(value) => {
            metadataEditRevisionRef.current += 1;
            visibleMetadataRef.current = {
              ...visibleMetadataRef.current,
              requested_scheduled_for: requestedForToIso(value),
            };
            if (metaBound) {
              setMetaRequestedFor(value);
            } else {
              setCreateRequestedFor(value);
            }
            setStepError(null);
          }}
          requestedForError={
            metaBound
              ? metaRequestedFor !== "" && new Date(metaRequestedFor).getTime() <= Date.now()
                ? t("precheck.wizard.requestedSchedulePast")
                : null
              : createRequestedFor !== "" && requestedForToIso(createRequestedFor) === null
                ? t("precheck.wizard.requestedScheduleInvalid")
                : createRequestedFor !== "" && new Date(createRequestedFor).getTime() <= Date.now()
                  ? t("precheck.wizard.requestedSchedulePast")
                  : null
          }
          titleError={stepError}
        />
      </FormSection>
    );
  }

  function renderSqlSection(): ReactNode {
    const draftMode = mode === "draft" || adopted;
    // RCP-20261101：呈现相位只由瞬态run＋本地staleness决定——未预审即诚实
    // 显示idle（创建态未领养也能预审）。
    const phasePresented = presentPhase(phase, sqlChangedSincePrecheck, hasPrecheckResult);
    const hasPresentedRun = hasPrecheckResult;
    let findingsState: FindingListState;
    if (precheckExpired) {
      findingsState = { status: "expired" };
    } else if (!hasPresentedRun) {
      findingsState = { status: "idle" };
    } else if (reviewRunError) {
      findingsState = {
        status: "error",
        error: reviewRunErrorDetail,
        operationId: "getReviewRun",
      };
    } else if (reviewRunPending) {
      findingsState = { status: "loading" };
    } else if (phasePresented === "queued" || phasePresented === "running") {
      findingsState = { status: "waiting" };
    } else if (run === null) {
      findingsState = { status: "loading" };
    } else if (phasePresented === "outdated" || flowUpdated) {
      findingsState = { status: "stale" };
    } else if (!isTerminalPhase(phasePresented)) {
      // A run snapshot that has not produced a terminal result is still
      // waiting, never a successful empty list.
      findingsState = { status: "waiting" };
    } else if (findingsQuery.isError) {
      findingsState = { status: "error", error: findingsQuery.error };
    } else if (findingsQuery.isPending) {
      findingsState = { status: "loading" };
    } else {
      const findings = findingsQuery.data;
      const incomplete =
        phasePresented === "failed" ||
        phasePresented === "partial" ||
        (phasePresented === "blocked" && findings.length === 0);
      findingsState = {
        status: incomplete ? "incomplete" : "ready",
        findings,
      };
    }
    const editorValue = draftMode ? store.sql : createSql;
    const editorChange = draftMode
      ? (sql: string) => { store.setSql(sql); }
      : (sql: string) => {
          createSqlRef.current = sql;
          setCreateSql(sql);
        };

    return (
      <FormSection title={t("precheck.wizard.title.sql")} hint={t("precheck.wizard.description.sql")} last>
        <div className="flex flex-col gap-3">
          {(timedOutState.timedOut && (phasePresented === "queued" || phasePresented === "running")) && (
            <div
              role="alert"
              className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
              data-testid="review-timeout"
            >
              <CircleAlert className="size-4" aria-hidden />
              <span>{t("precheck.review.timeout")}</span>
              <Button variant="outline" size="sm" className="text-sm font-semibold" onClick={() => { void invalidateAll(); }}>
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

          {/* Bulk mode needs a definite card height: with the auto-height
           * card the virtualized list would grow with its content and the
           * virtualizer would treat every row as visible. */}
          <Card className={isBulk ? "flex h-[70vh] flex-col gap-0 overflow-hidden pt-0" : "flex flex-col gap-0 overflow-hidden pt-0"}>
            <CardHeader className="bg-muted/30 flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3">
              <CardTitle className="flex items-center gap-2">
                <FileCode2 aria-hidden />
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
                  className="text-sm font-semibold"
                  disabled={adoptionPending}
                  onClick={() => { setImportOpen(true); }}
                  data-testid="open-bulk-import"
                >
                  <FileUp className="size-3.5" aria-hidden />
                  {t("precheck.bulk.import.action")}
                </Button>
                {draft?.has_sql && store.savedSql === null && (
                  <PendingButton
                    variant="outline"
                    size="sm"
                    className="text-sm font-semibold"
                    pending={revealMutation.isPending}
                    onClick={() => { revealMutation.mutate(); }}
                    data-testid="reveal-sql"
                  >
                    {t("precheck.workspace.loadSql")}
                  </PendingButton>
                )}
                <PendingButton
                  size="sm"
                  pending={
                    reviewStartPending ||
                    reviewMutation.isPending ||
                    createMutation.isPending ||
                    adoptionPending
                  }
                  onClick={handleRunReview}
                  disabled={
                    (saveMutation.isPending && dirty) ||
                    adoptionPending ||
                    createMutation.isPending ||
                    phasePresented === "queued" ||
                    phasePresented === "running" ||
                    store.serverState === "submitted" ||
                    flowUpdated
                  }
                  className="text-sm font-semibold"
                  data-testid="run-review"
                >
                  <Play aria-hidden />
                  {t("precheck.workspace.runReview")}
                </PendingButton>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-2 py-4">
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
                      {/* 创建态未领养时导入文本在本地（RCP-20261101），占位
                          提示按当前编辑器值判断，不再只看store。 */}
                      {editorValue === ""
                        ? t("precheck.bulk.browser.revealFirst")
                        : t("precheck.bulk.browser.digesting")}
                    </div>
                  ) : (
                    <StatementBrowser
                      sql={editorValue}
                      digest={bulkDigest}
                      serverGroupCount={run?.fingerprint_group_count ?? null}
                      locate={bulkLocate}
                    />
                  )}
                </>
              ) : (
                <SqlEditorPanel
                  value={editorValue}
                  onChange={editorChange}
                  readOnly={store.serverState === "submitted"}
                  loadValue={loadValue}
                  onLocate={locate}
                  completionCatalog={completionCatalog}
                  className="h-[380px] min-h-[280px] rounded-none border-0"
                  data-testid="sql-editor"
                />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{t("precheck.wizard.resultsCard")}</h3>
            <Tabs
              value={resultsTab}
              onValueChange={(next) => { setResultsTab(next === "findings" ? "findings" : "overview"); }}
            >
              <TabsList>
                <TabsTrigger value="overview" data-testid="tab-overview">{t("precheck.tabs.overview")}</TabsTrigger>
                <TabsTrigger value="findings" data-testid="tab-findings">{t("precheck.tabs.findings")}</TabsTrigger>
              </TabsList>
              <TransitionPanel
                activeIndex={resultsTab === "findings" ? 1 : 0}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                variants={TAB_PANEL_VARIANTS}
              >
                <div>
                  <ReviewStatusCard
                    phase={phasePresented}
                    run={run}
                    hasRunId={hasPresentedRun}
                    isPending={reviewRunPending}
                    isError={reviewRunError}
                    error={reviewRunErrorDetail}
                    onRetry={() => { void refetchReviewRun(); }}
                  />
                </div>
                <div>
                  <FindingList
                  state={findingsState}
                  onOpenEvidence={(groupFindings) => { setEvidenceFindings(groupFindings); }}
                  onRetry={() => {
                    if (reviewRunError || run === null) {
                      void refetchReviewRun();
                    } else {
                      void findingsQuery.refetch();
                    }
                  }}
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
                </div>
              </TransitionPanel>
            </Tabs>
          </div>
        </div>
      </FormSection>
    );
  }

  function renderPage(): ReactNode {
    return (
      <PageLayout
        data-testid={mode === "create" ? "changes-new-page" : "draft-workspace-page"}
        // The implicitly adopted draft id (e2e probes it; the URL never moves).
        data-draft-id={activeDraftId ?? undefined}
      >
        {/* No page title band (owner ruling 2026-10-24, same ruling as the
         * breadcrumb removal): the form starts directly; the summary card
         * carries the draft status. */}

        {/* Left: one continuous form. Right: sticky live summary. */}
        <div className="grid items-start lg:grid-cols-[minmax(0,1fr)_380px]">
          <main className="min-w-0 lg:border-r" aria-label={t("precheck.wizard.pageTitle")}>
            {renderFlowSection()}
            {renderMetaSection()}
            {renderSqlSection()}
          </main>
          <aside
            className="flex flex-col gap-4 p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
            aria-label={t("precheck.wizard.summaryTitle")}
          >
            {renderSummaryCard()}
            <FlowTimelineCard flow={flow} />
          </aside>
        </div>

        {/* 批量导入纯本地（RCP-20261101）：确认即落编辑器内容，不再上传。 */}
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onConfirm={handleImportConfirm}
        />
        <EvidenceSheet
          findings={evidenceFindings}
          open={evidenceFindings.length > 0}
          onOpenChange={(open) => {
            if (!open) setEvidenceFindings([]);
          }}
        />

        {/* Submit confirmation (F6 deliverable 提交确认与Gate原因): the
         * summary card mirrors the gate, the dialog restates what submission
         * freezes and what the backend would still reject — the mutation only
         * fires after the explicit confirm. */}
        <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
          <DialogContent data-testid="submit-confirm-dialog">
            <DialogHeader>
              <DialogTitle>{t("precheck.submit.confirmTitle")}</DialogTitle>
              <DialogDescription>{t("precheck.submit.confirmDescription")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm">
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
              <PendingButton
                pending={submitMutation.isPending}
                onClick={() => { submitMutation.mutate(); }}
                data-testid="submit-confirm-accept"
              >
                {t("precheck.submit.confirmAction")}
              </PendingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageLayout>
    );
  }
}
