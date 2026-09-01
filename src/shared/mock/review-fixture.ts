import { HttpResponse, delay, http } from "msw";
import type { DefaultBodyType, HttpHandler } from "msw";
import { readStoredScenario } from "@/shared/mock/scenario-store";
import { readStoredAuthBehavior } from "@/shared/mock/auth-scenario-store";
import { adminFixtureTask } from "@/shared/mock/admin-fixture";
import { queryFlowsCatalogPage } from "@/shared/mock/query-fixture";
import { digestSqlText, type SqlDigest } from "@/features/review/bulk-import/sql-digest";
import { canVoid, withdrawOutcome } from "@/features/orders/order-state";
import {
  BULK_MODE_MIN_STATEMENTS,
  FINGERPRINT_MAX_STATEMENT_BYTES,
  FINGERPRINT_MAX_UNIQUE,
} from "@/features/review/bulk-constants";

/**
 * Stateful change-draft/review fixture backing FE-F4 mock development and
 * E2E (code-generation-policy.json mock_layer; PRD F4 exit criteria: the
 * whole precheck flow runs on the mock). It mirrors the real backend's
 * semantics — the 200 business envelope, version increments, draft state
 * transitions (state-machines.json `change_draft`), review-run progression
 * with domain events on the Outbox pattern, and the declared error codes
 * (operation-error-profiles: draft_review, draft_submit, sensitive_reveal).
 *
 * Handlers run on the page main thread (MSW forwards intercepted requests
 * there), so the module-scope world is shared with the page-side mock event
 * transport — the same async-generator seam the ReviewEventClient consumes
 * in tests.
 */

const MOCK_REQUEST_ID = "33333333-3333-4333-8333-333333333333";

// Deterministic identity shared with the auth mock handlers: the fixture
// drafts are owned by the same user the session mock authenticates.
export const FIXTURE_OWNER_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";
export const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
export const FIXTURE_DATASOURCE_ID = "4f6f1a2b-0000-4000-8000-000000000002";

// Unique markers the E2E storage/telemetry scan can look for after a reveal.
export const FIXTURE_SQL_MARKER = "e2e-sql-plaintext-marker-DO-NOT-PERSIST";
export const FIXTURE_RAW_EVIDENCE_MARKER = "e2e-raw-evidence-marker-DO-NOT-PERSIST";

const QUEUED_TO_RUNNING_MS = 400;
const RUNNING_TO_TERMINAL_MS = 900;

export type ReviewBehavior = "ready" | "blocked" | "partial" | "provider_failed";

/** Review outcome requested by the active mock scenario (default: healthy). */
function currentBehavior(): ReviewBehavior {
  const scenario = readStoredScenario();
  switch (scenario) {
    case "review-blocked":
      return "blocked";
    case "review-partial":
      return "partial";
    case "review-provider-failed":
      return "provider_failed";
    default:
      return "ready";
  }
}

interface FixtureStageResult {
  stage_position: number;
  datasource_id: string;
  state: "pending" | "running" | "passed" | "blocked" | "partial" | "failed";
  highest_severity: "none" | "low" | "medium" | "high" | "critical";
  gate_passed: boolean;
  finding_count: number;
  evidence_count: number;
  snapshot_hash: string;
}

interface FixtureRun {
  id: string;
  draft_id: string;
  draft_revision: number;
  state: "queued" | "running" | "ready" | "blocked" | "partial" | "failed" | "outdated";
  statement_count: number;
  fingerprint_group_count: number;
  stage_results: FixtureStageResult[];
  gate: { passed: boolean; reason_codes: string[] };
  failure_code: string | null;
  version: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Fixture-internal local digest backing bulk runs; never serialized. */
  digest?: SqlDigest;
}

interface FixtureFinding {
  id: string;
  stage_position: number;
  fingerprint_group_id: string | null;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  suggestion: string | null;
  model_confidence: number | null;
  evidence_ids: string[];
}

interface FixtureEvidence {
  id: string;
  source_kind: string;
  source_reference: string;
  fact_status: "known" | "unknown" | "unavailable" | "stale";
  normalized_fact: Record<string, unknown>;
  has_raw_payload: boolean;
  raw_payload_expires_at: string | null;
  collected_at: string;
}

interface FixtureDraft {
  id: string;
  owner_user_id: string;
  flow_id: string;
  title: string;
  description: string | null;
  revision: number;
  state: "draft" | "reviewing" | "ready" | "blocked" | "partial" | "failed" | "outdated" | "submitted";
  has_sql: boolean;
  sql: string | null;
  sql_size_bytes: number | null;
  statement_count: number | null;
  review_run_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface FixtureTask {
  id: string;
  kind: "sql_grouping" | "ai_review";
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: { completed: number; total: number; unit: string };
  result_ref: string | null;
  error: null;
  created_at: string;
  updated_at: string;
}

interface FixtureTimelineEntry {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_kind: "user" | "system" | "worker";
  actor_user_id: string | null;
  actor_display_name: string | null;
  summary: string;
  stage_position: number | null;
  state: string | null;
}

/** StepState from the frozen order_approval_steps vocabulary
 * (changeorder domain: pending/active/approved/rejected/skipped/invalid). */
export type FixtureStepState = "pending" | "active" | "approved" | "rejected" | "skipped" | "invalid";

/** Mirrors the backend StepView JSON the OpenAPI leaves as a free object
 * (changeorder application/read.go): frozen actor snapshots with display
 * names, per-step decision state and decided_at. */
export interface FixtureApprovalStep {
  id: string;
  position: number;
  state: FixtureStepState;
  decided_at: string | null;
  actors: Array<{ id: string; username: string; display_name: string }>;
}

export interface FixtureOrder {
  id: string;
  display_number: string;
  submitter_user_id: string;
  title: string;
  state:
    | "submitted"
    | "stage_approval_active"
    | "stage_execution_pending"
    | "scheduled"
    | "running"
    | "completed"
    | "rejected"
    | "withdrawn"
    | "withdrawn_after_partial_execution"
    | "voided"
    | "failed"
    | "partial_failed"
    | "cancelled"
    | "partial_cancelled"
    | "result_unknown"
    | "blocked_datasource_unavailable"
    | "missed_schedule"
    | "invalid";
  current_stage_position: number | null;
  stages: Array<{
    id: string;
    position: number;
    datasource_name: string;
    state:
      | "pending"
      | "approval_active"
      | "execution_pending"
      | "scheduled"
      | "running"
      | "succeeded"
      | "failed"
      | "partial_failed"
      | "cancelled"
      | "partial_cancelled"
      | "result_unknown"
      | "skipped";
    approval_steps: FixtureApprovalStep[];
    execution_actors: Array<{
      id: string;
      username: string;
      display_name: string;
      email: string | null;
      is_builtin_admin: boolean;
      version: number;
      created_at: string;
      updated_at: string;
    }>;
  }>;
  has_sql: true;
  sql_hash: string;
  snapshot_hash: string;
  manually_verified: boolean;
  version: number;
  submitted_at: string;
  terminal_at: string | null;
  /** Fixture-internal link to the frozen submission review run; never
   * serialized (feeds the order-side frozen findings endpoint). */
  review_run_id: string | null;
  /** Fixture-internal plaintext for the sql-reveals handler (mirrors the
   * backend order_sql_payloads envelope); never serialized — the public
   * surface carries sql_hash only. */
  sql_text: string;
}

interface FixtureComment {
  id: string;
  order_id: string;
  author_user_id: string;
  author_display_name: string;
  content: string;
  occurred_at: string;
}

/** Per-statement sanitized execution fact (OpenAPI ExecutionStatement). The
 * ordinal-ordered rows are the only statement-level surface — there is no
 * "statement text" field, mirroring the backend's sanitized ledger. */
export interface FixtureStatement {
  id: string;
  ordinal: number;
  statement_kind: "ddl" | "dml";
  state: "not_started" | "sent" | "succeeded" | "failed" | "cancelled" | "unknown" | "skipped";
  affected_row_count: number | null;
  failure_name: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** Frozen per-tool OSC details (OpenAPI OscExecutionDetails); residual_state
 * is the gh-ost cleanup surface E006 requires the UI to show. */
export interface FixtureOscDetails {
  tool: "gh-ost" | "pt-osc";
  tool_version: string;
  binary_sha256: string;
  plan_hash: string;
  phase:
    | "planned"
    | "preflight"
    | "copying"
    | "postponed_cutover"
    | "cutover"
    | "cleanup"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "result_unknown";
  progress_basis_points: number;
  rows_copied: number;
  residual_state: "not_checked" | "none" | "detected" | "cleanup_required" | "cleaned";
  last_heartbeat_at: string | null;
}

/** Mock execution attempt (OpenAPI ExecutionAttempt). `order_id`,
 * `statements` and `outcome` are fixture-internal drivers, never serialized —
 * statements are served only through the paginated statements endpoint. */
export interface FixtureExecutionAttempt {
  id: string;
  order_id: string;
  stage_id: string;
  execution_kind: "ddl" | "dml" | "gh_ost";
  state:
    | "created"
    | "preflight"
    | "running"
    | "cancelling"
    | "succeeded"
    | "failed"
    | "partial_failed"
    | "cancelled"
    | "partial_cancelled"
    | "result_unknown";
  send_boundary: "not_started" | "sending" | "sent";
  osc: FixtureOscDetails | null;
  version: number;
  created_at: string;
  statements: FixtureStatement[];
  /** Deterministic terminal shape the progression engine runs toward; the
   * ghost attempt stays running until cancelled (residual inspection is its
   * whole point). */
  outcome: "succeeded" | "partial_failed" | "result_unknown" | "ghost";
}

/** Deferred-execution reservation (OpenAPI ExecutionSchedule). Cancellation
 * has no dedicated endpoint — the submitter withdraws the order and the
 * scheduler closes the row, so the fixture only ever creates and serves
 * schedules. */
export interface FixtureSchedule {
  id: string;
  order_id: string;
  stage_id: string;
  scheduled_for: string;
  state: "scheduled" | "running" | "cancelled" | "missed" | "blocked";
  version: number;
}

/** Manual unknown-result verification record (OpenAPI
 * ExecutionVerificationRequest + the backend's permanent audit shape). */
export interface FixtureVerification {
  id: string;
  attempt_id: string;
  result: "confirmed_succeeded" | "confirmed_failed" | "confirmed_partial" | "still_unknown";
  reason: string;
  evidence: Array<{ kind: "text" | "database_fact" | "external_reference"; content: string }>;
  verified_by_user_id: string;
  occurred_at: string;
}

interface FixtureEvent {
  subject: string;
  sequence: number;
  payload: Record<string, unknown>;
}

interface FixtureWorld {
  drafts: Map<string, FixtureDraft>;
  runs: Map<string, FixtureRun>;
  tasks: Map<string, FixtureTask>;
  findings: Map<string, FixtureFinding[]>;
  evidence: Map<string, FixtureEvidence>;
  orders: Map<string, FixtureOrder>;
  orderTimeline: Map<string, FixtureTimelineEntry[]>;
  orderComments: Map<string, FixtureComment[]>;
  attempts: Map<string, FixtureExecutionAttempt>;
  schedules: Map<string, FixtureSchedule>;
  verifications: Map<string, FixtureVerification[]>;
  orderSequence: number;
  outbox: FixtureEvent[];
  sequences: Map<string, number>;
  flowVersion: number;
  flowUpdated: boolean;
}

const world: FixtureWorld = {
  drafts: new Map(),
  runs: new Map(),
  tasks: new Map(),
  findings: new Map(),
  evidence: new Map(),
  orders: new Map(),
  orderTimeline: new Map(),
  orderComments: new Map(),
  attempts: new Map(),
  schedules: new Map(),
  verifications: new Map(),
  orderSequence: 0,
  outbox: [],
  sequences: new Map(),
  flowVersion: 1,
  flowUpdated: false,
};

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/** Test seam: wipes the world between vitest cases. */
export function resetReviewFixture(): void {
  world.drafts.clear();
  world.runs.clear();
  world.tasks.clear();
  world.findings.clear();
  world.evidence.clear();
  world.orders.clear();
  world.orderTimeline.clear();
  world.orderComments.clear();
  world.attempts.clear();
  world.schedules.clear();
  world.verifications.clear();
  world.orderSequence = 0;
  world.outbox.length = 0;
  world.sequences.clear();
  world.flowVersion = 1;
  world.flowUpdated = false;
}

/** Test seam: seeds a persisted order with an explicit aggregate state so
 * order-page tests can stage states the happy path cannot reach (running,
 * result_unknown) without a real execution engine behind the mock. */
export function seedFixtureOrder(order: FixtureOrder): void {
  world.orders.set(order.id, order);
  world.orderSequence = Math.max(world.orderSequence, orderNumberSuffix(order.display_number));
  world.orderTimeline.set(order.id, []);
  world.orderComments.set(order.id, []);
}

function orderNumberSuffix(displayNumber: string): number {
  const suffix = displayNumber.split("-").at(-1) ?? "0";
  return Number(suffix);
}

function successEnvelope(data: DefaultBodyType) {
  return { err_code: 0, message: "ok", data, request_id: MOCK_REQUEST_ID };
}

function businessError(errCode: number, message: string) {
  return HttpResponse.json({
    err_code: errCode,
    message,
    data: null,
    request_id: MOCK_REQUEST_ID,
    retryable: false,
  });
}

function pageOf<T>(items: T[], limit: number | null, after: string | null) {
  // A cursor that no longer resolves (expired/deleted boundary) yields an
  // empty page — silently re-serving the first page would mask duplicate
  // rows behind a stale cursor.
  const start =
    after === null
      ? 0
      : (() => {
          const index = items.findIndex((item) => (item as { id: string }).id === after);
          return index === -1 ? items.length : index + 1;
        })();
  const window = items.slice(start);
  const slice = limit === null ? window : window.slice(0, limit);
  const last = slice.at(-1) as { id: string } | undefined;
  const hasMore = start + slice.length < items.length;
  return {
    items: slice,
    page: { next_cursor: hasMore && last ? last.id : null, has_more: hasMore },
  };
}

function emit(
  subject: string,
  type: string,
  data: Record<string, unknown>,
  actor: { kind: "user" | "system" | "worker"; user_id?: string | null } = { kind: "worker" },
): void {
  const sequence = (world.sequences.get(subject) ?? 0) + 1;
  world.sequences.set(subject, sequence);
  world.outbox.push({
    subject,
    sequence,
    payload: {
      specversion: "1.0",
      id: uuid(),
      type,
      source: "yearning://control-plane",
      subject,
      time: now(),
      datacontenttype: "application/json",
      sequence,
      causation_id: null,
      actor,
      data,
    },
  });
}

/** Optimistic concurrency: the client must echo the revision it knows via
 * If-Match ("N"). The code a mismatch answers is decided per operation's
 * error profile, not here: draft_update and draft_review declare both codes
 * and answer 1003, draft_submit is C1004-only and answers 1004. */
function revisionConflict(request: Request, draft: FixtureDraft): boolean {
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch === null) return false;
  return ifMatch !== `"${String(draft.revision)}"`;
}

function draftPublic(draft: FixtureDraft) {
  return {
    id: draft.id,
    owner_user_id: draft.owner_user_id,
    flow_id: draft.flow_id,
    title: draft.title,
    description: draft.description,
    revision: draft.revision,
    state: draft.state,
    has_sql: draft.has_sql,
    sql_size_bytes: draft.sql_size_bytes,
    statement_count: draft.statement_count,
    review_run_id: draft.review_run_id,
    version: draft.version,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

function runPublic(run: FixtureRun) {
  return {
    id: run.id,
    draft_id: run.draft_id,
    draft_revision: run.draft_revision,
    state: run.state,
    statement_count: run.statement_count,
    fingerprint_group_count: run.fingerprint_group_count,
    stage_results: run.stage_results,
    gate: run.gate,
    failure_code: run.failure_code,
    version: run.version,
    created_at: run.created_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

/**
 * Schema-conformant User for OrderStage.execution_actors ($ref User in the
 * OpenAPI). FlowStageWrite uses ActorRef ({user_id}) — that shape stays on
 * the flows endpoint; only the order stage surface needs full users.
 */
function fixtureUser(userId: string) {
  const now = "2026-08-01T00:00:00Z";
  return {
    id: userId,
    username: "henry",
    display_name: "henry",
    email: null,
    is_builtin_admin: true,
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

/** Frozen approval-step actor snapshot (backend ActorView: id/username/
 * display_name) — the order surface freezes display names, unlike the flow
 * stage ActorRef ({user_id}) wire shape. */
function fixtureActor(userId: string) {
  return { id: userId, username: "henry", display_name: "henry" };
}

function orderPublic(order: FixtureOrder) {
  return {
    id: order.id,
    display_number: order.display_number,
    submitter_user_id: order.submitter_user_id,
    title: order.title,
    state: order.state,
    current_stage_position: order.current_stage_position,
    stages: order.stages,
    has_sql: order.has_sql,
    sql_hash: order.sql_hash,
    snapshot_hash: order.snapshot_hash,
    manually_verified: order.manually_verified,
    version: order.version,
    submitted_at: order.submitted_at,
    terminal_at: order.terminal_at,
  };
}

/** Appends a timeline entry for an order lifecycle fact; the timeline is the
 * audit projection of the same facts the outbox publishes as events. */
function recordOrderEvent(
  order: FixtureOrder,
  eventType: string,
  actorKind: "user" | "system" | "worker",
  actorUserId: string | null,
  summary: string,
  stagePosition: number | null,
  state: string | null,
): void {
  const entries = world.orderTimeline.get(order.id) ?? [];
  entries.push({
    id: uuid(),
    event_type: eventType,
    occurred_at: now(),
    actor_kind: actorKind,
    actor_user_id: actorUserId,
    actor_display_name: actorUserId === null ? null : "henry",
    summary,
    stage_position: stagePosition,
    state,
  });
  world.orderTimeline.set(order.id, entries);
}

/**
 * Scenario "order-partial-execution" (FE-F6 acceptance gate 部分执行后撤回明
 * 确提示不可回滚): seeds one running order — a state the happy mock path
 * cannot reach without a real execution engine — so the E2E can drive the
 * withdraw_after_partial_fact transition end to end.
 */
function seedPartialExecutionOrder(): void {
  if (readStoredScenario() !== "order-partial-execution" || world.orders.size > 0) return;
  const submittedAt = now();
  const order: FixtureOrder = {
    id: "7e6f1a2b-0000-4000-8000-00000000f601",
    display_number: "YR-20260829-000042",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "跨阶段存量数据订正（场景）",
    state: "running",
    current_stage_position: 2,
    stages: [
      {
        id: "7e6f1a2b-0000-4000-8000-00000000f611",
        position: 1,
        datasource_name: "staging-mysql",
        state: "succeeded",
        approval_steps: [
          {
            id: "7e6f1a2b-0000-4000-8000-00000000f621",
            position: 1,
            state: "approved",
            decided_at: submittedAt,
            actors: [fixtureActor(FIXTURE_OWNER_ID)],
          },
        ],
        execution_actors: [fixtureUser(FIXTURE_OWNER_ID)],
      },
      {
        id: "7e6f1a2b-0000-4000-8000-00000000f612",
        position: 2,
        datasource_name: "prod-mysql",
        state: "running",
        approval_steps: [
          {
            id: "7e6f1a2b-0000-4000-8000-00000000f622",
            position: 1,
            state: "approved",
            decided_at: submittedAt,
            actors: [fixtureActor(FIXTURE_OWNER_ID)],
          },
        ],
        execution_actors: [fixtureUser(FIXTURE_OWNER_ID)],
      },
    ],
    has_sql: true,
    sql_hash: "hash-seed-42",
    snapshot_hash: "snap-seed-42",
    manually_verified: false,
    version: 3,
    submitted_at: submittedAt,
    terminal_at: null,
    review_run_id: null,
    sql_text: "UPDATE prod_orders SET status = 1 WHERE created_at < '2026-01-01';",
  };
  world.orders.set(order.id, order);
  world.orderSequence = Math.max(world.orderSequence, 42);
  recordOrderEvent(order, "change_order.submitted", "user", order.submitter_user_id, "工单提交，审核快照已冻结（阶段 1）", 1, "submitted");
  recordOrderEvent(order, "stage.execution_succeeded", "worker", null, "阶段 1（staging-mysql）执行成功", 1, "succeeded");
  recordOrderEvent(order, "stage.execution_started", "worker", null, "阶段 2（prod-mysql）开始执行", 2, "running");
}

// ---- Execution domain (FE-F8) ---------------------------------------------
//
// The mock mirrors the backend execution application (B10): begin is only
// legal from stage_execution_pending for a frozen executor (W006), a prior
// attempt that crossed the send boundary forever forbids retry (3004, E004),
// DML failure terminates the order while DDL preserves prior successes as
// partial_failed (E001/E002), result_unknown blocks everything until a frozen
// executor records a manual verification (E005), and deferred schedules are
// created by the executor and run by the scheduler — never auto-catching up
// (E007). Attempt-level facts are reachable only through the attempt the
// client created (creation response) — the contract has no list-attempts
// read, and events ride the order subject like the backend's emitOrderEvent.

const ATTEMPT_CREATED_TO_PREFLIGHT_MS = 300;
const ATTEMPT_PREFLIGHT_TO_RUNNING_MS = 500;
const ATTEMPT_RUNNING_TO_TERMINAL_MS = 900;
const CANCEL_RESOLUTION_MS = 600;

/** Deterministic attempt shape the active scenario runs toward. */
function executionBehavior(): {
  kind: FixtureExecutionAttempt["execution_kind"];
  outcome: FixtureExecutionAttempt["outcome"];
  statementCount: number;
} {
  switch (readStoredScenario()) {
    case "execution-partial":
      return { kind: "ddl", outcome: "partial_failed", statementCount: 3 };
    case "execution-unknown":
      return { kind: "dml", outcome: "result_unknown", statementCount: 2 };
    case "execution-ghost":
      return { kind: "gh_ost", outcome: "ghost", statementCount: 1 };
    default:
      return { kind: "dml", outcome: "succeeded", statementCount: 2 };
  }
}

/** Terminal attempt states (backend domain.AttemptState.Terminal): a
 * cancellation on a terminal attempt answers idempotently with the view. */
function isAttemptTerminal(state: FixtureExecutionAttempt["state"]): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "partial_failed" ||
    state === "cancelled" ||
    state === "partial_cancelled" ||
    state === "result_unknown"
  );
}

function attemptPublic(attempt: FixtureExecutionAttempt) {
  return {
    id: attempt.id,
    stage_id: attempt.stage_id,
    execution_kind: attempt.execution_kind,
    state: attempt.state,
    send_boundary: attempt.send_boundary,
    osc: attempt.osc,
    version: attempt.version,
    created_at: attempt.created_at,
  };
}

function statementPublic(statement: FixtureStatement) {
  return {
    id: statement.id,
    ordinal: statement.ordinal,
    statement_kind: statement.statement_kind,
    state: statement.state,
    affected_row_count: statement.affected_row_count,
    failure_name: statement.failure_name,
    started_at: statement.started_at,
    finished_at: statement.finished_at,
  };
}

function makeStatements(count: number, kind: "ddl" | "dml"): FixtureStatement[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid(),
    ordinal: index + 1,
    statement_kind: kind,
    state: "not_started",
    affected_row_count: null,
    failure_name: null,
    started_at: null,
    finished_at: null,
  }));
}

/** Emits an order-subject state_changed event for execution facts (backend
 * emitOrderEvent: the execution domain publishes on change-orders/{uuid}). */
function emitExecutionState(
  order: FixtureOrder,
  from: string | null,
  reasonCode: string,
  stageId: string,
  actor: { kind: "user" | "system" | "worker"; user_id?: string | null } = { kind: "worker" },
): void {
  emit(
    `change-orders/${order.id}`,
    "io.yearning.v4.execution.state_changed",
    {
      aggregate_id: order.id,
      from,
      to: order.state,
      reason_code: reasonCode,
      stage_id: stageId,
      aggregate_version: order.version,
    },
    actor,
  );
}

/** Applies the attempt's terminal facts to statements, stage, order and the
 * audit timeline; every transition emits the order-subject event the UI
 * consumes (events are notifications — the client re-reads HTTP resources). */
function applyAttemptTerminal(order: FixtureOrder, attempt: FixtureExecutionAttempt): void {
  const stage = order.stages.find((candidate) => candidate.id === attempt.stage_id);
  if (stage === undefined) return;
  const nowAt = now();
  switch (attempt.outcome) {
    case "succeeded": {
      attempt.send_boundary = "sent";
      for (const statement of attempt.statements) {
        if (statement.state !== "sent") continue;
        statement.state = "succeeded";
        statement.affected_row_count = statement.ordinal === 1 ? 1 : 42;
        statement.started_at = nowAt;
        statement.finished_at = nowAt;
      }
      attempt.state = "succeeded";
      attempt.version += 1;
      stage.state = "succeeded";
      order.state = "completed";
      order.terminal_at = nowAt;
      order.version += 1;
      recordOrderEvent(order, "stage.execution_succeeded", "worker", null, `阶段 ${String(stage.position)}（${stage.datasource_name}）执行成功`, stage.position, "succeeded");
      recordOrderEvent(order, "change_order.completed", "system", null, "全部阶段执行完成", stage.position, "completed");
      emitExecutionState(order, "running", "execution_succeeded", stage.id);
      break;
    }
    case "partial_failed": {
      attempt.send_boundary = "sent";
      for (const statement of attempt.statements) {
        if (statement.state !== "sent") continue;
        if (statement.ordinal === 2) {
          statement.state = "failed";
          statement.failure_name = "lock_wait_timeout";
          statement.started_at = nowAt;
          statement.finished_at = nowAt;
        } else if (statement.ordinal < 2) {
          statement.state = "succeeded";
          statement.affected_row_count = 0;
          statement.started_at = nowAt;
          statement.finished_at = nowAt;
        } else {
          // Non-transactional DDL: the suffix after the first failure never
          // ran — skipped, never rendered as executed or unknown (E002).
          statement.state = "skipped";
        }
      }
      attempt.state = "partial_failed";
      attempt.version += 1;
      stage.state = "partial_failed";
      order.state = "partial_failed";
      order.terminal_at = nowAt;
      order.version += 1;
      recordOrderEvent(order, "stage.execution_partial_failed", "worker", null, `阶段 ${String(stage.position)}（${stage.datasource_name}）DDL 第 2 条失败，后续语句未执行`, stage.position, "partial_failed");
      recordOrderEvent(order, "change_order.partial_failed", "system", null, "DDL 部分成功，工单终止；原工单禁止重试", stage.position, "partial_failed");
      emitExecutionState(order, "running", "ddl_partial_failed", stage.id);
      break;
    }
    case "result_unknown": {
      attempt.send_boundary = "sent";
      for (const statement of attempt.statements) {
        if (statement.state !== "sent") continue;
        if (statement.ordinal === 1) {
          statement.state = "succeeded";
          statement.affected_row_count = 5;
          statement.started_at = nowAt;
          statement.finished_at = nowAt;
        } else {
          // Sent, database answer lost (network/进程中断): unknown is a
          // distinct high-risk state, never displayed as not-executed (E005).
          statement.state = "unknown";
          statement.started_at = nowAt;
        }
      }
      attempt.state = "result_unknown";
      attempt.version += 1;
      stage.state = "result_unknown";
      order.state = "result_unknown";
      order.version += 1;
      recordOrderEvent(order, "stage.execution_result_unknown", "worker", null, `阶段 ${String(stage.position)}（${stage.datasource_name}）执行结果未知，等待人工核验`, stage.position, "result_unknown");
      emitExecutionState(order, "running", "result_became_unknown", stage.id);
      break;
    }
    case "ghost": {
      // gh-ost keeps copying until someone cancels — the residual/cleanup
      // surface only exists after a cancel (E006). Progress ticks once so
      // the UI has deterministic numbers to show.
      attempt.send_boundary = "sent";
      if (attempt.osc !== null) {
        attempt.osc.progress_basis_points = 6500;
        attempt.osc.rows_copied = 84210;
        attempt.osc.last_heartbeat_at = nowAt;
      }
      break;
    }
  }
}

/** Drives a created attempt through preflight → running → terminal with the
 * same deterministic timers the review-run progression uses. */
function advanceAttempt(order: FixtureOrder, attempt: FixtureExecutionAttempt): void {
  setTimeout(() => {
    attempt.state = "preflight";
    attempt.version += 1;
    setTimeout(() => {
      attempt.state = "running";
      attempt.send_boundary = "sending";
      attempt.version += 1;
      if (attempt.osc !== null) {
        attempt.osc.phase = "copying";
        attempt.osc.progress_basis_points = 2000;
      }
      for (const statement of attempt.statements) {
        if (statement.state === "not_started" && attempt.outcome !== "ghost") {
          statement.state = "sent";
        }
      }
      if (attempt.outcome === "ghost") {
        return; // runs until cancelled
      }
      setTimeout(() => {
        applyAttemptTerminal(order, attempt);
      }, ATTEMPT_RUNNING_TO_TERMINAL_MS);
    }, ATTEMPT_PREFLIGHT_TO_RUNNING_MS);
  }, ATTEMPT_CREATED_TO_PREFLIGHT_MS);
}

/** Resolves a cancellation: DML rolls the stage back (order cancelled); DDL
 * preserves prior successes as partial_cancelled; gh-ost surfaces leftover
 * resources for cleanup (E006). Mirrors backend record.go fact collection —
 * and its silence: the routing table has no execution-cancel event, so the
 * backend publishes no domain event (and keeps no timeline row) for a
 * settled cancellation; clients converge through the read surface. */
function resolveCancellation(order: FixtureOrder, attempt: FixtureExecutionAttempt): void {
  const stage = order.stages.find((candidate) => candidate.id === attempt.stage_id);
  if (stage === undefined) return;
  const nowAt = now();
  const hadSuccess = attempt.statements.some((statement) => statement.state === "succeeded");
  for (const statement of attempt.statements) {
    if (statement.state === "sent") {
      statement.state = "cancelled";
      statement.finished_at = nowAt;
    } else if (statement.state === "not_started") {
      statement.state = "skipped";
    }
  }
  attempt.state = hadSuccess ? "partial_cancelled" : "cancelled";
  attempt.send_boundary = "sent";
  attempt.version += 1;
  if (attempt.osc !== null) {
    attempt.osc.phase = "cancelled";
    attempt.osc.residual_state = "cleanup_required";
    attempt.osc.last_heartbeat_at = nowAt;
  }
  stage.state = attempt.state;
  order.state = attempt.state;
  order.terminal_at = nowAt;
  order.version += 1;
}

/**
 * Seeds one pre-approved order per execution scenario so E2E can drive the
 * executor surfaces without walking the approval flow (states the happy path
 * reaches only after a full approval round). The seeded stage is
 * execution_pending with the shared fixture user as its frozen executor —
 * the same identity the mock session authenticates (W006).
 */
function seedExecutionScenarioOrder(): void {
  const scenario = readStoredScenario();
  if (
    scenario !== "execution-partial" &&
    scenario !== "execution-unknown" &&
    scenario !== "execution-ghost" &&
    scenario !== "execution-preflight" &&
    scenario !== "schedule-missed"
  ) {
    return;
  }
  if (world.orders.size > 0) return;
  const submittedAt = now();
  const sqlByScenario: Record<string, string> = {
    "execution-partial":
      "ALTER TABLE orders ADD COLUMN note varchar(255); ALTER TABLE orders MODIFY COLUMN note text; CREATE INDEX idx_note ON orders (note);",
    "execution-unknown":
      "UPDATE orders SET status = 1 WHERE created_at < '2026-01-01'; UPDATE orders SET priority = 2 WHERE status = 1;",
    "execution-ghost": "ALTER TABLE orders ADD COLUMN note varchar(255);",
    "execution-preflight":
      "UPDATE orders SET status = 1 WHERE user_id = 42; UPDATE orders SET status = 2 WHERE user_id = 43;",
    "schedule-missed":
      "UPDATE archive_rows SET archived = 1 WHERE created_at < '2025-06-01';",
  };
  const isMissed = scenario === "schedule-missed";
  const order: FixtureOrder = {
    id: "7e6f1a2b-0000-4000-8000-00000000f801",
    display_number: "YR-20260830-000101",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "执行域场景工单",
    // schedule-missed arrives already terminal: the scheduler missed the due
    // claim and never catches up (E007); every other scenario waits for the
    // executor's click.
    state: isMissed ? "missed_schedule" : "stage_execution_pending",
    current_stage_position: 1,
    stages: [
      {
        id: "7e6f1a2b-0000-4000-8000-00000000f811",
        position: 1,
        datasource_name: "orders-mysql",
        state: isMissed ? "cancelled" : "execution_pending",
        approval_steps: [
          {
            id: "7e6f1a2b-0000-4000-8000-00000000f821",
            position: 1,
            state: "approved",
            decided_at: submittedAt,
            actors: [fixtureActor(FIXTURE_OWNER_ID)],
          },
        ],
        execution_actors: [fixtureUser(FIXTURE_OWNER_ID)],
      },
    ],
    has_sql: true,
    sql_hash: `hash-exec-${scenario}`,
    snapshot_hash: "snap-exec-1",
    manually_verified: false,
    version: isMissed ? 3 : 2,
    submitted_at: submittedAt,
    terminal_at: isMissed ? submittedAt : null,
    review_run_id: null,
    sql_text: sqlByScenario[scenario] ?? "",
  };
  world.orders.set(order.id, order);
  world.orderSequence = Math.max(world.orderSequence, 101);
  world.orderTimeline.set(order.id, []);
  world.orderComments.set(order.id, []);
  recordOrderEvent(order, "change_order.submitted", "user", order.submitter_user_id, "工单提交，审核快照已冻结（阶段 1）", 1, "submitted");
  recordOrderEvent(order, "change_order.stage_ready_for_execution", "system", null, "阶段 1 终步通过，工单等待执行", 1, "stage_execution_pending");
  if (isMissed) {
    const schedule: FixtureSchedule = {
      id: "7e6f1a2b-0000-4000-8000-00000000f831",
      order_id: order.id,
      stage_id: "7e6f1a2b-0000-4000-8000-00000000f811",
      scheduled_for: submittedAt,
      state: "missed",
      version: 2,
    };
    world.schedules.set(schedule.id, schedule);
    recordOrderEvent(order, "schedule.missed", "system", null, "预约到点未被领取，超过宽限已错过（不自动补跑）", 1, "missed_schedule");
  }
}

/** The live schedule row for an order, when the executor created one. */
function liveScheduleFor(orderId: string): FixtureSchedule | undefined {
  return [...world.schedules.values()].find(
    (schedule) => schedule.order_id === orderId && schedule.state === "scheduled",
  );
}

/** Terminal run shape per requested behavior — the deterministic fixture
 * outcome for one stage flows. */
function terminalRunShape(behavior: ReviewBehavior, run: FixtureRun): void {
  const collectedAt = now();
  const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const evidenceId = `${run.id.slice(0, 30)}e1`;
  const findingId = `${run.id.slice(0, 30)}f1`;
  const criticalFindingId = `${run.id.slice(0, 30)}f2`;
  world.evidence.set(evidenceId, {
    id: evidenceId,
    source_kind: "tool_call",
    source_reference: "built-in:mysql.table_stats",
    fact_status: "known",
    normalized_fact: {
      object_type: "table",
      object_name: "orders",
      row_estimate: 128400,
      index_present: true,
      collected_by: "built-in read-only tool",
    },
    has_raw_payload: true,
    raw_payload_expires_at: expiry,
    collected_at: collectedAt,
  });

  const setStage = (
    state: FixtureStageResult["state"],
    highest: FixtureStageResult["highest_severity"],
    gatePassed: boolean,
    findings: FixtureFinding[],
  ) => {
    run.stage_results = [
      {
        stage_position: 1,
        datasource_id: FIXTURE_DATASOURCE_ID,
        state,
        highest_severity: highest,
        gate_passed: gatePassed,
        finding_count: findings.length,
        evidence_count: 1,
        snapshot_hash: `snap-${run.id.slice(0, 8)}-${state}`,
      },
    ];
    world.findings.set(run.id, findings);
  };

  const mediumFinding: FixtureFinding = {
    id: findingId,
    stage_position: 1,
    fingerprint_group_id: null,
    category: "performance",
    severity: "medium",
    title: "查询未使用索引过滤",
    message:
      "语句 `UPDATE orders SET status = 1 WHERE user_id = 42` 的 WHERE 条件无法命中现有索引，预估扫描 128400 行。",
    suggestion: "为 orders.user_id 建立索引，或收窄 WHERE 条件后重试。",
    model_confidence: 0.86,
    evidence_ids: [evidenceId],
  };

  const highFinding: FixtureFinding = {
    id: `${findingId}h`,
    stage_position: 1,
    fingerprint_group_id: null,
    category: "security",
    severity: "high",
    title: "无 WHERE 条件的批量 UPDATE",
    message: "检测到缺少 WHERE 条件的 UPDATE，将影响全表所有行。",
    suggestion: "补充明确的 WHERE 条件并分批执行。",
    model_confidence: 0.94,
    evidence_ids: [evidenceId],
  };

  const criticalFinding: FixtureFinding = {
    id: criticalFindingId,
    stage_position: 1,
    fingerprint_group_id: null,
    category: "security",
    severity: "critical",
    title: "DROP TABLE 高危操作",
    message: "语句包含 DROP TABLE，属于不可自动回滚的破坏性操作。",
    suggestion: "确认是否确需删除整表；如需保留结构请改用 TRUNCATE 并单独评估。",
    model_confidence: 0.97,
    evidence_ids: [evidenceId],
  };

  /**
   * Bulk anomaly findings (frontend PRD F5: 异常语句必须单独列出，不能被聚
   * 合掩盖). Derived from the run's local digest for bulk drafts only: each
   * anomalous shape group (no-WHERE DML, oversized statement) becomes a high
   * finding bound to a deterministic fingerprint group id and referencing
   * the statement ordinal so the workspace can jump to it.
   */
  const bulkAnomalyFindings = (): FixtureFinding[] => {
    const digest = run.digest;
    if (digest === undefined || digest.statementCount < BULK_MODE_MIN_STATEMENTS) return [];
    const groups = digest.groups.filter((group) => group.anomalyCount > 0).slice(0, 5);
    return groups.map((group, offset) => {
      const sample = digest.statements.find(
        (statement) => statement.group === group.ordinal && statement.anomaly,
      );
      const oversized = sample?.oversized ?? false;
      const sampleIndex = String(sample?.index ?? group.firstIndex);
      // OpenAPI types ReviewFinding.id/fingerprint_group_id as UUID — keep
      // fixture identifiers inside the 8-4-4-4-12 hex shape.
      const groupId = `${run.id.slice(0, 8)}-a000-4000-8000-${String(group.ordinal).padStart(12, "0")}`;
      const findingUuid = `${run.id.slice(0, 8)}-b000-4000-8000-${String(offset).padStart(12, "0")}`;
      return {
        id: findingUuid,
        stage_position: 1,
        fingerprint_group_id: groupId,
        category: oversized ? "operability" : "correctness",
        severity: "high",
        title: oversized ? "单条语句超过尺寸上限" : "无 WHERE 条件的批量 DML",
        message: oversized
          ? `语句 \`#${sampleIndex}\` 超过单语句 ${String(FINGERPRINT_MAX_STATEMENT_BYTES)} 字节上限，无法安全指纹化。`
          : `指纹组 #${String(group.ordinal + 1)}（${String(group.count)} 条）缺少 WHERE 条件，将影响全表；定位语句 \`#${sampleIndex}\`。`,
        suggestion: oversized
          ? "拆分该语句或压缩单条尺寸后重新导入。"
          : "补充明确的 WHERE 条件并分批执行。",
        model_confidence: null,
        evidence_ids: [],
      };
    });
  };

  // Contract fail-closed (sql-fingerprint.json max_unique_fingerprints): a
  // draft above the unique-fingerprint ceiling cannot be fingerprinted into
  // a reviewable set — the run fails with fingerprint_failed instead of
  // reporting a clamped group count.
  const fingerprintOverflow = (run.digest?.groupCount ?? 0) > FINGERPRINT_MAX_UNIQUE;

  switch (behavior) {
    case "ready": {
      const anomalies = bulkAnomalyFindings();
      if (fingerprintOverflow) {
        run.state = "failed";
        run.gate = { passed: false, reason_codes: ["stage_review_failed"] };
        run.failure_code = "fingerprint_failed";
        run.finished_at = now();
        setStage("failed", "none", false, []);
        break;
      }
      if (anomalies.length > 0) {
        // A high-severity anomaly blocks the gate — the aggregate-ready bulk
        // draft must not hide it (acceptance gate 单条异常不被聚合隐藏).
        run.state = "blocked";
        run.gate = { passed: false, reason_codes: ["high_severity_finding"] };
        run.finished_at = now();
        setStage("blocked", "high", false, [...anomalies, mediumFinding]);
        break;
      }
      run.state = "ready";
      run.gate = { passed: true, reason_codes: [] };
      run.finished_at = now();
      setStage("passed", "medium", true, [mediumFinding]);
      break;
    }
    case "blocked": {
      run.state = "blocked";
      run.gate = { passed: false, reason_codes: ["stage_review_blocked", "critical_severity_finding"] };
      run.finished_at = now();
      setStage("blocked", "critical", false, [...bulkAnomalyFindings(), highFinding, criticalFinding]);
      break;
    }
    case "partial": {
      run.state = "partial";
      run.gate = { passed: false, reason_codes: ["stage_review_incomplete"] };
      run.failure_code = "budget_exhausted";
      run.finished_at = now();
      setStage("partial", "medium", false, [...bulkAnomalyFindings(), mediumFinding]);
      break;
    }
    case "provider_failed": {
      run.state = "failed";
      run.gate = { passed: false, reason_codes: ["stage_review_failed"] };
      run.failure_code = "provider_unavailable";
      run.finished_at = now();
      setStage("failed", "none", false, []);
      break;
    }
  }
}

function advanceRun(draft: FixtureDraft, run: FixtureRun, task: FixtureTask): void {
  const behavior = currentBehavior();
  setTimeout(() => {
    run.state = "running";
    run.started_at = now();
    run.version += 1;
    task.state = "running";
    task.updated_at = now();
    setTimeout(() => {
      terminalRunShape(behavior, run);
      run.version += 1;
      // The run freezes its inputs at draft_revision; if the draft moved on
      // while the run was in flight, the terminal result is born outdated
      // instead of overriding the newer inputs (state-machines.json
      // change_draft: only a current-revision run may end ready).
      if (
        run.state === "ready" ||
        run.state === "blocked" ||
        run.state === "partial" ||
        run.state === "failed"
      ) {
        if (run.draft_revision === draft.revision) {
          draft.state = run.state;
        } else if (draft.state !== "outdated") {
          draft.state = "outdated";
        }
      }
      draft.version += 1;
      draft.updated_at = now();
      task.state = behavior === "provider_failed" ? "failed" : "succeeded";
      task.updated_at = now();

      const reviewData = {
        review_run_id: run.id,
        draft_id: draft.id,
        draft_revision: run.draft_revision,
        state: run.state,
        stage_results: run.stage_results.map((stage) => ({
          stage_position: stage.stage_position,
          state: stage.state,
          highest_severity: stage.highest_severity,
          finding_count: stage.finding_count,
          evidence_count: stage.evidence_count,
          snapshot_hash: stage.snapshot_hash,
        })),
        gate: run.gate,
        statement_count: run.statement_count,
        fingerprint_group_count: run.fingerprint_group_count,
        aggregate_version: run.version,
      };
      const runSubject = `review-runs/${run.id}`;
      emit(runSubject, run.state === "ready" ? "io.yearning.v4.review.completed" : "io.yearning.v4.review.blocked", reviewData);
      emit(
        `change-drafts/${draft.id}`,
        "io.yearning.v4.change_draft.state_changed",
        {
          aggregate_id: draft.id,
          from: "reviewing",
          to: draft.state,
          reason_code:
            draft.state === "ready"
              ? "precheck_passed"
              : draft.state === "blocked"
                ? "precheck_blocked"
                : draft.state === "partial"
                  ? "precheck_partial"
                  : "precheck_failed",
          aggregate_version: draft.version,
        },
        { kind: "system" },
      );
    }, RUNNING_TO_TERMINAL_MS);
  }, QUEUED_TO_RUNNING_MS);
}

export function reviewFixtureHandlers(): HttpHandler[] {
  return [
    // Flow catalog for submitters (flow selection cards). Zero-permission
    // contract (auth PRD §11): the default session owns no flow grants, so
    // both flow-type queries come back as empty cursor pages and the user
    // sees the waiting state; an admin session carries the change flow.
    // The query_access branch is served from the query fixture world
    // (FE-F10): single route ownership, shared auth behavior dimension.
    http.get("*/users/me/flows", ({ request }) => {
      const flowType = new URL(request.url).searchParams.get("flow_type");
      const behavior = readStoredAuthBehavior();
      if (flowType === "query_access") {
        // Session presence follows the shared behavior-dimension convention
        // (jsdom fetches carry no cookies; see admin-fixture adminGuard).
        return HttpResponse.json(
          successEnvelope(pageOf(queryFlowsCatalogPage(behavior !== "expired", behavior).items as unknown[], null, null)),
        );
      }
      if (flowType !== "change_review" || behavior !== "admin") {
        return HttpResponse.json(successEnvelope(pageOf([], null, null)));
      }
      const flow = {
        id: FIXTURE_FLOW_ID,
        name: "默认审核流程",
        flow_type: "change_review",
        enabled: true,
        rule_set_id: null,
        stages: [
          {
            position: 1,
            datasource_id: FIXTURE_DATASOURCE_ID,
            schema_mappings: [{ logical_schema: "app", physical_schema: "app" }],
            approval_steps: [
              { position: 1, actors: [{ user_id: FIXTURE_OWNER_ID }] },
            ],
            execution_actors: [{ user_id: FIXTURE_OWNER_ID }],
          },
        ],
        approval_steps: undefined,
        query_capabilities: undefined,
        version: world.flowVersion,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      };
      return HttpResponse.json(successEnvelope(pageOf([flow], null, null)));
    }),

    http.post("*/change-drafts", async ({ request }) => {
      const body = (await request.json()) as {
        flow_id: string;
        title: string;
        description?: string;
      };
      if (body.flow_id !== FIXTURE_FLOW_ID) {
        return businessError(2014, "flow not granted to the current user");
      }
      if (body.title.trim() === "") {
        return businessError(1001, "title is required");
      }
      const draft: FixtureDraft = {
        id: uuid(),
        owner_user_id: FIXTURE_OWNER_ID,
        flow_id: body.flow_id,
        title: body.title,
        description: body.description ?? null,
        revision: 1,
        state: "draft",
        has_sql: false,
        sql: null,
        sql_size_bytes: null,
        statement_count: null,
        review_run_id: null,
        version: 1,
        created_at: now(),
        updated_at: now(),
      };
      world.drafts.set(draft.id, draft);
      return HttpResponse.json(successEnvelope(draftPublic(draft)));
    }),

    http.get("*/change-drafts", ({ request }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const drafts = [...world.drafts.values()]
        .filter((draft) => draft.owner_user_id === FIXTURE_OWNER_ID)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return HttpResponse.json(successEnvelope(pageOf(drafts.map(draftPublic), limit, after)));
    }),

    http.get("*/change-drafts/:draftId", ({ params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      return HttpResponse.json(successEnvelope(draftPublic(draft)));
    }),

    http.patch("*/change-drafts/:draftId", async ({ request, params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      const body = (await request.json()) as { title?: string; description?: string };
      if (typeof body.title === "string") draft.title = body.title;
      if (typeof body.description === "string") draft.description = body.description;
      draft.version += 1;
      draft.updated_at = now();
      return HttpResponse.json(successEnvelope(draftPublic(draft)));
    }),

    http.delete("*/change-drafts/:draftId", ({ params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      if (draft.state === "submitted") return businessError(1010, "submitted draft cannot be deleted");
      world.drafts.delete(draft.id);
      return HttpResponse.json(successEnvelope(null));
    }),

    http.put("*/change-drafts/:draftId/sql", async ({ request, params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      if (revisionConflict(request, draft)) {
        return businessError(1003, "draft revision changed elsewhere");
      }
      const body = (await request.json()) as { sql: string };
      draft.sql = body.sql;
      draft.has_sql = body.sql.trim().length > 0;
      draft.sql_size_bytes = new TextEncoder().encode(body.sql).length;
      // Quote-aware statement count via the shared local digest scanner —
      // semicolons inside strings/quoted identifiers/comments do not split.
      draft.statement_count = digestSqlText(body.sql).statementCount;
      draft.revision += 1;
      draft.version += 1;
      draft.updated_at = now();
      const wasReady = draft.state === "ready";
      if (draft.state === "ready") draft.state = "outdated";
      if (wasReady) {
        emit(
          `change-drafts/${draft.id}`,
          "io.yearning.v4.change_draft.state_changed",
          {
            aggregate_id: draft.id,
            from: "ready",
            to: "outdated",
            reason_code: "review_inputs_changed",
            aggregate_version: draft.version,
          },
          { kind: "system" },
        );
      }
      return HttpResponse.json(successEnvelope(draftPublic(draft)));
    }),

    http.post("*/change-drafts/:draftId/sql-reveals", ({ params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      if (draft.owner_user_id !== FIXTURE_OWNER_ID) {
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "forbidden",
            status: 403,
            detail: "only the draft owner may reveal the SQL",
            request_id: MOCK_REQUEST_ID,
          },
          { status: 403, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      return HttpResponse.json(
        successEnvelope({
          reveal_id: uuid(),
          sql: draft.sql ?? `${FIXTURE_SQL_MARKER} SELECT 1`,
          watermark: `henry · ${now()} · draft:${draft.id}`,
          valid_until: new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        }),
      );
    }),

    http.post("*/change-drafts/:draftId/review-runs", ({ request, params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      if (revisionConflict(request, draft)) {
        return businessError(1003, "draft revision changed elsewhere");
      }
      // state-machines.json change_draft: run_review is legal only from
      // draft/outdated/failed/partial/blocked — never from reviewing, ready
      // or submitted.
      if (draft.state === "reviewing") {
        return businessError(1010, "a review run is already in flight");
      }
      if (draft.state === "ready") {
        return businessError(1010, "the current review is still valid; edit the SQL to void it first");
      }
      if (draft.state === "submitted") return businessError(1010, "draft already submitted");
      if (!draft.has_sql) return businessError(1001, "draft has no SQL to review");

      const run: FixtureRun = {
        id: uuid(),
        draft_id: draft.id,
        draft_revision: draft.revision,
        state: "queued",
        statement_count: draft.statement_count ?? 1,
        fingerprint_group_count: 1,
        stage_results: [
          {
            stage_position: 1,
            datasource_id: FIXTURE_DATASOURCE_ID,
            state: "pending",
            highest_severity: "none",
            gate_passed: false,
            finding_count: 0,
            evidence_count: 0,
            snapshot_hash: `snap-${String(draft.revision)}`,
          },
        ],
        gate: { passed: false, reason_codes: ["stage_review_incomplete"] },
        failure_code: null,
        version: 1,
        created_at: now(),
        started_at: null,
        finished_at: null,
      };
      // Bulk runs group the draft through the same local digest scanner the
      // UI uses for navigation; the authoritative fingerprinting still
      // happens server-side, the fixture only mirrors its observable counts.
      run.digest = digestSqlText(draft.sql ?? "");
      run.statement_count = run.digest.statementCount;
      run.fingerprint_group_count = Math.min(run.digest.groupCount, FINGERPRINT_MAX_UNIQUE);
      world.runs.set(run.id, run);
      draft.review_run_id = run.id;
      draft.state = "reviewing";
      draft.version += 1;
      draft.updated_at = now();

      const task: FixtureTask = {
        id: uuid(),
        kind: "ai_review",
        state: "queued",
        progress: { completed: 0, total: 3, unit: "stages" },
        result_ref: `/review-runs/${run.id}`,
        error: null,
        created_at: now(),
        updated_at: now(),
      };
      world.tasks.set(task.id, task);
      advanceRun(draft, run, task);
      return HttpResponse.json(successEnvelope({ ...task }));
    }),

    http.post("*/change-drafts/:draftId/submission", ({ request, params }) => {
      const draft = world.drafts.get(String(params.draftId));
      if (draft === undefined) return businessError(1002, "draft not found");
      // draft_submit profile is C1004-only (no VERSION_CONFLICT): the stale
      // If-Match surfaces as concurrent modification, mirroring the backend
      // profile alignment (governance commit, FE-F7 escalation follow-up).
      if (revisionConflict(request, draft)) {
        return businessError(1004, "draft revision changed elsewhere");
      }
      const run = draft.review_run_id === null ? undefined : world.runs.get(draft.review_run_id);
      if (draft.state !== "ready" || run === undefined || run.state !== "ready" || !run.gate.passed) {
        return businessError(2013, "submission gate failed");
      }
      if (run.draft_revision !== draft.revision) {
        return businessError(2001, "review is outdated for the current draft revision");
      }
      draft.state = "submitted";
      draft.version += 1;
      draft.updated_at = now();
      const submittedAt = now();
      world.orderSequence += 1;
      // Submission freezes the order directly in stage_approval_active with
      // the first stage's first step active (backend submit.go: state
      // stage_approval, stage 1 activated, step 1 active) — the approval
      // queue therefore fills the moment an order is submitted.
      const order: FixtureOrder = {
        id: uuid(),
        display_number: `YR-20260830-${String(world.orderSequence).padStart(6, "0")}`,
        submitter_user_id: draft.owner_user_id,
        title: draft.title,
        state: "stage_approval_active",
        current_stage_position: 1,
        stages: [
          {
            id: uuid(),
            position: 1,
            datasource_name: "orders-mysql",
            state: "approval_active",
            approval_steps: [
              {
                id: uuid(),
                position: 1,
                state: "active",
                decided_at: null,
                actors: [fixtureActor(FIXTURE_OWNER_ID)],
              },
            ],
            execution_actors: [fixtureUser(FIXTURE_OWNER_ID)],
          },
        ],
        has_sql: true,
        sql_hash: `hash-${String(draft.revision)}`,
        snapshot_hash: `snap-${run.id.slice(0, 8)}`,
        manually_verified: false,
        version: 1,
        submitted_at: submittedAt,
        terminal_at: null,
        review_run_id: run.id,
        sql_text: draft.sql ?? "",
      };
      world.orders.set(order.id, order);
      world.orderComments.set(order.id, []);
      recordOrderEvent(order, "change_order.submitted", "user", draft.owner_user_id, `工单 ${order.display_number} 提交，审核快照已冻结（阶段 1）`, 1, "submitted");
      emit(
        `change-orders/${order.id}`,
        "io.yearning.v4.change_order.submitted",
        {
          aggregate_id: order.id,
          display_number: order.display_number,
          draft_id: draft.id,
          flow_id: draft.flow_id,
          aggregate_version: order.version,
        },
        { kind: "user", user_id: draft.owner_user_id },
      );
      emit(
        `change-drafts/${draft.id}`,
        "io.yearning.v4.change_draft.state_changed",
        {
          aggregate_id: draft.id,
          from: "ready",
          to: "submitted",
          reason_code: "submitted",
          aggregate_version: draft.version,
        },
        { kind: "user", user_id: draft.owner_user_id },
      );
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // ---- Change orders (FE-F6): personal order list, detail, timeline,
    // withdrawal and voidance. The list endpoint exposes exactly the OpenAPI
    // contract — cursor paging plus the RCP-20260831-ORDER-LIST-FILTER
    // params (state/q/datasource/submitted_from/submitted_to). FE-F7 widens
    // the scoping from submitter-only to the backend's relation filter
    // (submitter / frozen approval actor / frozen execution actor) so the
    // approval queue can consume the same relation-scoped read; filters only
    // narrow that result.
    http.get("*/change-orders", ({ request }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const state = url.searchParams.get("state");
      const q = url.searchParams.get("q");
      const datasource = url.searchParams.get("datasource");
      const submittedFrom = url.searchParams.get("submitted_from");
      const submittedTo = url.searchParams.get("submitted_to");
      seedPartialExecutionOrder();
      seedExecutionScenarioOrder();
      const relatedTo = (order: FixtureOrder): boolean =>
        order.submitter_user_id === FIXTURE_OWNER_ID ||
        order.stages.some(
          (stage) =>
            stage.approval_steps.some((step) => step.actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) ||
            stage.execution_actors.some((actor) => actor.id === FIXTURE_OWNER_ID),
        );
      const orders = [...world.orders.values()]
        .filter(relatedTo)
        .filter((order) => state === null || order.state === state)
        .filter((order) => {
          if (q === null || q === "") return true;
          const needle = q.toLowerCase();
          return (
            order.display_number.toLowerCase().includes(needle) ||
            order.title.toLowerCase().includes(needle)
          );
        })
        .filter((order) =>
          datasource === null ||
          datasource === "" ||
          order.stages.some((stage) => stage.datasource_name === datasource),
        )
        .filter((order) => {
          if (submittedFrom !== null && submittedFrom !== "") {
            if (order.submitted_at < `${submittedFrom}T00:00:00Z`) return false;
          }
          if (submittedTo !== null && submittedTo !== "") {
            if (order.submitted_at > `${submittedTo}T23:59:59Z`) return false;
          }
          return true;
        })
        .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
        .map(orderPublic);
      return HttpResponse.json(successEnvelope(pageOf(orders, limit, after)));
    }),

    http.get("*/change-orders/:orderId", ({ params }) => {
      seedExecutionScenarioOrder();
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // Withdrawal follows the change_order state machine: running or
    // result_unknown orders become withdrawn_after_partial_execution — prior
    // stage effects remain and nothing rolls back (W007); every other
    // withdrawable state becomes withdrawn. Illegal states answer 1010.
    http.post("*/change-orders/:orderId/withdrawal", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      if (request.headers.get("If-Match") !== `"${String(order.version)}"`) {
        return businessError(1004, "order changed elsewhere");
      }
      const outcome = withdrawOutcome(order.state);
      if (outcome === null) {
        return businessError(1010, `withdraw is not legal from state ${order.state}`);
      }
      const body = (await request.json()) as { reason: string };
      if (body.reason.trim() === "") return businessError(1001, "reason is required");
      const from = order.state;
      order.state = outcome;
      order.terminal_at = now();
      order.version += 1;
      const summary =
        outcome === "withdrawn_after_partial_execution"
          ? `提交人撤回工单（阶段 ${String(order.current_stage_position ?? 1)} 已有执行事实，变更不会自动回滚）`
          : "提交人撤回工单";
      recordOrderEvent(order, "change_order.withdrawn", "user", order.submitter_user_id, summary, order.current_stage_position, order.state);
      emit(
        `change-orders/${order.id}`,
        "io.yearning.v4.change_order.state_changed",
        {
          aggregate_id: order.id,
          from,
          to: order.state,
          reason_code: "submitter_withdrawn",
          aggregate_version: order.version,
        },
        { kind: "user", user_id: order.submitter_user_id },
      );
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // Voidance is the only path once frozen actors are missing or the result
    // is unknown; executed facts are retained (PRD §5: 作废不改变已完成的审
    // 批和执行记录).
    http.post("*/change-orders/:orderId/voidance", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      if (request.headers.get("If-Match") !== `"${String(order.version)}"`) {
        return businessError(1004, "order changed elsewhere");
      }
      if (!canVoid(order.state)) {
        return businessError(1010, `void is not legal from state ${order.state}`);
      }
      const body = (await request.json()) as { reason: string };
      if (body.reason.trim() === "") return businessError(1001, "reason is required");
      const from = order.state;
      order.state = "voided";
      order.terminal_at = now();
      order.version += 1;
      recordOrderEvent(order, "change_order.voided", "user", order.submitter_user_id, "提交人作废工单；已完成记录保留", order.current_stage_position, order.state);
      emit(
        `change-orders/${order.id}`,
        "io.yearning.v4.change_order.state_changed",
        {
          aggregate_id: order.id,
          from,
          to: order.state,
          reason_code: "submitter_voided",
          aggregate_version: order.version,
        },
        { kind: "user", user_id: order.submitter_user_id },
      );
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // Timeline is the audit projection of the order: newest first, cursor
    // paged like every list endpoint.
    http.get("*/change-orders/:orderId/timeline", ({ params, request }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const entries = [...(world.orderTimeline.get(order.id) ?? [])].reverse();
      return HttpResponse.json(successEnvelope(pageOf(entries, limit, after)));
    }),

    // 复制为新草稿 (work-order PRD §5): terminal orders restart as a fresh
    // draft on a current flow — SQL reference, title and flow only; review,
    // approvals, execution facts and the frozen instance are never copied.
    http.post("*/change-orders/:orderId/draft-copies", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const body = (await request.json()) as { target_flow_id: string; title: string; description?: string };
      if (body.target_flow_id !== FIXTURE_FLOW_ID) {
        return businessError(2014, "flow not granted to the current user");
      }
      if (body.title.trim() === "") return businessError(1001, "title is required");
      const draft: FixtureDraft = {
        id: uuid(),
        owner_user_id: FIXTURE_OWNER_ID,
        flow_id: body.target_flow_id,
        title: body.title,
        description: body.description ?? null,
        revision: 1,
        state: "draft",
        has_sql: false,
        sql: null,
        sql_size_bytes: null,
        statement_count: null,
        review_run_id: null,
        version: 1,
        created_at: now(),
        updated_at: now(),
      };
      world.drafts.set(draft.id, draft);
      return HttpResponse.json(successEnvelope(draftPublic(draft)));
    }),

    // ---- Approval decisions (FE-F7). Mirrors the backend decide command
    // (changeorder application/decide.go): same-level any-one reviewer wins
    // (W003), a non-final approve activates the next step and only bumps the
    // version, the final approve leaves the order at stage_execution_pending
    // — execution is a separate executor action, never automatic — and any
    // rejection immediately rejects the whole order (remaining steps
    // skipped, active stage cancelled). Error codes follow the
    // order_decision profile: 1004 for a lost If-Match race, 1010 outside
    // stage_approval_active, 3001 for a non-frozen actor, 3002 when the step
    // was already decided.
    http.post("*/change-orders/:orderId/approval-decisions", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      if (request.headers.get("If-Match") !== `"${String(order.version)}"`) {
        return businessError(1004, "order changed elsewhere");
      }
      const body = (await request.json()) as { decision: string; comment?: string };
      if (body.decision !== "approve" && body.decision !== "reject") {
        return businessError(1001, "decision must be approve or reject");
      }
      if (order.state !== "stage_approval_active") {
        return businessError(1010, `decision is not legal from state ${order.state}`);
      }
      const stage = order.stages.find((candidate) => candidate.state === "approval_active");
      const step = stage?.approval_steps.find((candidate) => candidate.state === "active");
      if (stage === undefined || step === undefined) {
        return businessError(1010, "no active approval step");
      }
      if (!step.actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) {
        return businessError(3001, "current user is not a frozen reviewer of this step");
      }
      if (step.decided_at !== null) {
        return businessError(3002, "approval step already decided");
      }
      // Fail-closed precondition (backend checks inside the serializable tx
      // before any effect): a non-final approve needs the next pending step.
      const maxPosition = Math.max(...stage.approval_steps.map((candidate) => candidate.position));
      const isNonFinalApprove = body.decision === "approve" && step.position < maxPosition;
      const hasNextPending =
        !isNonFinalApprove ||
        stage.approval_steps.some(
          (candidate) => candidate.position === step.position + 1 && candidate.state === "pending",
        );
      if (!hasNextPending) {
        return businessError(1004, "approval step chain broken");
      }
      const decidedAt = now();
      step.decided_at = decidedAt;
      step.state = body.decision === "approve" ? "approved" : "rejected";
      order.version += 1;
      const from = order.state;
      const decisionSummary = `审批人 henry ${body.decision === "approve" ? "通过" : "拒绝"}阶段 ${String(stage.position)} 审批步 ${String(step.position)}${
        body.comment ? `：${body.comment}` : ""
      }`;
      const decidedEmit = (): void => {
        recordOrderEvent(order, "change_order.approval_decided", "user", FIXTURE_OWNER_ID, decisionSummary, stage.position, null);
        emit(
          `change-orders/${order.id}`,
          "io.yearning.v4.change_order.approval_decided",
          {
            aggregate_id: order.id,
            stage_id: stage.id,
            step_id: step.id,
            reviewer_user_id: FIXTURE_OWNER_ID,
            decision: body.decision,
            aggregate_version: order.version,
          },
          { kind: "user", user_id: FIXTURE_OWNER_ID },
        );
      };
      if (body.decision === "approve") {
        if (isNonFinalApprove) {
          // Non-final approve: the order stays in stage_approval_active and
          // only the version records the decision.
          const next = stage.approval_steps.find(
            (candidate) => candidate.position === step.position + 1 && candidate.state === "pending",
          );
          if (next === undefined) return businessError(1004, "approval step chain broken");
          next.state = "active";
          decidedEmit();
          recordOrderEvent(order, "change_order.approval_step_activated", "system", null, `阶段 ${String(stage.position)} 审批步 ${String(next.position)} 开始审批`, stage.position, null);
        } else {
          // Final approve: stage execution_pending + order
          // stage_execution_pending — execution stays a separate executor
          // action, never automatic. Backend emits the state change before
          // the decision event here.
          stage.state = "execution_pending";
          order.state = "stage_execution_pending";
          recordOrderEvent(order, "change_order.stage_ready_for_execution", "system", null, `阶段 ${String(stage.position)} 终步通过，工单等待执行（执行需冻结执行人另点执行）`, stage.position, order.state);
          emit(
            `change-orders/${order.id}`,
            "io.yearning.v4.change_order.state_changed",
            {
              aggregate_id: order.id,
              from,
              to: order.state,
              reason_code: "final_step_approved",
              aggregate_version: order.version,
            },
            { kind: "system" },
          );
          decidedEmit();
        }
      } else {
        for (const candidate of stage.approval_steps) {
          if (candidate.state === "pending" || candidate.state === "active") {
            candidate.state = "skipped";
            candidate.decided_at = decidedAt;
          }
        }
        stage.state = "cancelled";
        order.state = "rejected";
        order.terminal_at = decidedAt;
        decidedEmit();
        recordOrderEvent(order, "change_order.rejected", "user", FIXTURE_OWNER_ID, "审批拒绝：任一拒绝立即拒绝整单", stage.position, order.state);
        emit(
          `change-orders/${order.id}`,
          "io.yearning.v4.change_order.state_changed",
          {
            aggregate_id: order.id,
            from,
            to: order.state,
            reason_code: "approval_rejected",
            aggregate_version: order.version,
          },
          { kind: "user", user_id: FIXTURE_OWNER_ID },
        );
      }
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // ---- Order comments (FE-F7): append-only writes and a newest-first
    // cursor read over the same relation scope, mirroring the backend
    // comments application (S004 permanent retention).
    http.get("*/change-orders/:orderId/comments", ({ params, request }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const entries = [...(world.orderComments.get(order.id) ?? [])].reverse();
      return HttpResponse.json(successEnvelope(pageOf(entries, limit, after)));
    }),

    http.post("*/change-orders/:orderId/comments", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      // Mirror comments.go exactly: only the empty string (or >4096 runes)
      // is invalid — whitespace-only content is accepted, the UI's
      // trim-based submit gating is presentation-layer strictness.
      const body = (await request.json()) as { content: string };
      if (body.content === "" || body.content.length > 4096) {
        return businessError(1001, "content must be 1..4096 characters");
      }
      const comment: FixtureComment = {
        id: uuid(),
        order_id: order.id,
        author_user_id: FIXTURE_OWNER_ID,
        author_display_name: "henry",
        content: body.content,
        occurred_at: now(),
      };
      const entries = world.orderComments.get(order.id) ?? [];
      entries.push(comment);
      world.orderComments.set(order.id, entries);
      return HttpResponse.json(successEnvelope(comment));
    }),

    // ---- Frozen submission findings (R003 reuse): reads the stage review
    // snapshots frozen at submission. This is a pure read — no Review Run is
    // ever created on the approval path (acceptance gate).
    http.get("*/change-orders/:orderId/review-findings", ({ params, request }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const findings =
        order.review_run_id === null ? [] : (world.findings.get(order.review_run_id) ?? []);
      return HttpResponse.json(successEnvelope(pageOf(findings, limit, after)));
    }),

    // ---- SQL plaintext reveal (FE-F7): the reviewer must see what they are
    // deciding on. Mirrors the backend RevealOrderSQL — relation-scoped,
    // audited per reveal, watermarked with viewer + server time, 5-minute
    // validity; plaintext leaves only through this handler's response and
    // copy events never carry SQL content.
    http.post("*/change-orders/:orderId/sql-reveals", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const body = (await request.json()) as { purpose?: string };
      const purpose = typeof body.purpose === "string" ? body.purpose : "";
      if (purpose === "" || purpose.length > 256) {
        return businessError(1001, "purpose is required (1..256)");
      }
      const revealId = uuid();
      return HttpResponse.json(
        successEnvelope({
          reveal_id: revealId,
          sql: order.sql_text,
          watermark: `Yearning SQL Viewer: henry @ ${now()}`,
          valid_until: new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        }),
      );
    }),

    // Copy audit: records the action against its source reveal; SQL content
    // is never part of the request or stored.
    http.post("*/change-orders/:orderId/sql-copy-events", async ({ request, params }) => {
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      const body = (await request.json()) as { source_reveal_id?: string };
      if (body.source_reveal_id === undefined || body.source_reveal_id === "") {
        return businessError(1001, "source_reveal_id is required");
      }
      // OpenAPI declares data: null for the copy-audit success envelope.
      return HttpResponse.json(successEnvelope(null));
    }),

    // ---- Execution attempts (FE-F8). Mirrors the backend begin command
    // (execution application/begin.go): If-Match 1004 → frozen executor 3001
    // (W006 — admin is no exception) → sent boundary 3004 (E004: only a
    // provably not_started stage may re-begin) → live attempt 3003 → state
    // 1010. A preflight failure (scenario) answers 3006 and persists no
    // attempt, so the executor may simply click again. Approval never
    // auto-executes: the attempt exists only because the executor clicked.
    http.post("*/change-orders/:orderId/execution-attempts", async ({ request, params }) => {
      seedExecutionScenarioOrder();
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      if (request.headers.get("If-Match") !== `"${String(order.version)}"`) {
        return businessError(1004, "order changed elsewhere");
      }
      // beginOnce check order: frozen executor (3001, W006 — admin is no
      // exception) → sent boundary (3004, E004: only a provably not_started
      // stage may re-begin) → live attempt (3003) → state (1010). The stage
      // identity mirrors loadOrderStage: the first active stage by position,
      // falling back to the last stage for fully terminal orders (whose
      // facts still answer 3004 before the state check).
      const stage =
        order.stages.find((candidate) =>
          ["approval_active", "execution_pending", "scheduled", "running", "result_unknown"].includes(
            candidate.state,
          ),
        ) ?? order.stages.at(-1);
      if (stage === undefined) {
        return businessError(1010, `execution is not legal from state ${order.state}`);
      }
      if (!stage.execution_actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) {
        return businessError(3001, "current user is not a frozen executor of this stage");
      }
      const facts = [...world.attempts.values()].filter(
        (candidate) => candidate.stage_id === stage.id,
      );
      if (facts.some((candidate) => candidate.send_boundary === "sent")) {
        return businessError(3004, "a prior attempt crossed the send boundary; copy to a new draft");
      }
      if (facts.some((candidate) => !isAttemptTerminal(candidate.state))) {
        return businessError(3003, "an execution attempt is already live for this stage");
      }
      if (order.state !== "stage_execution_pending" || stage.state !== "execution_pending") {
        // beginOnce answers 1010 for every non-executable state; the mock has
        // no crash-recovery reconciliation, so "running" re-begin is out of
        // scope here (recorded in the migration contract §15).
        return businessError(1010, `execution is not legal from state ${order.state}`);
      }
      const body = (await request.json().catch(() => ({}))) as {
        osc_overrides?: Record<string, unknown>;
      };
      if (
        body.osc_overrides !== undefined &&
        (typeof body.osc_overrides !== "object" ||
          Array.isArray(body.osc_overrides) ||
          Object.keys(body.osc_overrides).some(
            (key) => !["max_load", "critical_load", "chunk_size", "max_lag", "retries"].includes(key),
          ))
      ) {
        // RCP-20260827: typed override keys only — unknown keys are a client
        // contract violation (VALIDATION_FAILED), never silently dropped.
        return businessError(1001, "osc_overrides contains unknown keys");
      }
      const behavior = executionBehavior();
      if (readStoredScenario() === "execution-preflight") {
        // Preflight runs inside the begin transaction (backend beginCore): a
        // failure rolls everything back — no attempt row, no state change,
        // the executor may click again (the not_started retry path).
        return businessError(3006, "preflight failed: schema signature changed");
      }
      const attempt: FixtureExecutionAttempt = {
        id: uuid(),
        order_id: order.id,
        stage_id: stage.id,
        execution_kind: behavior.kind,
        state: "created",
        send_boundary: "not_started",
        osc:
          behavior.kind === "gh_ost"
            ? {
                tool: "gh-ost",
                tool_version: "1.1.6",
                binary_sha256: "a".repeat(64),
                plan_hash: "b".repeat(64),
                phase: "planned",
                progress_basis_points: 0,
                rows_copied: 0,
                residual_state: "not_checked",
                last_heartbeat_at: null,
              }
            : null,
        version: 1,
        created_at: now(),
        statements: makeStatements(behavior.statementCount, behavior.kind === "dml" ? "dml" : "ddl"),
        outcome: behavior.outcome,
      };
      world.attempts.set(attempt.id, attempt);
      stage.state = "running";
      order.state = "running";
      order.version += 1;
      recordOrderEvent(order, "stage.execution_started", "user", FIXTURE_OWNER_ID, `阶段 ${String(stage.position)}（${stage.datasource_name}）开始执行${behavior.kind === "gh_ost" ? "（gh-ost 在线变更）" : ""}`, stage.position, "running");
      emitExecutionState(order, "stage_execution_pending", "execution_started", stage.id, {
        kind: "user",
        user_id: FIXTURE_OWNER_ID,
      });
      advanceAttempt(order, attempt);
      return HttpResponse.json(successEnvelope(attemptPublic(attempt)));
    }),

    http.get("*/execution-attempts/:attemptId", ({ params }) => {
      const attempt = world.attempts.get(String(params.attemptId));
      if (attempt === undefined) return businessError(1002, "attempt not found");
      return HttpResponse.json(successEnvelope(attemptPublic(attempt)));
    }),

    // Statement ledger: the only statement-level surface, ordinal-ordered and
    // cursor-paged like every list endpoint.
    http.get("*/execution-attempts/:attemptId/statements", ({ params, request }) => {
      const attempt = world.attempts.get(String(params.attemptId));
      if (attempt === undefined) return businessError(1002, "attempt not found");
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const items = attempt.statements.map(statementPublic);
      return HttpResponse.json(successEnvelope(pageOf(items, limit, after)));
    }),

    // Cancellation (backend cancel.go): any frozen executor of the stage may
    // request it — not just the initiator — terminal attempts answer
    // idempotently, and the outcome is a request, not a promise: DML rolls
    // the stage back, DDL keeps prior successes, gh-ost surfaces residuals.
    http.post("*/execution-attempts/:attemptId/cancellation", async ({ request, params }) => {
      const attempt = world.attempts.get(String(params.attemptId));
      if (attempt === undefined) return businessError(1002, "attempt not found");
      const order = world.orders.get(attempt.order_id);
      const stage = order?.stages.find((candidate) => candidate.id === attempt.stage_id);
      if (order === undefined || stage === undefined) return businessError(1002, "order not found");
      if (!stage.execution_actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) {
        return businessError(3001, "current user is not a frozen executor of this stage");
      }
      if (isAttemptTerminal(attempt.state)) {
        return HttpResponse.json(successEnvelope(attemptPublic(attempt)));
      }
      if (request.headers.get("If-Match") !== `"${String(attempt.version)}"`) {
        return businessError(1004, "attempt changed elsewhere");
      }
      if (attempt.state === "cancelling") {
        return HttpResponse.json(successEnvelope(attemptPublic(attempt)));
      }
      if (attempt.state !== "running") {
        return businessError(1010, `cancel is not legal from state ${attempt.state}`);
      }
      const body = (await request.json()) as { reason?: string };
      if (typeof body.reason !== "string" || body.reason.trim() === "") {
        return businessError(1001, "reason is required");
      }
      attempt.state = "cancelling";
      attempt.version += 1;
      setTimeout(() => {
        resolveCancellation(order, attempt);
      }, CANCEL_RESOLUTION_MS);
      return HttpResponse.json(successEnvelope(attemptPublic(attempt)));
    }),

    // Manual unknown-result verification (backend verify.go): shape first
    // (3012 for missing evidence), then frozen executor (3001), then the
    // attempt and order must both be result_unknown (1010). The first
    // non-still_unknown verdict terminalizes the order; the attempt row stays
    // result_unknown forever — a second verification answers 1010 on the
    // order guard.
    http.post("*/execution-attempts/:attemptId/verifications", async ({ request, params }) => {
      const attempt = world.attempts.get(String(params.attemptId));
      if (attempt === undefined) return businessError(1002, "attempt not found");
      const order = world.orders.get(attempt.order_id);
      const stage = order?.stages.find((candidate) => candidate.id === attempt.stage_id);
      if (order === undefined || stage === undefined) return businessError(1002, "order not found");
      const body = (await request.json().catch(() => null)) as {
        result?: string;
        reason?: string;
        evidence?: Array<{ kind?: string; content?: string }>;
      } | null;
      if (body === null) return businessError(1001, "body is required");
      if (body.result !== "confirmed_succeeded" && body.result !== "confirmed_failed" && body.result !== "confirmed_partial" && body.result !== "still_unknown") {
        return businessError(1001, "result must be one of the four fixed verdicts");
      }
      if (typeof body.reason !== "string" || body.reason.length < 1 || body.reason.length > 4096) {
        return businessError(1001, "reason must be 1..4096 characters");
      }
      if (!Array.isArray(body.evidence) || body.evidence.length < 1) {
        return businessError(3012, "at least one database-side evidence item is required");
      }
      for (const entry of body.evidence) {
        if (entry.kind !== "text" && entry.kind !== "database_fact" && entry.kind !== "external_reference") {
          return businessError(1001, "evidence kind is invalid");
        }
        if (typeof entry.content !== "string" || entry.content.length < 1 || entry.content.length > 16384) {
          return businessError(1001, "evidence content must be 1..16384 characters");
        }
      }
      if (!stage.execution_actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) {
        return businessError(3001, "current user is not a frozen executor of this stage");
      }
      if (attempt.state !== "result_unknown") {
        return businessError(1010, `verification is not legal from attempt state ${attempt.state}`);
      }
      if (request.headers.get("If-Match") !== `"${String(attempt.version)}"`) {
        return businessError(1004, "attempt changed elsewhere");
      }
      if (order.state !== "result_unknown") {
        return businessError(1010, `verification is not legal from order state ${order.state}`);
      }
      const verification: FixtureVerification = {
        id: uuid(),
        attempt_id: attempt.id,
        result: body.result,
        reason: body.reason,
        evidence: body.evidence.map((entry) => ({
          kind: entry.kind as "text" | "database_fact" | "external_reference",
          content: entry.content as string,
        })),
        verified_by_user_id: FIXTURE_OWNER_ID,
        occurred_at: now(),
      };
      const entries = world.verifications.get(attempt.id) ?? [];
      entries.push(verification);
      world.verifications.set(attempt.id, entries);
      // The attempt row is untouched by verification (backend verify.go):
      // only the order aggregate moves, and its version guards any second
      // verification.
      order.version += 1;
      const from = order.state;
      if (body.result !== "still_unknown") {
        const toState =
          body.result === "confirmed_succeeded"
            ? "completed"
            : body.result === "confirmed_failed"
              ? "failed"
              : "partial_failed";
        order.state = toState;
        order.terminal_at = verification.occurred_at;
        order.manually_verified = body.result === "confirmed_succeeded";
        stage.state =
          body.result === "confirmed_succeeded"
            ? "succeeded"
            : body.result === "confirmed_failed"
              ? "failed"
              : "partial_failed";
        recordOrderEvent(
          order,
          "change_order.unknown_resolved",
          "user",
          FIXTURE_OWNER_ID,
          `人工核验结论 ${body.result}：工单${toState === "completed" ? "完成" : "终止"}（执行结果由人工确认）`,
          stage.position,
          toState,
        );
      } else {
        recordOrderEvent(order, "change_order.unknown_resolved", "user", FIXTURE_OWNER_ID, "人工核验结论 still_unknown：继续阻断后续阶段", stage.position, "result_unknown");
      }
      emit(
        `change-orders/${order.id}`,
        "io.yearning.v4.execution.verification_recorded",
        {
          order_id: order.id,
          attempt_id: attempt.id,
          verified_by_user_id: FIXTURE_OWNER_ID,
          result: body.result,
          evidence_count: body.evidence.length,
          aggregate_version: order.version,
        },
        { kind: "user", user_id: FIXTURE_OWNER_ID },
      );
      emit(
        `change-orders/${order.id}`,
        "io.yearning.v4.execution.state_changed",
        {
          aggregate_id: order.id,
          from,
          to: order.state,
          reason_code: `unknown_resolved:${body.result}`,
          stage_id: stage.id,
          aggregate_version: order.version,
        },
        { kind: "user", user_id: FIXTURE_OWNER_ID },
      );
      return HttpResponse.json(successEnvelope(orderPublic(order)));
    }),

    // Deferred execution (backend schedule.go): executor-only creation from
    // stage_execution_pending, one live schedule per stage, window ≥ now+5min
    // and ≤ now+30 days. Due-time claiming, missed handling and datasource
    // blocking are scheduler-side; cancellation has no endpoint — the
    // submitter withdraws the order and the scheduler closes the row (E007).
    http.post("*/change-orders/:orderId/execution-schedules", async ({ request, params }) => {
      seedExecutionScenarioOrder();
      const order = world.orders.get(String(params.orderId));
      if (order === undefined) return businessError(1002, "order not found");
      if (request.headers.get("If-Match") !== `"${String(order.version)}"`) {
        return businessError(1004, "order changed elsewhere");
      }
      // createScheduleOnce check order: frozen executor (3001) → state (1010,
      // only stage_execution_pending schedules) → live attempt/sent facts and
      // live schedule (3003) → window (3007).
      const stage =
        order.stages.find((candidate) =>
          ["approval_active", "execution_pending", "scheduled", "running", "result_unknown"].includes(
            candidate.state,
          ),
        ) ?? order.stages.at(-1);
      if (stage === undefined) {
        return businessError(1010, `scheduling is not legal from state ${order.state}`);
      }
      if (!stage.execution_actors.some((actor) => actor.id === FIXTURE_OWNER_ID)) {
        return businessError(3001, "current user is not a frozen executor of this stage");
      }
      if (order.state !== "stage_execution_pending" || stage.state !== "execution_pending") {
        return businessError(1010, `scheduling is not legal from state ${order.state}`);
      }
      const facts = [...world.attempts.values()].filter(
        (candidate) => candidate.stage_id === stage.id,
      );
      if (
        facts.some((candidate) => !isAttemptTerminal(candidate.state)) ||
        facts.some((candidate) => candidate.send_boundary === "sent") ||
        liveScheduleFor(order.id) !== undefined
      ) {
        return businessError(3003, "this stage already has a live execution instance");
      }
      const body = (await request.json()) as { scheduled_for?: string };
      const scheduledFor = typeof body.scheduled_for === "string" ? body.scheduled_for : "";
      const due = Date.parse(scheduledFor);
      if (scheduledFor === "" || Number.isNaN(due)) {
        return businessError(1001, "scheduled_for must be an RFC3339 timestamp");
      }
      const leadMs = due - Date.now();
      if (leadMs < 5 * 60 * 1000 || leadMs > 30 * 24 * 3600 * 1000) {
        return businessError(3007, "scheduled_for must be 5 minutes to 30 days ahead");
      }
      const schedule: FixtureSchedule = {
        id: uuid(),
        order_id: order.id,
        stage_id: stage.id,
        scheduled_for: new Date(due).toISOString().replace(/\.\d{3}Z$/, "Z"),
        state: "scheduled",
        version: 1,
      };
      world.schedules.set(schedule.id, schedule);
      const from = order.state;
      stage.state = "scheduled";
      order.state = "scheduled";
      order.version += 1;
      recordOrderEvent(order, "execution.scheduled", "user", FIXTURE_OWNER_ID, `阶段 ${String(stage.position)} 已预约 ${schedule.scheduled_for} 到点执行（到点未领取将标记错过，不自动补跑）`, stage.position, "scheduled");
      emitExecutionState(order, from, "executor_scheduled", stage.id, {
        kind: "user",
        user_id: FIXTURE_OWNER_ID,
      });
      return HttpResponse.json(
        successEnvelope({
          id: schedule.id,
          stage_id: schedule.stage_id,
          scheduled_for: schedule.scheduled_for,
          state: schedule.state,
        }),
      );
    }),

    http.get("*/review-runs/:runId", ({ params }) => {
      const run = world.runs.get(String(params.runId));
      if (run === undefined) return businessError(1002, "review run not found");
      return HttpResponse.json(successEnvelope(runPublic(run)));
    }),

    http.get("*/review-runs/:runId/findings", ({ params, request }) => {
      const runId = String(params.runId);
      if (!world.runs.has(runId)) return businessError(1002, "review run not found");
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const after = url.searchParams.get("after");
      const findings = world.findings.get(runId) ?? [];
      return HttpResponse.json(successEnvelope(pageOf(findings, limit, after)));
    }),

    http.get("*/review-findings/:findingId/evidence", ({ params }) => {
      const findingId = String(params.findingId);
      for (const findings of world.findings.values()) {
        const finding = findings.find((entry) => entry.id === findingId);
        if (finding !== undefined) {
          const evidence: Array<{
            id: string;
            source_kind: string;
            source_reference: string;
            fact_status: string;
            normalized_fact: Record<string, unknown>;
            has_raw_payload: boolean;
            raw_payload_expires_at: string | null;
            collected_at: string;
          }> = [];
          for (const id of finding.evidence_ids) {
            const entry = world.evidence.get(id);
            if (entry === undefined) continue;
            evidence.push({
              id: entry.id,
              source_kind: entry.source_kind,
              source_reference: entry.source_reference,
              fact_status: entry.fact_status,
              normalized_fact: entry.normalized_fact,
              has_raw_payload: entry.has_raw_payload,
              raw_payload_expires_at: entry.raw_payload_expires_at,
              collected_at: entry.collected_at,
            });
          }
          return HttpResponse.json(successEnvelope(evidence));
        }
      }
      return businessError(1002, "finding not found");
    }),

    http.post("*/review-evidence/:evidenceId/raw-reveals", ({ params }) => {
      const evidence = world.evidence.get(String(params.evidenceId));
      if (evidence === undefined) return businessError(1002, "evidence not found");
      if (!evidence.has_raw_payload || evidence.raw_payload_expires_at === null) {
        return businessError(1011, "raw payload is no longer retained");
      }
      if (evidence.raw_payload_expires_at < now()) {
        return businessError(1011, "raw payload retention window has passed");
      }
      return HttpResponse.json(
        successEnvelope({
          reveal_id: uuid(),
          content_type: "application/json",
          raw_payload: {
            tool: "built-in:mysql.table_stats",
            query: "SHOW TABLE STATUS LIKE 'orders'",
            rows: [{ name: "orders", rows: 128400, index_length: 4587520 }],
            note: FIXTURE_RAW_EVIDENCE_MARKER,
          },
          watermark: `henry · ${now()} · evidence:${evidence.id}`,
          valid_until: new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        }),
      );
    }),

    http.post("*/review-evidence/:evidenceId/raw-copy-events", () => {
      return HttpResponse.json(successEnvelope(null));
    }),

    http.get("*/tasks/:taskId", ({ params }) => {
      const task = world.tasks.get(String(params.taskId));
      if (task !== undefined) return HttpResponse.json(successEnvelope({ ...task }));
      // Admin-domain tasks (datasource/provider connection tests, FE-F9)
      // live in the admin fixture world; this shared read route consults
      // both registries before answering 1002.
      const adminTask = adminFixtureTask(String(params.taskId));
      if (adminTask !== null) return HttpResponse.json(successEnvelope({ ...adminTask }));
      return businessError(1002, "task not found");
    }),
  ];
}

/**
 * Page-side transport for the ReviewEventClient under mock/E2E. Handlers run
 * on the same main thread, so this drains the fixture Outbox with resume
 * points — exercising the same dedup/sequence/reconnect semantics the real
 * F12 transport must satisfy.
 */
export async function* createMockEventTransport(
  resume: Record<string, number>,
): AsyncIterable<unknown> {
  const cursors: Record<string, number> = { ...resume };
  for (const [subject, sequence] of Object.entries(cursors)) {
    world.sequences.set(subject, Math.max(world.sequences.get(subject) ?? 0, sequence));
  }
  let cursor = 0;
  while (cursor < Number.MAX_SAFE_INTEGER) {
    // The world can be reset under a long-lived transport (test seams): a
    // cursor past the fresh outbox would never yield again, so fall back to
    // replaying from the start — the client dedups by event id.
    if (cursor > world.outbox.length) cursor = 0;
    while (cursor < world.outbox.length) {
      const entry = world.outbox[cursor];
      if (entry === undefined) break;
      cursor += 1;
      const last = cursors[entry.subject] ?? 0;
      cursors[entry.subject] = entry.sequence;
      if (entry.sequence > last) yield entry.payload;
    }
    await delay(120);
  }
}
