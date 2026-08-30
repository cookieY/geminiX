import { HttpResponse, delay, http } from "msw";
import type { DefaultBodyType, HttpHandler } from "msw";
import { readStoredScenario } from "@/shared/mock/scenario-store";
import { readStoredAuthBehavior } from "@/shared/mock/auth-scenario-store";

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
  world.outbox.length = 0;
  world.sequences.clear();
  world.flowVersion = 1;
  world.flowUpdated = false;
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
  const start = after === null ? 0 : items.findIndex((item) => (item as { id: string }).id === after) + 1;
  const window = Number.isNaN(start) ? [] : items.slice(start < 0 ? 0 : start);
  const slice = limit === null ? window : window.slice(0, limit);
  const last = slice.at(-1) as { id: string } | undefined;
  const hasMore = limit === null ? false : (start < 0 ? 0 : start) + slice.length < items.length;
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
 * If-Match ("N"). A mismatch answers 1003 VERSION_CONFLICT on the business
 * path (draft_update/draft_review/draft_submit profiles). */
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

  switch (behavior) {
    case "ready": {
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
      setStage("blocked", "critical", false, [highFinding, criticalFinding]);
      break;
    }
    case "partial": {
      run.state = "partial";
      run.gate = { passed: false, reason_codes: ["stage_review_incomplete"] };
      run.failure_code = "budget_exhausted";
      run.finished_at = now();
      setStage("partial", "medium", false, [mediumFinding]);
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
    http.get("*/users/me/flows", ({ request }) => {
      const flowType = new URL(request.url).searchParams.get("flow_type");
      if (flowType !== "change_review" || readStoredAuthBehavior() !== "admin") {
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
      draft.statement_count = body.sql.split(";").filter((part) => part.trim().length > 0).length;
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
      if (revisionConflict(request, draft)) {
        return businessError(1003, "draft revision changed elsewhere");
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
      const order = {
        id: uuid(),
        display_number: "YR-20260830-000001",
        submitter_user_id: draft.owner_user_id,
        title: draft.title,
        state: "submitted",
        current_stage_position: 1,
        stages: [
          {
            id: uuid(),
            position: 1,
            datasource_name: "orders-mysql",
            state: "pending",
            approval_steps: [{ position: 1, actors: [{ user_id: FIXTURE_OWNER_ID }], state: "pending" }],
            execution_actors: [{ user_id: FIXTURE_OWNER_ID }],
          },
        ],
        has_sql: true,
        sql_hash: `hash-${String(draft.revision)}`,
        snapshot_hash: `snap-${run.id.slice(0, 8)}`,
        manually_verified: false,
        version: 1,
        submitted_at: now(),
        terminal_at: null,
      };
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
      return HttpResponse.json(successEnvelope(order));
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
      if (task === undefined) return businessError(1002, "task not found");
      return HttpResponse.json(successEnvelope({ ...task }));
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
