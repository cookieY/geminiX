import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type {
  ChangeOrder,
  ExecutionAttempt,
  ExecutionStatement,
  OscExecutionDetails,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  ATTEMPT_TERMINAL_STATES,
  executionAttemptTone,
  frozenExecutorStageFor,
  ORDER_STATE_TONE_CLASS,
  statementStateTone,
} from "@/features/orders/order-state";
import {
  useCancelExecutionAttempt,
  useCreateExecutionAttempt,
  useCreateExecutionSchedule,
  useCreateExecutionVerification,
  useExecutionAttempt,
  useExecutionStatements,
} from "@/features/orders/use-execution";
import { useCopyOrderToDraft } from "@/features/orders/use-orders";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Progress } from "@/shared/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  CalendarClock,
  CircleAlert,
  Copy,
  Fingerprint,
  Gauge,
  ListChecks,
  Play,
  ShieldQuestion,
  XCircle,
} from "lucide-react";

/**
 * Execution workspace (frontend PRD F8 items 1–3, W006, E001–E007). The
 * executor area renders only for the frozen executors of the stage currently
 * waiting for execution — approval never auto-executes, and admin confers no
 * execution right. Once an attempt exists (its id comes from the creation
 * response; the contract has no list-attempts read), the workspace shows
 * preflight/progress, the per-statement ledger, OSC progress and the
 * unknown-result verification form. There is deliberately no retry button:
 * a stage whose prior attempt crossed the send boundary can only restart as
 * a copied draft (E004), and there is no rollback entry anywhere (E003).
 */

function formatTimestamp(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : value.replace("T", " ").replace("Z", " UTC");
}

/** Order states whose execution fate is final and unretryable — the only
 * forward path is a copied draft re-running the whole review pipeline. */
const COPY_ONLY_STATES = new Set([
  "failed",
  "partial_failed",
  "cancelled",
  "partial_cancelled",
  "missed_schedule",
]);

function StateBadge({ state, labelRoot, tone }: { state: string; labelRoot: string; tone: (state: string) => ReturnType<typeof statementStateTone> }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={`${ORDER_STATE_TONE_CLASS[tone(state)]} text-xs`}>
      {t(`${labelRoot}.${state}`, { defaultValue: state })}
    </Badge>
  );
}

/** Executor affordances for the stage waiting in execution_pending (W006).
 * Shows the frozen SQL hash both the approval and this execution are bound
 * to (gate: 批准与执行SQL Hash一致展示), the DML/DDL semantics note, the
 * execute confirm and the deferred-schedule form. */
function ExecutionActionCard({ order, onAttemptCreated }: {
  order: ChangeOrder;
  onAttemptCreated: (attemptId: string) => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const stage = frozenExecutorStageFor(order, session.user?.id);
  const create = useCreateExecutionAttempt(order, onAttemptCreated);
  const schedule = useCreateExecutionSchedule(order);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleNote, setScheduleNote] = useState<string | null>(null);
  // The 5-minute / 30-day schedule window depends on wall-clock time, so it
  // is derived inside the change handler (impure work stays out of render).
  const [dueInRange, setDueInRange] = useState(false);
  const applyScheduledFor = (value: string): void => {
    setScheduledFor(value);
    setScheduleNote(null);
    if (value === "") {
      setDueInRange(false);
      return;
    }
    const lead = new Date(value).getTime() - Date.now();
    setDueInRange(!Number.isNaN(lead) && lead > 5 * 60 * 1000 && lead < 30 * 24 * 3600 * 1000);
  };

  if (stage === null) return null;

  // The datetime-local value is interpreted as local time; the wire format is
  // RFC3339 UTC (ScheduleRequest Timestamp).
  const scheduleValue = (): string | null => {
    if (scheduledFor === "") return null;
    const due = new Date(scheduledFor);
    if (Number.isNaN(due.getTime())) return null;
    return due.toISOString().replace(/\.\d{3}Z$/, "Z");
  };
  const dueIso = scheduleValue();

  const runExecute = (): void => {
    create.mutate(
      {},
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setActionError(null);
        },
        onError: (error) => {
          const display = describeError(error, "createExecutionAttempt");
          setActionError(
            `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
          );
        },
      },
    );
  };

  const runSchedule = (): void => {
    if (dueIso === null) return;
    schedule.mutate(dueIso, {
      onSuccess: (created) => {
        setScheduleNote(t("orders.execution.scheduleCreated", { time: formatTimestamp(created.scheduled_for) }));
        setScheduledFor("");
        setActionError(null);
      },
      onError: (error) => {
        const display = describeError(error, "createExecutionSchedule");
        setActionError(
          `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
        );
      },
    });
  };

  const pending = create.isPending || schedule.isPending;

  return (
    <Card data-testid="execution-action-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Play className="size-4" aria-hidden />
          {t("orders.execution.actionTitle")}
        </CardTitle>
        <CardDescription>{t("orders.execution.actionNote")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="execution-hash-line">
          <Fingerprint className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("orders.execution.sqlHash")}</span>
          <span className="font-mono text-xs">{order.sql_hash}</span>
          <Badge variant="outline" className="text-xs" data-testid="execution-hash-consistent">
            {t("orders.execution.hashConsistent")}
          </Badge>
        </p>
        <p className="text-muted-foreground text-xs">{t("orders.execution.semanticsNote")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Button onClick={() => { setConfirmOpen(true); setActionError(null); }} disabled={pending} data-testid="execution-start">
            <Play className="size-4" aria-hidden />
            {t("orders.execution.start")}
          </Button>
          <div className="flex flex-col gap-1">
            <Label htmlFor="execution-schedule-at" className="text-xs">
              {t("orders.execution.scheduleLabel")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="execution-schedule-at"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => { applyScheduledFor(event.target.value); }}
                data-testid="execution-schedule-input"
                className="w-56"
              />
              <Button
                variant="outline"
                onClick={runSchedule}
                disabled={pending || !dueInRange}
                data-testid="execution-schedule-submit"
              >
                <CalendarClock className="size-4" aria-hidden />
                {t("orders.execution.scheduleSubmit")}
              </Button>
            </div>
            {scheduleNote !== null && (
              <p className="text-xs text-muted-foreground" data-testid="execution-schedule-note">{scheduleNote}</p>
            )}
          </div>
        </div>
        {actionError !== null && (
          <p role="alert" className="text-destructive text-sm" data-testid="execution-action-error">
            {actionError}
          </p>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open) { setConfirmOpen(false); setActionError(null); } }}>
        <DialogContent data-testid="execution-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{t("orders.execution.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("orders.execution.confirmDescription")}</DialogDescription>
          </DialogHeader>
          <Alert className="border-amber-600/40" data-testid="execution-ddl-warning">
            <CircleAlert className="size-4" aria-hidden />
            <AlertTitle>{t("orders.execution.ddlWarningTitle")}</AlertTitle>
            <AlertDescription>{t("orders.execution.ddlWarningDescription")}</AlertDescription>
          </Alert>
          {actionError !== null && (
            <p role="alert" className="text-destructive text-sm">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setActionError(null); }} data-testid="execution-confirm-cancel">
              {t("common.cancel")}
            </Button>
            <Button onClick={runExecute} disabled={create.isPending} data-testid="execution-confirm-run">
              {t("orders.execution.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Per-statement ledger (PRD F8 item 2): ordinal, kind, state, affected rows,
 * duration and sanitized error. `unknown` renders in its own high-risk
 * wording — never as not-executed (gate: Unknown绝不显示成未执行). */
function StatementLedger({ attemptId, live }: { attemptId: string; live: boolean }) {
  const { t } = useTranslation();
  const statementsQuery = useExecutionStatements(attemptId, true, live);

  if (statementsQuery.isPending) return null;
  if (statementsQuery.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("orders.execution.statementsError")}
      </p>
    );
  }
  const items = statementsQuery.data;
  const duration = (statement: ExecutionStatement): string => {
    if (statement.started_at == null || statement.finished_at == null) return "—";
    const ms = Date.parse(statement.finished_at) - Date.parse(statement.started_at);
    return `${String(ms)} ms`;
  };
  return (
    <div className="rounded-md border" data-testid="execution-statements">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead className="w-20">{t("orders.execution.statementKind")}</TableHead>
            <TableHead>{t("orders.execution.statementState")}</TableHead>
            <TableHead className="w-28">{t("orders.execution.affectedRows")}</TableHead>
            <TableHead className="w-24">{t("orders.execution.duration")}</TableHead>
            <TableHead>{t("orders.execution.failureName")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((statement) => (
            <TableRow key={statement.id} data-testid={`execution-statement-${String(statement.ordinal)}`}>
              <TableCell className="font-mono text-xs">{String(statement.ordinal)}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs uppercase">
                  {statement.statement_kind}
                </Badge>
              </TableCell>
              <TableCell>
                <StateBadge state={statement.state} labelRoot="orders.statementState" tone={statementStateTone} />
              </TableCell>
              <TableCell>{statement.affected_row_count === null ? "—" : String(statement.affected_row_count)}</TableCell>
              <TableCell className="text-xs">{duration(statement)}</TableCell>
              <TableCell className="font-mono text-xs">{statement.failure_name ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {live && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("orders.execution.liveNote")}</p>}
    </div>
  );
}

/** OSC progress and residual surface (E006): phase, progress, rows copied and
 * the leftover-resource state a failed/cancelled gh-ost job must show. */
function OscProgress({ osc }: { osc: OscExecutionDetails }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="execution-osc">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Gauge className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">gh-ost</span>
        <StateBadge state={osc.phase} labelRoot="orders.oscPhase" tone={executionAttemptTone} />
      </p>
      <Progress value={(osc.progress_basis_points / 100)} className="h-2" data-testid="execution-osc-progress" />
      <p className="text-xs text-muted-foreground">
        {t("orders.execution.oscRows", { rows: osc.rows_copied, percent: Math.floor(osc.progress_basis_points / 100) })}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t("orders.execution.oscResidual")}</span>
        <StateBadge state={osc.residual_state} labelRoot="orders.oscResidualState" tone={statementStateTone} />
      </p>
    </div>
  );
}

/** Manual verification for result_unknown (E005): four fixed verdicts, reason
 * and database-side evidence are mandatory; only frozen executors see the
 * form, and the manual-confirmation marker persists afterwards. */
function VerificationCard({ order, attempt, onRecover }: {
  order: ChangeOrder;
  attempt: ExecutionAttempt;
  onRecover: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const verify = useCreateExecutionVerification(attempt, order.id);
  const [result, setResult] = useState<string>("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<Array<{ kind: string; content: string }>>([
    { kind: "database_fact", content: "" },
  ]);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // The verification right follows the attempt's frozen stage, not the
  // current workflow position; the form only exists while the order itself
  // still sits in result_unknown (a first non-still_unknown verdict
  // terminalizes the order and closes the path — backend answers 1010 after).
  if (order.state !== "result_unknown" || attempt.state !== "result_unknown") return null;
  const stageOfAttempt = order.stages.find((candidate) => candidate.id === attempt.stage_id) ?? null;
  const isExecutor = stageOfAttempt?.execution_actors.some((actor) => actor.id === session.user?.id) ?? false;

  if (!isExecutor || stageOfAttempt === null) {
    return (
      <Alert data-testid="verification-waiting">
        <ShieldQuestion className="size-4" aria-hidden />
        <AlertTitle>{t("orders.execution.verifyWaitingTitle")}</AlertTitle>
        <AlertDescription>{t("orders.execution.verifyWaitingDescription")}</AlertDescription>
      </Alert>
    );
  }

  const evidenceComplete = evidence.every((entry) => entry.content.trim() !== "");
  const canSubmit = result !== "" && reason.trim() !== "" && evidenceComplete && !verify.isPending;

  const submit = (): void => {
    verify.mutate(
      {
        result: result as "confirmed_succeeded" | "confirmed_failed" | "confirmed_partial" | "still_unknown",
        reason: reason.trim(),
        evidence: evidence.map((entry) => ({
          kind: entry.kind as "text" | "database_fact" | "external_reference",
          content: entry.content.trim(),
        })),
      },
      {
        onSuccess: () => {
          setDialogError(null);
          onRecover();
        },
        onError: (error) => {
          const display = describeError(error, "createExecutionVerification");
          setDialogError(
            `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
          );
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-600/40 bg-amber-600/5 p-3" data-testid="verification-form">
      <Alert className="border-amber-600/40">
        <CircleAlert className="size-4" aria-hidden />
        <AlertTitle>{t("orders.execution.verifyTitle")}</AlertTitle>
        <AlertDescription>{t("orders.execution.verifyDescription")}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("orders.execution.verifyResult")} data-testid="verification-result-group">
        {(["confirmed_succeeded", "confirmed_failed", "confirmed_partial", "still_unknown"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={result === value}
            variant={result === value ? "default" : "outline"}
            onClick={() => { setResult(value); setDialogError(null); }}
            data-testid={`verification-result-${value}`}
          >
            {t(`orders.execution.verifyResult.${value}`)}
          </Button>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="verification-reason">{t("orders.execution.verifyReason")}</Label>
        <Textarea
          id="verification-reason"
          value={reason}
          onChange={(event) => { setReason(event.target.value); }}
          rows={2}
          maxLength={4096}
          data-testid="verification-reason"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-xs">{t("orders.execution.verifyEvidence")}</Label>
        {evidence.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={entry.kind}
              onValueChange={(kind) => {
                if (kind === null) return;
                setEvidence((entries) => entries.map((item, itemIndex) => (itemIndex === index ? { ...item, kind } : item)));
              }}
            >
              <SelectTrigger className="w-44" data-testid={`verification-evidence-kind-${String(index)}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t("orders.execution.evidenceKind.text")}</SelectItem>
                <SelectItem value="database_fact">{t("orders.execution.evidenceKind.database_fact")}</SelectItem>
                <SelectItem value="external_reference">{t("orders.execution.evidenceKind.external_reference")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={entry.content}
              onChange={(event) => {
                setEvidence((entries) => entries.map((item, itemIndex) => (itemIndex === index ? { ...item, content: event.target.value } : item)));
              }}
              placeholder={t("orders.execution.evidencePlaceholder")}
              data-testid={`verification-evidence-content-${String(index)}`}
            />
            {evidence.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("orders.execution.evidenceRemove")}
                onClick={() => { setEvidence((entries) => entries.filter((_, itemIndex) => itemIndex !== index)); }}
              >
                <XCircle className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          className="self-start"
          onClick={() => { setEvidence((entries) => [...entries, { kind: "database_fact", content: "" }]); }}
          data-testid="verification-evidence-add"
        >
          {t("orders.execution.evidenceAdd")}
        </Button>
      </div>
      {dialogError !== null && (
        <p role="alert" className="text-destructive text-sm" data-testid="verification-error">{dialogError}</p>
      )}
      <Button onClick={submit} disabled={!canSubmit} data-testid="verification-submit">
        {t("orders.execution.verifySubmit")}
      </Button>
    </div>
  );
}

/** The known attempt: progress, cancel (any frozen executor may request it),
 * statement ledger, OSC surface and the verification form. */
function ExecutionAttemptCard({ order, attemptId, onRecover }: {
  order: ChangeOrder;
  attemptId: string;
  onRecover: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const attemptQuery = useExecutionAttempt(attemptId, order.id, true);
  const cancel = useCancelExecutionAttempt(attemptQuery.data ?? null, order.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (attemptQuery.isPending || attemptQuery.isError) return null;
  const attempt: ExecutionAttempt = attemptQuery.data;
  const live = !ATTEMPT_TERMINAL_STATES.has(attempt.state);
  const stageOfAttempt = order.stages.find((candidate) => candidate.id === attempt.stage_id) ?? null;
  const isExecutor = stageOfAttempt?.execution_actors.some((actor) => actor.id === session.user?.id) ?? false;

  const submitCancel = (): void => {
    cancel.mutate(cancelReason.trim(), {
      onSuccess: () => {
        setCancelOpen(false);
        setCancelReason("");
        setCancelError(null);
      },
      onError: (error) => {
        const display = describeError(error, "cancelExecutionAttempt");
        setCancelError(
          `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
        );
        onRecover();
      },
    });
  };

  return (
    <Card data-testid="execution-attempt-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListChecks className="size-4" aria-hidden />
          {t("orders.execution.attemptTitle")}
          <StateBadge state={attempt.state} labelRoot="orders.attemptState" tone={executionAttemptTone} />
          {attempt.send_boundary === "sent" && (
            <Badge variant="outline" className="text-xs">{t("orders.execution.boundarySent")}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {attempt.state === "preflight" || attempt.state === "running" || ATTEMPT_TERMINAL_STATES.has(attempt.state)
            ? t("orders.execution.preflightHashOk")
            : t("orders.execution.preflightPending")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {attempt.osc != null && <OscProgress osc={attempt.osc} />}
        <StatementLedger attemptId={attempt.id} live={live} />
        {attempt.state === "result_unknown" && (
          <VerificationCard order={order} attempt={attempt} onRecover={onRecover} />
        )}
        {isExecutor && attempt.state === "running" && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => { setCancelOpen(true); setCancelError(null); }}
            disabled={cancel.isPending}
            data-testid="execution-cancel"
          >
            <XCircle className="size-4" aria-hidden />
            {t("orders.execution.cancel")}
          </Button>
        )}
      </CardContent>

      <Dialog open={cancelOpen} onOpenChange={(open) => { if (!open) { setCancelOpen(false); setCancelError(null); } }}>
        <DialogContent data-testid="execution-cancel-dialog">
          <DialogHeader>
            <DialogTitle>{t("orders.execution.cancelTitle")}</DialogTitle>
            <DialogDescription>{t("orders.execution.cancelDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="execution-cancel-reason">{t("orders.execution.cancelReason")}</Label>
            <Textarea
              id="execution-cancel-reason"
              value={cancelReason}
              onChange={(event) => { setCancelReason(event.target.value); }}
              rows={3}
              maxLength={4096}
              data-testid="execution-cancel-reason"
            />
          </div>
          {cancelError !== null && (
            <p role="alert" className="text-destructive text-sm" data-testid="execution-cancel-error">{cancelError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelOpen(false); setCancelError(null); }} data-testid="execution-cancel-cancel">
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={submitCancel}
              disabled={cancelReason.trim() === "" || cancel.isPending}
              data-testid="execution-cancel-confirm"
            >
              {t("orders.execution.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Copy-only notice for unretryable execution fates (E004 gate:
 * 非not_started只复制新草稿) — a fresh draft re-runs review and approval; no
 * retry and no rollback exists. */
function CopyDraftCard({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const copy = useCopyOrderToDraft(order);
  const [open, setOpen] = useState(false);
  const [flowId, setFlowId] = useState<string>("");
  const [title, setTitle] = useState(`${order.title ?? ""} · ${t("orders.execution.copySuffix")}`);
  const [error, setError] = useState<string | null>(null);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [flowsLoaded, setFlowsLoaded] = useState(false);

  if (!COPY_ONLY_STATES.has(order.state)) return null;

  const openDialog = async (): Promise<void> => {
    setOpen(true);
    setError(null);
    if (flowsLoaded) return;
    try {
      const { listCurrentUserFlows } = await import("@/api/generated/client/change-drafts/change-drafts");
      const page = (await listCurrentUserFlows({ flow_type: "change_review" })) as unknown as {
        items: Array<{ id: string; name: string }>;
      };
      setFlows(page.items);
      setFlowId(page.items[0]?.id ?? "");
      setFlowsLoaded(true);
    } catch {
      setFlows([]);
    }
  };

  const runCopy = (): void => {
    copy.mutate(
      { target_flow_id: flowId, title: title.trim() },
      {
        onSuccess: (draft) => {
          const draftId = (draft as unknown as { id: string }).id;
          void navigate(`/changes/drafts/${draftId}`);
        },
        onError: (mutationError) => {
          const display = describeError(mutationError, "copyChangeOrderToDraft");
          setError(
            `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
          );
        },
      },
    );
  };

  return (
    <>
      <Card data-testid="copy-draft-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Copy className="size-4" aria-hidden />
            {t("orders.execution.copyTitle")}
          </CardTitle>
          <CardDescription>{t("orders.execution.copyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => { void openDialog(); }} data-testid="copy-draft-open">
            {t("orders.execution.copyOpen")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(next) => { if (!next) { setOpen(false); setError(null); } }}>
        <DialogContent data-testid="copy-draft-dialog">
          <DialogHeader>
            <DialogTitle>{t("orders.execution.copyDialogTitle")}</DialogTitle>
            <DialogDescription>{t("orders.execution.copyDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <Label htmlFor="copy-draft-flow">{t("orders.execution.copyFlow")}</Label>
              <Select value={flowId} onValueChange={(value) => { if (value !== null) setFlowId(value); }}>
                <SelectTrigger data-testid="copy-draft-flow">
                  <SelectValue placeholder={t("orders.execution.copyFlowPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {flows.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="copy-draft-title">{t("orders.execution.copyTitleLabel")}</Label>
              <Input
                id="copy-draft-title"
                value={title}
                onChange={(event) => { setTitle(event.target.value); }}
                maxLength={128}
                data-testid="copy-draft-title"
              />
            </div>
            {error !== null && (
              <p role="alert" className="text-destructive text-sm" data-testid="copy-draft-error">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setError(null); }} data-testid="copy-draft-cancel">
              {t("common.cancel")}
            </Button>
            <Button
              onClick={runCopy}
              disabled={flowId === "" || title.trim() === "" || copy.isPending}
              data-testid="copy-draft-confirm"
            >
              {t("orders.execution.copyOpen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExecutionWorkspaceCard({ order, attemptId, onAttemptCreated, onRecover }: {
  order: ChangeOrder;
  attemptId: string | null;
  onAttemptCreated: (attemptId: string) => void;
  onRecover: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ExecutionActionCard order={order} onAttemptCreated={onAttemptCreated} />
      {attemptId !== null && (
        <ExecutionAttemptCard order={order} attemptId={attemptId} onRecover={onRecover} />
      )}
      <CopyDraftCard order={order} />
    </div>
  );
}
