import { HttpResponse, http } from "msw";
import type { DefaultBodyType, HttpHandler } from "msw";
import { readStoredAuthBehavior } from "@/shared/mock/auth-scenario-store";
import type {
  AiProvider,
  Datasource,
  ReviewInputDefinition,
  DatasourceCapabilities,
  KnowledgeEntry,
  KnowledgeEntryEvaluation,
  PromptTool,
  RuleSet,
  SettingsImpactAssessment,
  SettingsRevision,
  SettingsValue,
  Task,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Stateful admin fixture backing FE-F9-REVIEW-ADMIN mock development and
 * E2E (code-generation-policy.json mock_layer). It mirrors the frozen
 * OpenAPI surface for the six review-admin domains — the 200 business
 * envelope, If-Match optimistic locking (1004), the declared error codes
 * (operation-error-profiles: admin_create/admin_replace/admin_delete/
 * datasource_delete/connection_test/settings_replace), the two-step
 * high-impact settings update (assess → impact_token → PUT), async
 * connection-test tasks, and the non-admin HTTP 403 boundary of the real
 * RequireOperation guard (backend guards.go; anonymous 401).
 *
 * Cross-repo facts mirrored as contract, not invented: providers chain in
 * selection_priority ascending order (provider/chain.go:3); enabling a
 * review input runs the static eval gate (prompttools.go RunPromptToolEval,
 * 1001 on failure); settings impact level is "high" when a changed field's
 * impact is "high" or "immediate" (settings/service.go:110). TLS material
 * has no declared datasource fields (backend-internal only) and prompt-tool
 * views carry no builtin flag — the fixture stays inside the declared
 * schema; both boundaries are recorded in migration contract §16.
 */

const ADMIN_REQUEST_ID = "45454545-4545-4545-8545-454545454545";

const PURPOSES = ["review", "query", "execution"] as const;

/** engineModeOK mirror (datasource/service.go:89): engine/compatibility
 * linkage enforced identically by the write validators. */
function engineModeOK(engine: string, mode: string): boolean {
  if (engine === "mysql" || engine === "tidb" || engine === "oceanbase") return mode === "mysql";
  if (engine === "postgresql") return mode === "postgresql";
  if (engine === "polardb") return mode === "mysql" || mode === "postgresql";
  return false;
}

interface CredentialLike {
  purpose: string;
  username?: string;
  password?: { value: string } | null;
  reuse_credential_purpose?: string | null;
}

/** validateWrite mirror (datasource/service.go:103): field lengths/enums,
 * engine-mode matrix, 1..3 unique purposes, username required and a
 * password present unless reuse points at a DIFFERENT purpose. */
function validateDatasourceWrite(body: Record<string, unknown>): string | null {
  const name = typeof body.name === "string" ? body.name : "";
  const host = typeof body.host === "string" ? body.host : "";
  if (name === "" || name.length > 128 || host === "" || host.length > 253) {
    return "name and host are required";
  }
  const port = Number(body.port ?? 0);
  const versionConstraint = typeof body.version_constraint === "string" ? body.version_constraint : "";
  if (port < 1 || port > 65535 || versionConstraint === "" || versionConstraint.length > 64) {
    return "port and version_constraint must be valid";
  }
  if (body.deployment_kind !== "native" && body.deployment_kind !== "cloud") {
    return "deployment_kind is invalid";
  }
  const engine = typeof body.engine === "string" ? body.engine : "";
  const compatibilityMode = typeof body.compatibility_mode === "string" ? body.compatibility_mode : "";
  if (!engineModeOK(engine, compatibilityMode)) {
    return "engine and compatibility_mode do not match the supported matrix";
  }
  const credentials = Array.isArray(body.credentials) ? (body.credentials as CredentialLike[]) : [];
  if (credentials.length < 1 || credentials.length > 3) {
    return "at least one and at most three credentials are required";
  }
  const seen = new Set<string>();
  for (const credential of credentials) {
    if (!PURPOSES.includes(credential.purpose as (typeof PURPOSES)[number])) {
      return "credential purpose is invalid";
    }
    if (seen.has(credential.purpose)) return "credential purposes must be unique";
    seen.add(credential.purpose);
    if (typeof credential.username !== "string" || credential.username === "") {
      return "credential username is required";
    }
    const hasPassword = credential.password != null && credential.password.value !== "";
    const reuse = credential.reuse_credential_purpose;
    if (!hasPassword && (reuse == null || reuse === "" || reuse === credential.purpose)) {
      return "credential requires a password or an explicit reuse of another purpose";
    }
  }
  return null;
}

/** replaceCredentials mirror (datasource/service.go:174): the write is a
 * FULL replacement of the enabled credential set — purposes absent from the
 * payload lose their credential; a password-less entry copies the OLD
 * stored secret of the reused purpose (never the payload's new one). */
function applyCredentialReplacement(
  oldCredentials: FixtureDatasource["credentials"],
  credentials: CredentialLike[],
): FixtureDatasource["credentials"] | string {
  const next: FixtureDatasource["credentials"] = {};
  for (const credential of credentials) {
    const purpose = credential.purpose as (typeof PURPOSES)[number];
    const password = credential.password?.value ?? "";
    if (password !== "") {
      next[purpose] = { username: credential.username ?? "", password };
      continue;
    }
    const source = oldCredentials[(credential.reuse_credential_purpose ?? "") as (typeof PURPOSES)[number]];
    if (source === undefined) {
      return "reuse credential source is not configured";
    }
    next[purpose] = { username: credential.username ?? "", password: source.password };
  }
  return next;
}

const SETTING_NAMESPACES = ["general", "query", "execution", "ai-budget", "branding"] as const;

/** Per-field impact vocabulary from settings-namespaces.json (machine
 * authority) — "high" and "immediate" classify the assessment as high
 * impact (settings/service.go:110). */
const SETTINGS_FIELD_IMPACT: Record<string, Record<string, string>> = {
  general: { registration_enabled: "immediate", system_timezone: "next_operation", default_locale: "next_session" },
  query: {
    approval_enabled: "high",
    default_timeout_ms: "next_query",
    maximum_approved_access_duration_minutes: "next_request",
  },
  execution: { restriction_enabled: "high", windows: "high", osc: "high" },
  "ai-budget": {
    enforced: "immediate",
    currency: "next_reservation",
    daily_budget_minor: "next_reservation",
    alert_threshold_percent: "next_usage_entry",
  },
  branding: { product_name: "immediate", login_description: "next_session", logo_asset_id: "next_page_load", favicon_asset_id: "next_page_load" },
};

const DEFAULT_SETTINGS: Record<string, SettingsValue> = {
  general: { registration_enabled: false, system_timezone: "Asia/Shanghai", default_locale: "zh-CN" },
  query: { approval_enabled: true, default_timeout_ms: 30000, maximum_approved_access_duration_minutes: 43200 },
  execution: { restriction_enabled: false, windows: [], osc: { tool: "none", defaults: {} } },
  "ai-budget": { enforced: false, currency: "USD", daily_budget_minor: 10000, alert_threshold_percent: 80 },
  branding: { product_name: "Yearning", login_description: "", logo_asset_id: null, favicon_asset_id: null },
};

interface FixtureCredential {
  username: string;
  /** Fixture-internal plaintext; never serialized back to any read face. */
  password: string;
}

interface FixtureDatasource extends Datasource {
  credentials: Partial<Record<(typeof PURPOSES)[number], FixtureCredential>>;
  capabilities: DatasourceCapabilities | null;
}

interface FixtureProvider extends AiProvider {
  /** Fixture-internal; the read face only exposes api_key_configured. */
  apiKey: string;
}

interface FixtureReviewInput {
  id: string;
  name: string;
  state: "draft" | "enabled" | "disabled";
  definition: PromptTool["definition"];
  config_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface FixturePromptTool extends FixtureReviewInput {
  engine: "all" | "mysql" | "postgresql";
  parameters: Record<string, number | string | boolean | string[]>;
}

interface FixtureKnowledgeEntry extends FixtureReviewInput {
  purpose: string | null;
  scope_type: "global" | "datasource" | "table";
  datasource_id: string | null;
  database_name: string | null;
  table_name: string | null;
  provenance: "manual" | "finding_conversion";
  source_finding_id: string | null;
  evaluation: KnowledgeEntryEvaluation | null;
}

interface FixtureRuleSet {
  id: string;
  name: string;
  enabled: boolean;
  prompt_tool_ids: string[];
  config_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface FixtureFlow {
  id: string;
  name: string;
  flow_type: "change_review" | "query_access";
  enabled: boolean;
  rule_set_id: string | null;
}

interface FixtureNamespace {
  settings: SettingsValue;
  version: number;
  updated_by: string;
  updated_at: string;
}

interface FixtureAdminTask {
  id: string;
  kind: "admin_connection_test" | "ai_provider_connection_test";
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: { completed: number; total: number; unit: string };
  result_ref: string | null;
  error: null;
  created_at: string;
  updated_at: string;
}

const TASK_QUEUED_TO_RUNNING_MS = 300;
const TASK_RUNNING_TO_DONE_MS = 600;

const SEED_ADMIN_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

export const ADMIN_FIXTURE_DATASOURCE_MYSQL_ID = "4f6f1a2b-0000-4000-8000-00000000a001";
export const ADMIN_FIXTURE_DATASOURCE_PG_ID = "4f6f1a2b-0000-4000-8000-00000000a002";
export const ADMIN_FIXTURE_PROVIDER_PRIMARY_ID = "4f6f1a2b-0000-4000-8000-00000000b001";
export const ADMIN_FIXTURE_PROVIDER_BACKUP_ID = "4f6f1a2b-0000-4000-8000-00000000b002";
export const ADMIN_FIXTURE_TOOL_ENABLED_ID = "4f6f1a2b-0000-4000-8000-00000000c001";
export const ADMIN_FIXTURE_TOOL_DRAFT_ID = "4f6f1a2b-0000-4000-8000-00000000c002";
export const ADMIN_FIXTURE_KNOWLEDGE_GLOBAL_ID = "4f6f1a2b-0000-4000-8000-00000000d001";
export const ADMIN_FIXTURE_KNOWLEDGE_TABLE_ID = "4f6f1a2b-0000-4000-8000-00000000d002";
export const ADMIN_FIXTURE_KNOWLEDGE_CONVERTED_ID = "4f6f1a2b-0000-4000-8000-00000000d003";
export const ADMIN_FIXTURE_RULE_SET_ID = "4f6f1a2b-0000-4000-8000-00000000e001";
export const ADMIN_FIXTURE_FLOW_CHANGE_ID = "4f6f1a2b-0000-4000-8000-00000000f001";

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/** Deterministic stand-in for the backend config hash (stable for identical
 * content so tests can assert "hash changes iff definition changes"). */
function configHash(...parts: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const text = parts.join("\u0000");
  for (let i = 0; i < text.length; i += 1) {
    h1 = (h1 ^ text.charCodeAt(i)) * 0x01000193;
    h2 = (h2 + text.charCodeAt(i) * (i + 7)) * 0x85ebca6b;
    h1 >>>= 0;
    h2 >>>= 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

const world = {
  datasources: new Map<string, FixtureDatasource>(),
  providers: new Map<string, FixtureProvider>(),
  promptTools: new Map<string, FixturePromptTool>(),
  knowledgeEntries: new Map<string, FixtureKnowledgeEntry>(),
  ruleSets: new Map<string, FixtureRuleSet>(),
  flows: new Map<string, FixtureFlow>(),
  settings: new Map<string, FixtureNamespace>(),
  revisions: new Map<string, SettingsRevision[]>(),
  tasks: new Map<string, FixtureAdminTask>(),
  /** Single-use impact tokens: key → proposed settings hash. */
  impactTokens: new Map<string, string>(),
};

export function resetAdminFixture(): void {
  world.datasources.clear();
  world.providers.clear();
  world.promptTools.clear();
  world.knowledgeEntries.clear();
  world.ruleSets.clear();
  world.flows.clear();
  world.settings.clear();
  world.revisions.clear();
  world.tasks.clear();
  world.impactTokens.clear();
  seedAdminFixture();
}

const PROD_WINDOW_DEFINITION: ReviewInputDefinition = {
  knowledge_text: "Production DDL is only allowed inside the announced maintenance window.",
  finding_template: {
    finding_key: "experience.window.violation",
    category: "governance",
    severity: "critical",
    title: "Outside window",
    message: "Schema change scheduled outside the maintenance window.",
    suggestion: "Reschedule the change into the window.",
  },
  severity_whitelist: ["critical", "high"],
  version: 1,
};

const ORDERS_HUGE_DEFINITION: ReviewInputDefinition = {
  knowledge_text: "The orders table exceeds 500M rows; any unbounded scan is critical.",
  finding_template: {
    finding_key: "experience.orders.fullscan",
    category: "performance",
    severity: "critical",
    title: "Full scan on orders",
    message: "The statement scans the huge orders table without a bound.",
    suggestion: "Filter on the shard key or a selective index.",
  },
  severity_whitelist: ["critical"],
  version: 1,
};

const CHARSET_DEFINITION: ReviewInputDefinition = {
  knowledge_text: "This datasource standardizes on UTF8; new columns must not introduce latin1.",
  finding_template: {
    finding_key: "experience.charset.drift",
    category: "compatibility",
    severity: "medium",
    title: "Charset drift",
    message: "A column uses a charset outside the datasource standard.",
    suggestion: "Use the datasource default charset.",
  },
  severity_whitelist: ["medium", "low"],
  version: 1,
};

/** Deterministic admin-domain baseline shared by vitest and e2e. */
export function seedAdminFixture(): void {
  const ts = now();
  world.datasources.set(ADMIN_FIXTURE_DATASOURCE_MYSQL_ID, {
    id: ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
    name: "prod-order-mysql",
    engine: "mysql",
    compatibility_mode: "mysql",
    deployment_kind: "native",
    host: "10.0.0.11",
    port: 3306,
    database_name: null,
    enabled: true,
    credential_status: { review: true, query: true, execution: true },
    referenced_by_flow_count: 1,
    version: 3,
    created_at: ts,
    updated_at: ts,
    credentials: {
      review: { username: "review_ro", password: "revpw-1" },
      query: { username: "query_ro", password: "qrypw-1" },
      execution: { username: "exec_rw", password: "execpw-1" },
    },
    capabilities: {
      datasource_id: ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
      detected_version: "8.0.36",
      identity_fingerprint: "mysql:prod-order-mysql:inst-77",
      capabilities: { change_review: true, execution: true, query: true, export: true, gh_ost: true },
      checked_at: ts,
    },
  });
  world.datasources.set(ADMIN_FIXTURE_DATASOURCE_PG_ID, {
    id: ADMIN_FIXTURE_DATASOURCE_PG_ID,
    name: "analytics-pg",
    engine: "postgresql",
    compatibility_mode: "postgresql",
    deployment_kind: "cloud",
    host: "10.0.0.12",
    port: 5432,
    database_name: "analytics",
    enabled: true,
    credential_status: { review: true, query: true },
    referenced_by_flow_count: 0,
    version: 1,
    created_at: ts,
    updated_at: ts,
    credentials: {
      review: { username: "review_ro", password: "revpw-2" },
      query: { username: "query_ro", password: "qrypw-2" },
    },
    capabilities: null,
  });
  world.providers.set(ADMIN_FIXTURE_PROVIDER_PRIMARY_ID, {
    id: ADMIN_FIXTURE_PROVIDER_PRIMARY_ID,
    name: "primary-glm",
    provider_kind: "openai_compatible",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model_name: "glm-4.6",
    enabled: true,
    selection_priority: 1,
    api_key_configured: true,
    version: 1,
    created_at: ts,
    updated_at: ts,
    apiKey: "pkey-a1",
  });
  world.providers.set(ADMIN_FIXTURE_PROVIDER_BACKUP_ID, {
    id: ADMIN_FIXTURE_PROVIDER_BACKUP_ID,
    name: "backup-deepseek",
    provider_kind: "openai_compatible",
    base_url: "https://api.deepseek.com/v1",
    model_name: "deepseek-chat",
    enabled: true,
    selection_priority: 2,
    api_key_configured: true,
    version: 1,
    created_at: ts,
    updated_at: ts,
    apiKey: "pkey-b1",
  });
  for (const ns of SETTING_NAMESPACES) {
    world.settings.set(ns, {
      settings: structuredClone(DEFAULT_SETTINGS[ns]) as SettingsValue,
      version: 1,
      updated_by: SEED_ADMIN_ID,
      updated_at: ts,
    });
    world.revisions.set(ns, []);
  }
  world.promptTools.set(ADMIN_FIXTURE_TOOL_ENABLED_ID, {
    id: ADMIN_FIXTURE_TOOL_ENABLED_ID,
    name: "dml-where-guard",
    state: "enabled",
    engine: "all",
    parameters: { max_full_scan_rows: 100000 },
    definition: {
      knowledge_text: "DML statements must carry a WHERE clause that bounds the affected rows.",
      finding_template: {
        finding_key: "dml.where.missing",
        category: "correctness",
        severity: "high",
        title: "Unbounded DML",
        message: "The statement changes rows without a WHERE bound.",
        suggestion: "Add a WHERE clause on the primary key or another selective predicate.",
      },
      severity_whitelist: ["medium", "high"],
      version: 1,
    },
    config_hash: configHash(
      "dml-where-guard",
      "all",
      JSON.stringify({
        knowledge_text: "DML statements must carry a WHERE clause that bounds the affected rows.",
        finding_template: {
          finding_key: "dml.where.missing",
          category: "correctness",
          severity: "high",
          title: "Unbounded DML",
          message: "The statement changes rows without a WHERE bound.",
          suggestion: "Add a WHERE clause on the primary key or another selective predicate.",
        },
        severity_whitelist: ["medium", "high"],
        version: 1,
      }),
      JSON.stringify({ max_full_scan_rows: 100000 }),
    ),
    version: 2,
    created_at: ts,
    updated_at: ts,
  });
  world.promptTools.set(ADMIN_FIXTURE_TOOL_DRAFT_ID, {
    id: ADMIN_FIXTURE_TOOL_DRAFT_ID,
    name: "table-comment-check",
    state: "draft",
    engine: "mysql",
    parameters: {},
    definition: {
      knowledge_text: "Every new table must declare a table comment and column comments.",
      finding_template: {
        finding_key: "ddl.comment.missing",
        category: "operability",
        severity: "low",
        title: "Missing comment",
        message: "The table lacks a comment.",
        suggestion: "Add COMMENT '...' to the table definition.",
      },
      severity_whitelist: ["low", "info"],
      version: 1,
    },
    config_hash: configHash(
      "table-comment-check",
      "mysql",
      JSON.stringify({
        knowledge_text: "Every new table must declare a table comment and column comments.",
        finding_template: {
          finding_key: "ddl.comment.missing",
          category: "operability",
          severity: "low",
          title: "Missing comment",
          message: "The table lacks a comment.",
          suggestion: "Add COMMENT '...' to the table definition.",
        },
        severity_whitelist: ["low", "info"],
        version: 1,
      }),
      JSON.stringify({}),
    ),
    version: 1,
    created_at: ts,
    updated_at: ts,
  });
  world.knowledgeEntries.set(ADMIN_FIXTURE_KNOWLEDGE_GLOBAL_ID, {
    id: ADMIN_FIXTURE_KNOWLEDGE_GLOBAL_ID,
    name: "prod-window-policy",
    purpose: "Global boundary: schema changes on production replicas follow the maintenance window.",
    state: "enabled",
    scope_type: "global",
    datasource_id: null,
    database_name: null,
    table_name: null,
    definition: PROD_WINDOW_DEFINITION,
    config_hash: configHash("prod-window-policy", "global", "", "", "", JSON.stringify(PROD_WINDOW_DEFINITION)),
    version: 1,
    created_at: ts,
    updated_at: ts,
    provenance: "manual",
    source_finding_id: null,
    evaluation: {
      pass: true,
      schema_subset_ok: true,
      privacy_ok: true,
      injection_ok: true,
      severity_ok: true,
      findings: [],
      checked_at: ts,
    },
  });
  world.knowledgeEntries.set(ADMIN_FIXTURE_KNOWLEDGE_TABLE_ID, {
    id: ADMIN_FIXTURE_KNOWLEDGE_TABLE_ID,
    name: "orders-huge-table",
    purpose: "orders table is huge: full scans are critical.",
    state: "draft",
    scope_type: "table",
    datasource_id: ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
    database_name: "orderdb",
    table_name: "orders",
    definition: ORDERS_HUGE_DEFINITION,
    config_hash: configHash("orders-huge-table", "table", ADMIN_FIXTURE_DATASOURCE_MYSQL_ID, "orderdb", "orders", JSON.stringify(ORDERS_HUGE_DEFINITION)),
    version: 1,
    created_at: ts,
    updated_at: ts,
    provenance: "manual",
    source_finding_id: null,
    evaluation: null,
  });
  world.knowledgeEntries.set(ADMIN_FIXTURE_KNOWLEDGE_CONVERTED_ID, {
    id: ADMIN_FIXTURE_KNOWLEDGE_CONVERTED_ID,
    name: "charset-uniformity",
    purpose: "Converted from a historical review finding.",
    state: "disabled",
    scope_type: "datasource",
    datasource_id: ADMIN_FIXTURE_DATASOURCE_PG_ID,
    database_name: null,
    table_name: null,
    definition: CHARSET_DEFINITION,
    config_hash: configHash("charset-uniformity", "datasource", ADMIN_FIXTURE_DATASOURCE_PG_ID, "", "", JSON.stringify(CHARSET_DEFINITION)),
    version: 1,
    created_at: ts,
    updated_at: ts,
    provenance: "finding_conversion",
    source_finding_id: "9a1b2c3d-0000-4000-8000-00000000e999",
    evaluation: {
      pass: true,
      schema_subset_ok: true,
      privacy_ok: true,
      injection_ok: true,
      severity_ok: true,
      findings: [],
      checked_at: ts,
    },
  });
  world.ruleSets.set(ADMIN_FIXTURE_RULE_SET_ID, {
    id: ADMIN_FIXTURE_RULE_SET_ID,
    name: "change-review-default",
    enabled: true,
    prompt_tool_ids: [ADMIN_FIXTURE_TOOL_ENABLED_ID],
    config_hash: configHash("change-review-default", "v1"),
    version: 1,
    created_at: ts,
    updated_at: ts,
  });
  world.flows.set(ADMIN_FIXTURE_FLOW_CHANGE_ID, {
    id: ADMIN_FIXTURE_FLOW_CHANGE_ID,
    name: "生产变更默认流程",
    flow_type: "change_review",
    enabled: true,
    rule_set_id: ADMIN_FIXTURE_RULE_SET_ID,
  });
}

function successEnvelope(data: DefaultBodyType) {
  return { err_code: 0, message: "ok", data, request_id: ADMIN_REQUEST_ID };
}

function businessError(errCode: number, message: string) {
  return HttpResponse.json({
    err_code: errCode,
    message,
    data: null,
    request_id: ADMIN_REQUEST_ID,
    retryable: false,
  });
}

function problem(status: number, title: string, detail: string): HttpResponse<DefaultBodyType> {
  return HttpResponse.json(
    { type: "about:blank", title, status, detail, request_id: ADMIN_REQUEST_ID },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function pageOf<T extends { id: string }>(items: T[], limit: number | null, after: string | null) {
  const start =
    after === null
      ? 0
      : (() => {
          const index = items.findIndex((item) => item.id === after);
          return index === -1 ? items.length : index + 1;
        })();
  const sliced = items.slice(start, limit === null ? undefined : start + limit);
  const next = limit !== null && start + limit < items.length ? sliced.at(-1)?.id ?? null : null;
  return {
    items: sliced,
    page: { next_cursor: next, has_more: next !== null },
  };
}

/**
 * RequireOperation mirror (backend guards.go): anonymous callers get 401,
 * authenticated non-admin callers get 403. `yearning-mock-auth` carries the
 * behavior dimension exactly as the auth handlers read it.
 */
function adminGuard(): HttpResponse<DefaultBodyType> | null {
  const behavior = readStoredAuthBehavior();
  const hasSession = behavior !== "expired";
  if (!hasSession) return problem(401, "authentication required", "no active session");
  if (behavior !== "admin") {
    return problem(403, "permission denied", "admin capability required");
  }
  return null;
}

function parseIfMatch(request: Request): string | null {
  const raw = request.headers.get("If-Match");
  if (raw === null) return null;
  return raw.replace(/^"|"$/g, "");
}

function versionMismatch(request: Request, current: number): boolean {
  const got = parseIfMatch(request);
  return got !== String(current);
}

function taskView(task: FixtureAdminTask): Task {
  return { ...task };
}

function advanceTask(task: FixtureAdminTask, onDone: () => void, fail = false): void {
  const target = fail ? "failed" : "succeeded";
  if (task.state === "queued") {
    setTimeout(() => {
      task.state = "running";
      task.updated_at = now();
      setTimeout(() => {
        task.state = target;
        task.updated_at = now();
        onDone();
      }, TASK_RUNNING_TO_DONE_MS);
    }, TASK_QUEUED_TO_RUNNING_MS);
  }
}

function taskResponse(
  kind: FixtureAdminTask["kind"],
  resultRef: string,
  onDone: () => void,
  fail = false,
): HttpResponse<DefaultBodyType> {
  const task: FixtureAdminTask = {
    id: uuid(),
    kind,
    state: "queued",
    progress: { completed: 0, total: 1, unit: "checks" },
    result_ref: resultRef,
    error: null,
    created_at: now(),
    updated_at: now(),
  };
  world.tasks.set(task.id, task);
  advanceTask(task, onDone, fail);
  return HttpResponse.json(successEnvelope(taskView(task)));
}

/** Static eval gate mirror (RunPromptToolEval): deterministic checks over
 * the review-input definition. Violations come back as findings so the UI
 * can show the governed refusal, and enabling fails with 1001. */
function runReviewInputEval(
  definition: FixtureReviewInput["definition"],
  parameters: Record<string, unknown>,
): KnowledgeEntryEvaluation {
  const findings: string[] = [];
  const template = definition.finding_template;
  const schemaSubsetOk =
    typeof template.finding_key === "string" &&
    template.finding_key !== "" &&
    typeof template.title === "string" &&
    typeof template.message === "string";
  if (!schemaSubsetOk) findings.push("finding template must define finding_key, title and message");
  // Backend RunPromptToolEval validates the template severity only when
  // present (prompttools.go:236-242) — an absent severity is not a gate
  // failure, the template may rely on the whitelist alone.
  const severityOk =
    typeof template.severity !== "string" || definition.severity_whitelist.includes(template.severity);
  if (!severityOk) findings.push("template severity must be inside the tool severity whitelist");
  const text = definition.knowledge_text.toLowerCase();
  const privacyOk = !/(password|api[_-]?key|secret)\s*[:=]/.test(text);
  if (!privacyOk) findings.push("knowledge text must not request credentials or secrets");
  const injectionOk = !/(ignore (all )?previous|disregard .*instructions|reveal .*system prompt)/.test(text);
  if (!injectionOk) findings.push("knowledge text contains a prompt-injection pattern");
  const parameterKeysOk = Object.keys(parameters).every((key) => /^[a-z][a-z0-9_]{0,31}$/.test(key));
  if (!parameterKeysOk) findings.push("parameter keys must match ^[a-z][a-z0-9_]{0,31}$");
  return {
    pass: findings.length === 0,
    schema_subset_ok: schemaSubsetOk,
    privacy_ok: privacyOk,
    injection_ok: injectionOk,
    severity_ok: severityOk,
    findings,
    checked_at: now(),
  };
}

function datasourceView(ds: FixtureDatasource): Datasource {
  const { credentials: _credentials, capabilities: _capabilities, ...view } = ds;
  void _credentials;
  void _capabilities;
  return { ...view };
}

function providerView(provider: FixtureProvider): AiProvider {
  const { apiKey: _apiKey, ...view } = provider;
  void _apiKey;
  return { ...view };
}

function promptToolView(tool: FixturePromptTool): PromptTool {
  return { ...tool };
}

function knowledgeEntryView(entry: FixtureKnowledgeEntry): KnowledgeEntry {
  const { evaluation: _evaluation, ...view } = entry;
  void _evaluation;
  // The write-side optionals (purpose/database_name/table_name) carry null
  // in the fixture world; the declared view shapes them as absent.
  return { ...view } as KnowledgeEntry;
}

function ruleSetView(ruleSet: FixtureRuleSet): RuleSet {
  // rule_sets.rules is structurally an empty object in v4 (pure prompt-tool
  // combination); the fixture keeps no rules content at all.
  return { ...ruleSet, rules: {} };
}

function credentialStatus(ds: FixtureDatasource): Datasource["credential_status"] {
  const status: Record<string, boolean> = {};
  for (const purpose of PURPOSES) {
    status[purpose] = ds.credentials[purpose] !== undefined;
  }
  return status;
}

function touchedCredentialPurposes(ds: FixtureDatasource): void {
  ds.credential_status = credentialStatus(ds);
}

function canonicalSettings(value: SettingsValue): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

function proposedSha256(proposed: SettingsValue): string {
  return configHash(canonicalSettings(proposed)).repeat(8).slice(0, 64);
}

function impactTokenBinding(namespace: string, sha: string, currentVersion: number): string {
  return configHash(namespace, sha, String(currentVersion), "admin-session");
}

function diffChangedPaths(current: SettingsValue, proposed: SettingsValue): string[] {
  const currentMap = current as unknown as Record<string, unknown>;
  const proposedMap = proposed as unknown as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of Object.keys(proposedMap)) {
    if (JSON.stringify(currentMap[key]) !== JSON.stringify(proposedMap[key])) {
      paths.push(`/${key}`);
    }
  }
  return paths;
}

function impactEffectKind(namespace: string): SettingsImpactAssessment["impact"]["effects"][number]["kind"] {
  switch (namespace) {
    case "query":
      return "active_query_grants";
    case "execution":
      return "scheduled_executions";
    case "ai-budget":
      return "running_reviews";
    default:
      return "future_operations";
  }
}

function effectConsequence(
  impact: string,
): SettingsImpactAssessment["impact"]["effects"][number]["consequence"] {
  if (impact === "high" || impact === "immediate") return "applies_immediately";
  if (impact.startsWith("next_")) return "applies_on_next_operation";
  return "unchanged";
}

function assessImpact(
  namespace: string,
  currentVersion: number,
  proposed: SettingsValue,
): SettingsImpactAssessment | null {
  const current = world.settings.get(namespace);
  if (current === undefined) return null;
  const changedPaths = diffChangedPaths(current.settings, proposed);
  const impacts = SETTINGS_FIELD_IMPACT[namespace] ?? {};
  const effects = changedPaths.map((path) => {
    const impact = impacts[path.slice(1)] ?? "next_operation";
    return {
      kind: impactEffectKind(namespace),
      count: 0,
      consequence: effectConsequence(impact),
    };
  });
  const level = changedPaths.some((path) => {
    const impact = impacts[path.slice(1)];
    return impact === "high" || impact === "immediate";
  })
    ? "high"
    : "low";
  const sha = proposedSha256(proposed);
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  // PRD 10 §4.2: the token is bound to namespace + current version +
  // canonical settings hash + admin session, single-use, 300s window.
  const token = `${impactTokenBinding(namespace, sha, currentVersion)}|${String(Date.now() + 300_000)}`;
  world.impactTokens.set(token, sha);
  return {
    namespace: namespace as SettingsImpactAssessment["namespace"],
    current_version: currentVersion,
    proposed_settings_sha256: sha,
    impact: { level, changed_paths: changedPaths, effects },
    impact_token: token,
    expires_at: expiresAt,
  };
}

/** Token binding mirror (VerifyImpactToken): namespace + proposed hash +
 * current version + admin session, single-use, expiring. Any mismatch, an
 * expired token or a consumed token fails the PUT with PRECONDITION_REQUIRED
 * (1011). */
function verifyImpactToken(
  token: string,
  namespace: string,
  proposed: SettingsValue,
  currentVersion: number,
): boolean {
  const parts = token.split("|");
  if (parts.length !== 2) return false;
  const [binding, expiry] = parts;
  if (Number(expiry) < Date.now()) {
    world.impactTokens.delete(token);
    return false;
  }
  const boundSha = world.impactTokens.get(token);
  if (boundSha === undefined) return false;
  // First real execution consumes the token; a replay hits the same guard.
  world.impactTokens.delete(token);
  const proposedSha = proposedSha256(proposed);
  const expected = impactTokenBinding(namespace, proposedSha, currentVersion);
  return boundSha === proposedSha && binding === expected;
}

function validateReviewInputDefinition(definition: unknown): string | null {
  if (typeof definition !== "object" || definition === null) return "definition is required";
  const def = definition as Record<string, unknown>;
  if (typeof def.knowledge_text !== "string" || def.knowledge_text.length === 0) {
    return "knowledge_text is required";
  }
  if (!Array.isArray(def.severity_whitelist) || def.severity_whitelist.length === 0) {
    return "severity_whitelist must not be empty";
  }
  if (typeof def.version !== "number" || def.version < 1) {
    return "definition.version must be a positive integer";
  }
  return null;
}

export function adminFixtureHandlers(): HttpHandler[] {
  return [
    // ---- datasources -------------------------------------------------
    http.get("*/admin/datasources", ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const after = url.searchParams.get("after");
      const items = [...world.datasources.values()].map(datasourceView);
      return HttpResponse.json(successEnvelope(pageOf(items, limit === null ? null : Number(limit), after)));
    }),
    http.post("*/admin/datasources", async ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      const validationError = validateDatasourceWrite(body);
      if (validationError !== null) return businessError(1001, validationError);
      const duplicate = [...world.datasources.values()].some((ds) => ds.name === body.name);
      if (duplicate) return businessError(1005, "datasource name already exists");
      // Create has no stored credentials to reuse from (replaceCredentials
      // resolves reuse against the old rows, which do not exist yet).
      const credentials = body.credentials as CredentialLike[];
      for (const credential of credentials) {
        if (credential.password == null || credential.password.value === "") {
          return businessError(1001, "credential password is required on create");
        }
      }
      const applied = applyCredentialReplacement({}, credentials);
      if (typeof applied === "string") return businessError(1001, applied);
      const ts = now();
      const id = uuid();
      const ds: FixtureDatasource = {
        id,
        name: body.name as string,
        engine: body.engine as Datasource["engine"],
        compatibility_mode: body.compatibility_mode as Datasource["compatibility_mode"],
        deployment_kind: body.deployment_kind as Datasource["deployment_kind"],
        host: typeof body.host === "string" ? body.host : "",
        port: Number(body.port ?? 0),
        database_name: (body.database_name as string | null) ?? null,
        enabled: Boolean(body.enabled),
        credential_status: {},
        referenced_by_flow_count: 0,
        version: 1,
        created_at: ts,
        updated_at: ts,
        credentials: applied,
        capabilities: null,
      };
      touchedCredentialPurposes(ds);
      world.datasources.set(id, ds);
      return HttpResponse.json(successEnvelope(datasourceView(ds)));
    }),
    http.get("*/admin/datasources/:datasourceId", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ds = world.datasources.get(String(params.datasourceId));
      if (ds === undefined) return businessError(1002, "datasource not found");
      return HttpResponse.json(successEnvelope(datasourceView(ds)));
    }),
    http.put("*/admin/datasources/:datasourceId", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ds = world.datasources.get(String(params.datasourceId));
      if (ds === undefined) return businessError(1002, "datasource not found");
      if (versionMismatch(request, ds.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      const validationError = validateDatasourceWrite(body);
      if (validationError !== null) return businessError(1001, validationError);
      const duplicate = [...world.datasources.values()].some(
        (other) => other.id !== ds.id && other.name === body.name,
      );
      if (duplicate) return businessError(1005, "datasource name already exists");
      const applied = applyCredentialReplacement(ds.credentials, body.credentials as CredentialLike[]);
      if (typeof applied === "string") return businessError(1001, applied);
      if (typeof body.name === "string" && body.name !== "") ds.name = body.name;
      ds.engine = body.engine as Datasource["engine"];
      ds.compatibility_mode = body.compatibility_mode as Datasource["compatibility_mode"];
      ds.deployment_kind = body.deployment_kind as Datasource["deployment_kind"];
      if (typeof body.host === "string") ds.host = body.host;
      if (typeof body.port === "number") ds.port = body.port;
      if (typeof body.enabled === "boolean") ds.enabled = body.enabled;
      if ("database_name" in body) ds.database_name = (body.database_name as string | null) ?? null;
      ds.credentials = applied;
      ds.version += 1;
      ds.updated_at = now();
      touchedCredentialPurposes(ds);
      return HttpResponse.json(successEnvelope(datasourceView(ds)));
    }),
    http.delete("*/admin/datasources/:datasourceId", ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ds = world.datasources.get(String(params.datasourceId));
      if (ds === undefined) return businessError(1002, "datasource not found");
      if (versionMismatch(request, ds.version)) return businessError(1004, "version mismatch");
      // Physical delete is only possible for a never-referenced datasource
      // (datasource_delete profile: DATASOURCE_REFERENCED).
      if ((ds.referenced_by_flow_count ?? 0) > 0) {
        return businessError(1107, "datasource is still referenced by flows");
      }
      world.datasources.delete(ds.id);
      return HttpResponse.json(successEnvelope(null));
    }),
    http.post("*/admin/datasources/:datasourceId/connection-tests", async ({ params, request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ds = world.datasources.get(String(params.datasourceId));
      if (ds === undefined) return businessError(1002, "datasource not found");
      const body = (await request.json().catch(() => null)) as { purpose?: string } | null;
      if (body === null || !PURPOSES.includes(body.purpose as (typeof PURPOSES)[number])) {
        return businessError(1001, "connection test purpose is required");
      }
      // A purpose without a configured credential fails the task, exactly as
      // the real probe finishes with credential_missing (service.go:515).
      const credentialMissing = ds.credentials[body.purpose as (typeof PURPOSES)[number]] === undefined;
      return taskResponse(
        "admin_connection_test",
        `/admin/datasources/${ds.id}/capabilities`,
        () => {
          if (credentialMissing) return;
          const ts = now();
          ds.capabilities = {
            datasource_id: ds.id,
            detected_version: ds.engine === "postgresql" ? "16.3" : "8.0.36",
            identity_fingerprint: `${ds.engine}:${ds.name}:inst-stable`,
            capabilities: {
              change_review: true,
              execution: ds.engine !== "postgresql",
              query: true,
              export: true,
              gh_ost: false,
            },
            checked_at: ts,
          };
        },
        credentialMissing,
      );
    }),
    http.get("*/admin/datasources/:datasourceId/capabilities", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ds = world.datasources.get(String(params.datasourceId));
      if (ds === undefined) return businessError(1002, "datasource not found");
      if (ds.capabilities === null) return businessError(1002, "capabilities not probed yet");
      return HttpResponse.json(successEnvelope(ds.capabilities));
    }),

    // ---- ai providers ------------------------------------------------
    http.get("*/admin/ai-providers", () => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      // Declared response is a bare array (ListAiProviders200), ordered by
      // the selection chain rule: selection_priority ascending
      // (provider/chain.go:3) — index 0 is the primary provider.
      const items = [...world.providers.values()]
        .sort((a, b) => a.selection_priority - b.selection_priority)
        .map(providerView);
      return HttpResponse.json(successEnvelope(items));
    }),
    http.post("*/admin/ai-providers", async ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || typeof body.name !== "string" || body.name === "") {
        return businessError(1001, "name is required");
      }
      const duplicate = [...world.providers.values()].some((p) => p.name === body.name);
      if (duplicate) return businessError(1005, "provider name already exists");
      // Create requires an api key (CreateAiProviderRequest Pick<api_key>);
      // the plaintext never reaches any read face.
      const apiKey = body.api_key as { value?: string } | undefined;
      if (apiKey === undefined || typeof apiKey.value !== "string" || apiKey.value === "") {
        return businessError(1001, "api_key is required on create");
      }
      const ts = now();
      const provider: FixtureProvider = {
        id: uuid(),
        name: body.name,
        provider_kind: typeof body.provider_kind === "string" ? body.provider_kind : "openai_compatible",
        base_url: typeof body.base_url === "string" ? body.base_url : "",
        model_name: typeof body.model_name === "string" ? body.model_name : "",
        enabled: Boolean(body.enabled),
        selection_priority: Number(body.selection_priority ?? 100),
        api_key_configured: true,
        version: 1,
        created_at: ts,
        updated_at: ts,
        apiKey: apiKey.value,
      };
      world.providers.set(provider.id, provider);
      return HttpResponse.json(successEnvelope(providerView(provider)));
    }),
    http.get("*/admin/ai-providers/:providerId", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const provider = world.providers.get(String(params.providerId));
      if (provider === undefined) return businessError(1002, "provider not found");
      return HttpResponse.json(successEnvelope(providerView(provider)));
    }),
    http.put("*/admin/ai-providers/:providerId", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const provider = world.providers.get(String(params.providerId));
      if (provider === undefined) return businessError(1002, "provider not found");
      if (versionMismatch(request, provider.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      if (typeof body.name === "string" && body.name !== "") provider.name = body.name;
      if (typeof body.base_url === "string") provider.base_url = body.base_url;
      if (typeof body.model_name === "string") provider.model_name = body.model_name;
      if (typeof body.enabled === "boolean") provider.enabled = body.enabled;
      if (typeof body.selection_priority === "number") provider.selection_priority = body.selection_priority;
      const apiKey = body.api_key as { value?: string } | undefined;
      if (apiKey !== undefined) {
        if (typeof apiKey.value !== "string" || apiKey.value === "") {
          return businessError(1001, "api_key replacement must not be empty");
        }
        provider.apiKey = apiKey.value;
        provider.api_key_configured = true;
      }
      provider.version += 1;
      provider.updated_at = now();
      return HttpResponse.json(successEnvelope(providerView(provider)));
    }),
    http.delete("*/admin/ai-providers/:providerId", ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const provider = world.providers.get(String(params.providerId));
      if (provider === undefined) return businessError(1002, "provider not found");
      if (versionMismatch(request, provider.version)) return businessError(1004, "version mismatch");
      world.providers.delete(provider.id);
      return HttpResponse.json(successEnvelope(null));
    }),
    http.post("*/admin/ai-providers/:providerId/connection-tests", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const provider = world.providers.get(String(params.providerId));
      if (provider === undefined) return businessError(1002, "provider not found");
      return taskResponse("ai_provider_connection_test", `/admin/ai-providers/${provider.id}`, () => {});
    }),

    // ---- settings ----------------------------------------------------
    http.get("*/admin/settings/:namespace", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ns = String(params.namespace);
      const current = world.settings.get(ns);
      if (current === undefined) return businessError(1002, "unknown settings namespace");
      return HttpResponse.json(
        successEnvelope({
          namespace: ns,
          schema_version: 1,
          settings: current.settings,
          version: current.version,
          updated_by: current.updated_by,
          updated_at: current.updated_at,
        }),
      );
    }),
    http.post("*/admin/settings/:namespace/impact-assessments", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ns = String(params.namespace);
      if (world.settings.get(ns) === undefined) return businessError(1002, "unknown settings namespace");
      const body = (await request.json().catch(() => null)) as { settings?: SettingsValue } | null;
      if (body === null || body.settings === undefined) return businessError(1001, "settings are required");
      const current = world.settings.get(ns);
      if (current === undefined) return businessError(1002, "unknown settings namespace");
      const assessment = assessImpact(ns, current.version, body.settings);
      if (assessment === null) return businessError(1002, "unknown settings namespace");
      return HttpResponse.json(successEnvelope(assessment));
    }),
    http.put("*/admin/settings/:namespace", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ns = String(params.namespace);
      const current = world.settings.get(ns);
      if (current === undefined) return businessError(1002, "unknown settings namespace");
      if (versionMismatch(request, current.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as
        | { settings?: SettingsValue; impact_token?: string | null }
        | null;
      if (body === null || body.settings === undefined) return businessError(1001, "settings are required");
      const proposedKeys = Object.keys(body.settings);
      const declaredKeys = Object.keys(DEFAULT_SETTINGS[ns] as object);
      const unknown = proposedKeys.filter((key) => !declaredKeys.includes(key));
      if (unknown.length > 0) return businessError(1001, `unknown settings fields: ${unknown.join(", ")}`);
      const changedPaths = diffChangedPaths(current.settings, body.settings);
      const impacts = SETTINGS_FIELD_IMPACT[ns] ?? {};
      const high = changedPaths.some((path) => {
        const impact = impacts[path.slice(1)];
        return impact === "high" || impact === "immediate";
      });
      if (high) {
        // The server never downgrades a high-impact change because the
        // client skipped the assessment (PRD 10 §4.4); a missing, expired,
        // consumed or mismatched token is PRECONDITION_REQUIRED (1011).
        if (body.impact_token === undefined || body.impact_token === null || body.impact_token === "") {
          return businessError(1011, "impact confirmation required for a high-impact change");
        }
        const valid = verifyImpactToken(body.impact_token, ns, body.settings, current.version);
        if (!valid) return businessError(1011, "impact token invalid, expired or already consumed");
      }
      current.settings = body.settings;
      current.version += 1;
      current.updated_by = SEED_ADMIN_ID;
      current.updated_at = now();
      const revisions = world.revisions.get(ns) ?? [];
      revisions.unshift({
        namespace: ns,
        version: current.version,
        changed_by: SEED_ADMIN_ID,
        changed_at: current.updated_at,
        changed_paths: changedPaths,
        impact_summary: { level: high ? "high" : "low", changed_paths: changedPaths },
      });
      world.revisions.set(ns, revisions);
      return HttpResponse.json(
        successEnvelope({
          namespace: ns,
          schema_version: 1,
          settings: current.settings,
          version: current.version,
          updated_by: current.updated_by,
          updated_at: current.updated_at,
        }),
      );
    }),
    http.get("*/admin/settings/:namespace/schema", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ns = String(params.namespace);
      if (world.settings.get(ns) === undefined) return businessError(1002, "unknown settings namespace");
      return HttpResponse.json(
        successEnvelope({
          namespace: ns,
          schema_version: 1,
          json_schema: { type: "object", additionalProperties: false },
          ui_hints: {},
        }),
      );
    }),
    http.get("*/admin/settings/:namespace/revisions", ({ params, request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ns = String(params.namespace);
      const revisions = world.revisions.get(ns);
      if (revisions === undefined) return businessError(1002, "unknown settings namespace");
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const capped = limit === null ? revisions : revisions.slice(0, Number(limit));
      return HttpResponse.json(
        successEnvelope({
          items: capped,
          page: { next_cursor: null, has_more: false },
        }),
      );
    }),

    // ---- prompt tools (review skills) ---------------------------------
    http.get("*/admin/prompt-tools", ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const after = url.searchParams.get("after");
      const items = [...world.promptTools.values()].map(promptToolView);
      return HttpResponse.json(successEnvelope(pageOf(items, limit === null ? null : Number(limit), after)));
    }),
    http.post("*/admin/prompt-tools", async ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || typeof body.name !== "string" || body.name === "") {
        return businessError(1001, "name is required");
      }
      const duplicate = [...world.promptTools.values()].some((tool) => tool.name === body.name);
      if (duplicate) return businessError(1005, "prompt tool name already exists");
      const definitionError = validateReviewInputDefinition(body.definition);
      if (definitionError !== null) return businessError(1001, definitionError);
      const engine = (body.engine as string | undefined) ?? "all";
      if (!["all", "mysql", "postgresql"].includes(engine)) return businessError(1001, "engine is invalid");
      const state = (body.state as string | undefined) ?? "draft";
      if (!["draft", "enabled", "disabled"].includes(state)) return businessError(1001, "state is invalid");
      const parameters = (body.parameters ?? {}) as Record<string, number | string | boolean | string[]>;
      const definition = body.definition as FixtureReviewInput["definition"];
      if (state === "enabled") {
        const evaluation = runReviewInputEval(definition, parameters);
        if (!evaluation.pass) return businessError(1001, "eval gate failed");
      }
      const ts = now();
      const tool: FixturePromptTool = {
        id: uuid(),
        name: body.name,
        state: state as FixturePromptTool["state"],
        engine: engine as FixturePromptTool["engine"],
        parameters,
        definition,
        // state does not enter the config hash (backend prompttools.go hash
        // covers name+engine+params+definition only).
        config_hash: configHash(body.name, engine, JSON.stringify(definition), JSON.stringify(parameters)),
        version: 1,
        created_at: ts,
        updated_at: ts,
      };
      world.promptTools.set(tool.id, tool);
      return HttpResponse.json(successEnvelope(promptToolView(tool)));
    }),
    http.get("*/admin/prompt-tools/:promptToolId", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const tool = world.promptTools.get(String(params.promptToolId));
      if (tool === undefined) return businessError(1002, "prompt tool not found");
      return HttpResponse.json(successEnvelope(promptToolView(tool)));
    }),
    http.put("*/admin/prompt-tools/:promptToolId", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const tool = world.promptTools.get(String(params.promptToolId));
      if (tool === undefined) return businessError(1002, "prompt tool not found");
      if (versionMismatch(request, tool.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      const definitionError = validateReviewInputDefinition(body.definition);
      if (definitionError !== null) return businessError(1001, definitionError);
      const state = (body.state as string | undefined) ?? tool.state;
      if (!["draft", "enabled", "disabled"].includes(state)) return businessError(1001, "state is invalid");
      const parameters = (body.parameters ?? tool.parameters) as Record<string, number | string | boolean | string[]>;
      const definition = body.definition as FixtureReviewInput["definition"];
      if (state === "enabled") {
        const evaluation = runReviewInputEval(definition, parameters);
        if (!evaluation.pass) return businessError(1001, "eval gate failed");
      }
      tool.state = state as FixturePromptTool["state"];
      tool.engine = ((body.engine as string | undefined) ?? tool.engine) as FixturePromptTool["engine"];
      tool.parameters = parameters;
      tool.definition = definition;
      tool.config_hash = configHash(tool.name, tool.engine, JSON.stringify(definition), JSON.stringify(parameters));
      tool.version += 1;
      tool.updated_at = now();
      return HttpResponse.json(successEnvelope(promptToolView(tool)));
    }),
    http.delete("*/admin/prompt-tools/:promptToolId", ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const tool = world.promptTools.get(String(params.promptToolId));
      if (tool === undefined) return businessError(1002, "prompt tool not found");
      if (versionMismatch(request, tool.version)) return businessError(1004, "version mismatch");
      const referenced = [...world.ruleSets.values()].some((ruleSet) =>
        ruleSet.prompt_tool_ids.includes(tool.id),
      );
      if (referenced) return businessError(1006, "prompt tool is referenced by a rule set");
      world.promptTools.delete(tool.id);
      return HttpResponse.json(successEnvelope(null));
    }),

    // ---- knowledge entries (internal experience) ----------------------
    http.get("*/admin/knowledge-entries", ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const after = url.searchParams.get("after");
      const items = [...world.knowledgeEntries.values()].map(knowledgeEntryView);
      return HttpResponse.json(successEnvelope(pageOf(items, limit === null ? null : Number(limit), after)));
    }),
    http.post("*/admin/knowledge-entries", async ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || typeof body.name !== "string" || body.name === "") {
        return businessError(1001, "name is required");
      }
      const duplicate = [...world.knowledgeEntries.values()].some((entry) => entry.name === body.name);
      if (duplicate) return businessError(1005, "knowledge entry name already exists");
      const scopeType = body.scope_type as string;
      if (!["global", "datasource", "table"].includes(scopeType)) {
        return businessError(1001, "scope_type is invalid");
      }
      if (scopeType !== "global" && typeof body.datasource_id !== "string") {
        return businessError(1001, "datasource_id is required for a scoped entry");
      }
      if (scopeType === "table" && (typeof body.database_name !== "string" || typeof body.table_name !== "string")) {
        return businessError(1001, "database_name and table_name are required for a table-scoped entry");
      }
      const definitionError = validateReviewInputDefinition(body.definition);
      if (definitionError !== null) return businessError(1001, definitionError);
      const state = (body.state as string | undefined) ?? "draft";
      if (!["draft", "enabled", "disabled"].includes(state)) return businessError(1001, "state is invalid");
      const definition = body.definition as FixtureReviewInput["definition"];
      if (state === "enabled") {
        const evaluation = runReviewInputEval(definition, {});
        if (!evaluation.pass) return businessError(1001, "eval gate failed");
      }
      const ts = now();
      const entry: FixtureKnowledgeEntry = {
        id: uuid(),
        name: body.name,
        purpose: (body.purpose as string | undefined) ?? null,
        state: state as FixtureKnowledgeEntry["state"],
        scope_type: scopeType as FixtureKnowledgeEntry["scope_type"],
        datasource_id: (body.datasource_id as string | undefined) ?? null,
        database_name: (body.database_name as string | undefined) ?? null,
        table_name: (body.table_name as string | undefined) ?? null,
        definition,
        provenance: ((body.provenance as string | undefined) ?? "manual") as FixtureKnowledgeEntry["provenance"],
        source_finding_id: (body.source_finding_id as string | undefined) ?? null,
        // Backend knowledge hash covers name+scope定位+definition (entry.go),
        // never the state.
        config_hash: configHash(
          body.name,
          scopeType,
          typeof body.datasource_id === "string" ? body.datasource_id : "",
          typeof body.database_name === "string" ? body.database_name : "",
          typeof body.table_name === "string" ? body.table_name : "",
          JSON.stringify(definition),
        ),
        version: 1,
        created_at: ts,
        updated_at: ts,
        evaluation: null,
      };
      world.knowledgeEntries.set(entry.id, entry);
      return HttpResponse.json(successEnvelope(knowledgeEntryView(entry)));
    }),
    http.get("*/admin/knowledge-entries/:knowledgeEntryId", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const entry = world.knowledgeEntries.get(String(params.knowledgeEntryId));
      if (entry === undefined) return businessError(1002, "knowledge entry not found");
      return HttpResponse.json(successEnvelope(knowledgeEntryView(entry)));
    }),
    http.put("*/admin/knowledge-entries/:knowledgeEntryId", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const entry = world.knowledgeEntries.get(String(params.knowledgeEntryId));
      if (entry === undefined) return businessError(1002, "knowledge entry not found");
      if (versionMismatch(request, entry.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      const definitionError = validateReviewInputDefinition(body.definition);
      if (definitionError !== null) return businessError(1001, definitionError);
      const state = (body.state as string | undefined) ?? entry.state;
      if (!["draft", "enabled", "disabled"].includes(state)) return businessError(1001, "state is invalid");
      const definition = body.definition as FixtureReviewInput["definition"];
      if (state === "enabled") {
        const evaluation = runReviewInputEval(definition, {});
        if (!evaluation.pass) return businessError(1001, "eval gate failed");
      }
      entry.state = state as FixtureKnowledgeEntry["state"];
      entry.purpose = (body.purpose as string | undefined) ?? entry.purpose;
      entry.definition = definition;
      if (typeof body.datasource_id === "string") entry.datasource_id = body.datasource_id;
      if (typeof body.database_name === "string") entry.database_name = body.database_name;
      if (typeof body.table_name === "string") entry.table_name = body.table_name;
      entry.config_hash = configHash(
        entry.name,
        entry.scope_type,
        entry.datasource_id ?? "",
        entry.database_name ?? "",
        entry.table_name ?? "",
        JSON.stringify(definition),
      );
      entry.version += 1;
      entry.updated_at = now();
      entry.evaluation = null;
      return HttpResponse.json(successEnvelope(knowledgeEntryView(entry)));
    }),
    http.delete("*/admin/knowledge-entries/:knowledgeEntryId", ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const entry = world.knowledgeEntries.get(String(params.knowledgeEntryId));
      if (entry === undefined) return businessError(1002, "knowledge entry not found");
      if (versionMismatch(request, entry.version)) return businessError(1004, "version mismatch");
      // Deletion follows the prompt-tool governance: an entry ever frozen by
      // a review run cannot be physically deleted (seed marks converted rows
      // as already referenced).
      if (entry.provenance === "finding_conversion") {
        return businessError(1006, "knowledge entry is referenced by a review run");
      }
      world.knowledgeEntries.delete(entry.id);
      return HttpResponse.json(successEnvelope(null));
    }),
    http.post("*/admin/knowledge-entries/:knowledgeEntryId/evaluations", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const entry = world.knowledgeEntries.get(String(params.knowledgeEntryId));
      if (entry === undefined) return businessError(1002, "knowledge entry not found");
      const evaluation = runReviewInputEval(entry.definition, {});
      entry.evaluation = evaluation;
      return HttpResponse.json(successEnvelope(evaluation));
    }),

    // ---- rule sets ----------------------------------------------------
    http.get("*/admin/rule-sets", ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const after = url.searchParams.get("after");
      const items = [...world.ruleSets.values()].map(ruleSetView);
      return HttpResponse.json(successEnvelope(pageOf(items, limit === null ? null : Number(limit), after)));
    }),
    http.post("*/admin/rule-sets", async ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || typeof body.name !== "string" || body.name === "") {
        return businessError(1001, "name is required");
      }
      const duplicate = [...world.ruleSets.values()].some((ruleSet) => ruleSet.name === body.name);
      if (duplicate) return businessError(1005, "rule set name already exists");
      const toolIds = Array.isArray(body.prompt_tool_ids) ? (body.prompt_tool_ids as string[]) : [];
      for (const toolId of toolIds) {
        if (!world.promptTools.has(toolId)) return businessError(1001, "unknown prompt tool reference");
      }
      const ts = now();
      const ruleSet: FixtureRuleSet = {
        id: uuid(),
        name: body.name,
        enabled: Boolean(body.enabled),
        prompt_tool_ids: toolIds,
        // rule_sets.rules is structurally an empty object in v4: the rule
        // set is a pure prompt-tool combination (ai-review-production PRD).
        config_hash: configHash(body.name, toolIds.join(","), String(Boolean(body.enabled))),
        version: 1,
        created_at: ts,
        updated_at: ts,
      };
      world.ruleSets.set(ruleSet.id, ruleSet);
      return HttpResponse.json(successEnvelope(ruleSetView(ruleSet)));
    }),
    http.get("*/admin/rule-sets/:ruleSetId", ({ params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ruleSet = world.ruleSets.get(String(params.ruleSetId));
      if (ruleSet === undefined) return businessError(1002, "rule set not found");
      return HttpResponse.json(successEnvelope(ruleSetView(ruleSet)));
    }),
    http.put("*/admin/rule-sets/:ruleSetId", async ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ruleSet = world.ruleSets.get(String(params.ruleSetId));
      if (ruleSet === undefined) return businessError(1002, "rule set not found");
      if (versionMismatch(request, ruleSet.version)) return businessError(1004, "version mismatch");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) return businessError(1001, "body is required");
      const toolIds = Array.isArray(body.prompt_tool_ids) ? (body.prompt_tool_ids as string[]) : [];
      for (const toolId of toolIds) {
        if (!world.promptTools.has(toolId)) return businessError(1001, "unknown prompt tool reference");
      }
      if (typeof body.name === "string" && body.name !== "") ruleSet.name = body.name;
      if (typeof body.enabled === "boolean") ruleSet.enabled = body.enabled;
      ruleSet.prompt_tool_ids = toolIds;
      ruleSet.config_hash = configHash(ruleSet.name, toolIds.join(","), String(ruleSet.enabled));
      ruleSet.version += 1;
      ruleSet.updated_at = now();
      return HttpResponse.json(successEnvelope(ruleSetView(ruleSet)));
    }),
    http.delete("*/admin/rule-sets/:ruleSetId", ({ request, params }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const ruleSet = world.ruleSets.get(String(params.ruleSetId));
      if (ruleSet === undefined) return businessError(1002, "rule set not found");
      if (versionMismatch(request, ruleSet.version)) return businessError(1004, "version mismatch");
      const referenced = [...world.flows.values()].some((flow) => flow.rule_set_id === ruleSet.id);
      if (referenced) return businessError(1006, "rule set is referenced by a flow");
      world.ruleSets.delete(ruleSet.id);
      return HttpResponse.json(successEnvelope(null));
    }),

    // ---- flows (read-only reverse-reference source for rule sets) -----
    http.get("*/admin/flows", ({ request }) => {
      const guard = adminGuard();
      if (guard !== null) return guard;
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const after = url.searchParams.get("after");
      const items = [...world.flows.values()];
      return HttpResponse.json(successEnvelope(pageOf(items, limit === null ? null : Number(limit), after)));
    }),
  ];
}

/** Poll seam for tests: expose task timing constants without magic numbers
 * leaking into specs. */
export const ADMIN_FIXTURE_TASK_TIMING = {
  QUEUED_TO_RUNNING_MS: TASK_QUEUED_TO_RUNNING_MS,
  RUNNING_TO_DONE_MS: TASK_RUNNING_TO_DONE_MS,
};

export { PURPOSES as ADMIN_FIXTURE_PURPOSES, SETTING_NAMESPACES as ADMIN_FIXTURE_SETTING_NAMESPACES };

/** Test-only seam: assertions on never-serialized internals (stored
 * credential plaintexts for the reuse semantics, provider key state). */
export function adminFixtureInternals() {
  return {
    datasourceCredentials: (datasourceId: string, purpose: (typeof PURPOSES)[number]) =>
      world.datasources.get(datasourceId)?.credentials[purpose],
    providerApiKey: (providerId: string) => world.providers.get(providerId)?.apiKey,
  };
}

/** Shared task read: the review fixture owns the single `GET /tasks/:id`
 * route and consults this accessor for admin-domain tasks (connection
 * tests) before answering 1002. */
export function adminFixtureTask(taskId: string): FixtureAdminTask | null {
  return world.tasks.get(taskId) ?? null;
}

// Module-scope baseline: the admin pages read persisted configuration, so
// the fixture world is born seeded (tests reseed via resetAdminFixture).
seedAdminFixture();
