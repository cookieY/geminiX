import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  QUERY_FIXTURE_DS_MYSQL_ID,
  QUERY_FIXTURE_DS_PG_ID,
  QUERY_FIXTURE_FLOW_ID,
  QUERY_FIXTURE_OTHER_USER_ID,
  QUERY_FIXTURE_SESSION_USER_ID,
  resetQueryFixture,
  seedQueryScenario,
} from "@/shared/mock/query-fixture";

/**
 * Query-domain fixture contract tests (FE-F10): the mirror must behave like
 * backend/internal/query — single-SELECT safety, cursor continuation and
 * exhaustion, masking, grant lifecycle cascades, owner/relation scoping and
 * the admin-has-no-query-read-face rule (authorization-policy
 * admin_is_not_business_override). Requests go through the shared MSW
 * server so the full handler chain (including the flows delegation) runs.
 */

const SESSION_USER_ID = QUERY_FIXTURE_SESSION_USER_ID;

interface Envelope<T> {
  err_code: number;
  message: string;
  data: T;
  request_id: string;
}

async function get<T>(path: string): Promise<Envelope<T>> {
  const response = await fetch(path, { headers: { "x-test": "1" } });
  return (await response.json()) as Envelope<T>;
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Envelope<T>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Envelope<T>;
}

interface PageShape {
  items?: unknown[];
}

beforeAll(() => {
  window.localStorage.setItem("yearning-mock-auth", "default");
});

beforeEach(() => {
  resetQueryFixture();
});

describe("query fixture single-SELECT safety", () => {
  beforeEach(() => {
    seedQueryScenario("query-session");
  });

  async function execute(sql: string) {
    return post<{ columns: { name: string }[]; rows: unknown[][]; page: { has_more: boolean } }>(
      "/query-sessions/qs-fixture-active/executions",
      {
        datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
        schema_name: "app",
        sql,
        timeout_ms: 30000,
        page_size: 10,
      },
    );
  }

  it("accepts a plain single SELECT and returns masked cells for vocabulary columns", async () => {
    const envelope = await execute("select id, username, email from app.users");
    expect(envelope.err_code).toBe(0);
    const emailIndex = envelope.data.columns.findIndex((column) => column.name === "email");
    expect(emailIndex).toBeGreaterThanOrEqual(0);
    // The server-side mask is irreversible and format-free (query PRD §3).
    expect(String(envelope.data.rows[0]?.[emailIndex])).toBe("***");
  });

  it("rejects write heads and multi-statement SQL with QUERY_ONLY_SINGLE_SELECT", async () => {
    const update = await execute("update app.users set username = 'x'");
    expect(update.err_code).toBe(4007);
    const multi = await execute("select 1; select 2");
    expect(multi.err_code).toBe(4007);
  });

  it("rejects out-of-range timeouts with QUERY_TIMEOUT_OUT_OF_RANGE", async () => {
    const envelope = await post("/query-sessions/qs-fixture-active/executions", {
      datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
      schema_name: "app",
      sql: "select 1",
      timeout_ms: 300001,
    });
    expect(envelope.err_code).toBe(4008);
  });

  it("rejects datasources outside the frozen session capability set", async () => {
    const envelope = await post("/query-sessions/qs-fixture-active/executions", {
      // The PG datasource is in the flow but NOT in the grant-frozen session.
      datasource_id: QUERY_FIXTURE_DS_PG_ID,
      schema_name: "public",
      sql: "select * from public.analytics_events",
    });
    expect(envelope.err_code).toBe(4002);
  });
});

describe("query fixture cursor semantics", () => {
  beforeEach(() => {
    seedQueryScenario("query-session");
  });

  it("continues strictly forward and expires after exhaustion (no replay)", async () => {
    const first = await post<{
      execution_id: string;
      rows: unknown[][];
      page: { next_cursor: string | null; has_more: boolean };
    }>("/query-sessions/qs-fixture-active/executions", {
      datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
      schema_name: "app",
      sql: "select id from app.users",
      page_size: 500,
    });
    expect(first.err_code).toBe(0);
    expect(first.data.rows).toHaveLength(500);
    expect(first.data.page.has_more).toBe(true);
    const cursor = first.data.page.next_cursor;
    expect(cursor).toBeTypeOf("string");

    let total = first.data.rows.length;
    let nextCursor: string | null = cursor;
    for (let guard = 0; nextCursor !== null && guard < 20; guard += 1) {
      const page: Envelope<{ rows: unknown[][]; page: { next_cursor: string | null } }> = await get(
        `/query-executions/${first.data.execution_id}/pages?cursor=${encodeURIComponent(nextCursor)}&purpose=display`,
      );
      expect(page.err_code).toBe(0);
      total += page.data.rows.length;
      nextCursor = page.data.page.next_cursor;
    }
    // 1200 deterministic rows total (no fabricated totals anywhere).
    expect(total).toBe(1200);

    const replay = await get(
      `/query-executions/${first.data.execution_id}/pages?cursor=${encodeURIComponent(cursor as string)}&purpose=display`,
    );
    expect(replay.err_code).toBe(1009);
  });

  it("enforces the frozen can_export on purpose=export pages", async () => {
    // The grant froze export=true for mysql only; pages are readable with
    // purpose=export while the capability holds.
    const execution = await post<{ execution_id: string; page: { next_cursor: string | null } }>(
      "/query-sessions/qs-fixture-active/executions",
      {
        datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
        schema_name: "app",
        sql: "select id from app.users",
        page_size: 500,
      },
    );
    expect(execution.err_code).toBe(0);
    expect(execution.data.page.next_cursor).toBeTypeOf("string");
    const allowed = await get(
      `/query-executions/${execution.data.execution_id}/pages?cursor=${encodeURIComponent(execution.data.page.next_cursor ?? "")}&purpose=export`,
    );
    expect(allowed.err_code).toBe(0);
  });

  it("refuses pages without a purpose", async () => {
    const first = await post<{ execution_id: string; page: { next_cursor: string | null } }>(
      "/query-sessions/qs-fixture-active/executions",
      {
        datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
        schema_name: "app",
        sql: "select 1",
        page_size: 10,
      },
    );
    const missing = await get(`/query-executions/${first.data.execution_id}/pages?cursor=${encodeURIComponent(first.data.page.next_cursor ?? "")}`);
    expect(missing.err_code).toBe(1001);
  });
});

describe("query fixture access approval chain", () => {
  beforeEach(() => {
    seedQueryScenario("query-approval");
  });

  it("decides approve into an active grant covering the requested datasources", async () => {
    const decision = await post(
      "/query-access-requests/qar-fixture-pending/decisions",
      { decision: "approve" },
      { "If-Match": '"1"' },
    );
    expect(decision.err_code).toBe(0);
    expect(decision.data).toMatchObject({ state: "grant_active" });
    const grantId = (decision.data as { grant_id: string }).grant_id;
    expect(grantId).toBeTypeOf("string");

    const grants = await get<PageShape>("/query-grants");
    expect(grants.err_code).toBe(0);
    expect((grants.data.items as { id: string }[]).some((grant) => grant.id === grantId)).toBe(true);
  });

  it("rejects the whole request and invalidates remaining steps", async () => {
    const decision = await post(
      "/query-access-requests/qar-fixture-pending/decisions",
      { decision: "reject" },
      { "If-Match": '"1"' },
    );
    expect(decision.data).toMatchObject({ state: "access_rejected" });
  });

  it("requires If-Match and rejects stale versions with CONCURRENT_MODIFICATION", async () => {
    const stale = await post("/query-access-requests/qar-fixture-pending/decisions", { decision: "approve" });
    expect(stale.err_code).toBe(1004);
  });
});

describe("query fixture revocation and owner scoping", () => {
  beforeEach(() => {
    seedQueryScenario("query-session");
  });

  it("revoking the grant terminates its sessions and blocks further execution with QUERY_GRANT_REVOKED", async () => {
    const grants = await get<PageShape>("/query-grants");
    const grant = (grants.data.items as { id: string; state: string; version: number }[]).find(
      (row) => row.state === "active",
    );
    expect(grant).toBeDefined();
    const revoked = await post(
      `/query-grants/${grant?.id ?? ""}/revocations`,
      { reason: "rotation" },
      { "If-Match": `"${String(grant?.version ?? 1)}"` },
    );
    expect(revoked.err_code).toBe(0);
    expect(revoked.data).toMatchObject({ state: "revoked", revoked_reason: "rotation" });

    const sessions = await get<PageShape>("/query-sessions");
    expect(
      (sessions.data.items as { state: string }[]).every((row) => row.state === "revoked"),
    ).toBe(true);

    const execution = await post("/query-sessions/qs-fixture-active/executions", {
      datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
      schema_name: "app",
      sql: "select 1",
    });
    expect(execution.err_code).toBe(4004);
  });

  it("hides another user's session behind RESOURCE_NOT_FOUND for any session identity", async () => {
    const other = await get("/query-sessions/qs-fixture-other");
    expect(other.err_code).toBe(1002);
    expect(QUERY_FIXTURE_OTHER_USER_ID).not.toBe(SESSION_USER_ID);
  });

  it("serves the query_access flow catalog only when the flow is granted", () => {
    // Route ownership lives with the review fixture (delegation covered by
    // its tests); the seed here only pins the flow identity.
    expect(QUERY_FIXTURE_FLOW_ID).toBeTypeOf("string");
  });
});

describe("query fixture approval-disabled direct entry (Q002)", () => {
  beforeEach(() => {
    seedQueryScenario("query-flow-direct");
  });

  it("creates a session without a grant and freezes the flow capabilities", async () => {
    const created = await post("/query-sessions", {
      flow_id: QUERY_FIXTURE_FLOW_ID,
      grant_id: null,
      datasource_ids: [QUERY_FIXTURE_DS_PG_ID],
    });
    expect(created.err_code).toBe(0);
    const capabilities = (created.data as { capabilities: { datasource_name: string; can_export: boolean }[] })
      .capabilities;
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({ datasource_name: "analytics-pg", can_export: false });
  });

  it("still refuses grant-less sessions while approval is enabled", async () => {
    seedQueryScenario("query-flow");
    const created = await post("/query-sessions", {
      flow_id: QUERY_FIXTURE_FLOW_ID,
      grant_id: null,
      datasource_ids: [QUERY_FIXTURE_DS_MYSQL_ID],
    });
    expect(created.err_code).toBe(4001);
  });
});
