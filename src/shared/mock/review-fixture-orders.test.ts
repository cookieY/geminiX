import { afterEach, describe, expect, it } from "vitest";
import type { FixtureOrder } from "./review-fixture";
import {
  FIXTURE_FLOW_ID,
  FIXTURE_OWNER_ID,
  resetReviewFixture,
  seedFixtureOrder,
} from "./review-fixture";

/**
 * Change-order fixture contract tests (frontend PRD F6). The lifecycle tests
 * pin the semantics the order pages and the acceptance gates rely on: the
 * submission persists an order and emits its event, the list is a cursor
 * page, withdrawal follows the change_order state machine (running →
 * withdrawn_after_partial_execution), voidance only from legal states, the
 * timeline is the audit projection and reason is mandatory.
 */

afterEach(() => {
  resetReviewFixture();
});

interface Envelope<T> {
  err_code: number;
  message: string;
  data: T;
}

async function jsonRequest(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Envelope<Record<string, unknown>> }> {
  const response = await fetch(`https://yearning.test${path}`, init);
  return {
    status: response.status,
    body: (await response.json()) as Envelope<Record<string, unknown>>,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function seedOrder(overrides: Partial<FixtureOrder> = {}): FixtureOrder {
  const order: FixtureOrder = {
    id: "8a6f1a2b-0000-4000-8000-00000000ab01",
    display_number: "YR-20260830-000007",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "夹具工单",
    state: "submitted",
    current_stage_position: 1,
    stages: [
      {
        id: "8a6f1a2b-0000-4000-8000-00000000ab11",
        position: 1,
        datasource_name: "orders-mysql",
        state: "approval_active",
        approval_steps: [{ position: 1, actors: [{ user_id: FIXTURE_OWNER_ID }], state: "pending" }],
        execution_actors: [
          {
            id: FIXTURE_OWNER_ID,
            username: "henry",
            display_name: "henry",
            email: null,
            is_builtin_admin: true,
            version: 1,
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          },
        ],
      },
    ],
    has_sql: true,
    sql_hash: "hash-1",
    snapshot_hash: "snap-1",
    manually_verified: false,
    version: 1,
    submitted_at: "2026-08-30T10:00:00Z",
    terminal_at: null,
  };
  return { ...order, ...overrides };
}

describe("change-order fixture contract", () => {
  it("seeds a running order for the partial-execution scenario via the list endpoint", async () => {
    localStorage.setItem("yearning-mock-scenario", "order-partial-execution");
    const list = await jsonRequest("/change-orders");
    expect(list.body.err_code).toBe(0);
    const items = list.body.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.state).toBe("running");
    localStorage.removeItem("yearning-mock-scenario");
  });

  it("withdraws a submitted order to withdrawn and appends a timeline entry", async () => {
    seedFixtureOrder(seedOrder());
    const result = await jsonRequest(
      `/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/withdrawal`,
      post({ reason: "不再需要" }, { "If-Match": '"1"' }),
    );
    expect(result.body.err_code).toBe(0);
    expect(result.body.data.state).toBe("withdrawn");
    expect(result.body.data.terminal_at).not.toBeNull();

    const timeline = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/timeline",
    );
    const entries = timeline.body.data.items as Array<Record<string, unknown>>;
    expect(entries.length).toBe(1);
    expect(entries[0]?.event_type).toBe("change_order.withdrawn");
  });

  it("maps withdrawal from a running order to withdrawn_after_partial_execution", async () => {
    seedFixtureOrder(seedOrder({ state: "running", version: 3 }));
    const result = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/withdrawal",
      post({ reason: "停" }, { "If-Match": '"3"' }),
    );
    expect(result.body.err_code).toBe(0);
    expect(result.body.data.state).toBe("withdrawn_after_partial_execution");
  });

  it("refuses withdrawal from a terminal state with 1010 and rejects a version mismatch with 1004", async () => {
    seedFixtureOrder(seedOrder({ state: "completed" }));
    const illegal = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/withdrawal",
      post({ reason: "x" }, { "If-Match": '"1"' }),
    );
    expect(illegal.body.err_code).toBe(1010);

    seedFixtureOrder(
      seedOrder({ id: "8a6f1a2b-0000-4000-8000-00000000ab02" }),
    );
    const conflict = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab02/withdrawal",
      post({ reason: "x" }, { "If-Match": '"9"' }),
    );
    // order_lifecycle profile: concurrent modification on withdrawal is
    // 1004 (1003 belongs to the draft revision profiles).
    expect(conflict.body.err_code).toBe(1004);
  });

  it("requires a non-empty reason for withdrawal and voidance", async () => {
    seedFixtureOrder(seedOrder());
    const empty = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/withdrawal",
      post({ reason: "   " }, { "If-Match": '"1"' }),
    );
    expect(empty.body.err_code).toBe(1001);

    seedFixtureOrder(seedOrder({ id: "8a6f1a2b-0000-4000-8000-00000000ab03", state: "result_unknown" }));
    const emptyVoid = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab03/voidance",
      post({ reason: "" }, { "If-Match": '"1"' }),
    );
    expect(emptyVoid.body.err_code).toBe(1001);
  });

  it("voids from legal states and refuses voidance from running", async () => {
    seedFixtureOrder(seedOrder({ state: "result_unknown" }));
    const ok = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/voidance",
      post({ reason: "结果未知，作废" }, { "If-Match": '"1"' }),
    );
    expect(ok.body.err_code).toBe(0);
    expect(ok.body.data.state).toBe("voided");

    seedFixtureOrder(seedOrder({ id: "8a6f1a2b-0000-4000-8000-00000000ab04", state: "running" }));
    const illegal = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab04/voidance",
      post({ reason: "x" }, { "If-Match": '"1"' }),
    );
    expect(illegal.body.err_code).toBe(1010);
  });

  it("copies a terminal order into a fresh draft on a granted flow", async () => {
    seedFixtureOrder(seedOrder({ state: "withdrawn" }));
    const copy = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/draft-copies",
      post({ target_flow_id: FIXTURE_FLOW_ID, title: "重新编辑副本" }),
    );
    expect(copy.body.err_code).toBe(0);
    const draft = copy.body.data;
    expect(draft.state).toBe("draft");
    expect(draft.has_sql).toBe(false);

    const revoke = await jsonRequest(
      "/change-orders/8a6f1a2b-0000-4000-8000-00000000ab01/draft-copies",
      post({ target_flow_id: "other-flow", title: "x" }),
    );
    expect(revoke.body.err_code).toBe(2014);
  });

  it("orders the personal list newest first as a cursor page", async () => {
    seedFixtureOrder(
      seedOrder({ id: "8a6f1a2b-0000-4000-8000-00000000ab0a", submitted_at: "2026-08-30T08:00:00Z" }),
    );
    seedFixtureOrder(
      seedOrder({
        id: "8a6f1a2b-0000-4000-8000-00000000ab0b",
        display_number: "YR-20260830-000008",
        submitted_at: "2026-08-30T09:00:00Z",
      }),
    );
    const first = await jsonRequest("/change-orders?limit=1");
    const page = first.body.data as { items: Array<Record<string, unknown>>; page: { next_cursor: string | null } };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe("8a6f1a2b-0000-4000-8000-00000000ab0b");
    expect(page.page.next_cursor).toBe("8a6f1a2b-0000-4000-8000-00000000ab0b");

    const second = await jsonRequest(
      `/change-orders?limit=1&after=${String(page.page.next_cursor)}`,
    );
    const secondPage = second.body.data as { items: Array<Record<string, unknown>>; page: { has_more: boolean } };
    expect(secondPage.items[0]?.id).toBe("8a6f1a2b-0000-4000-8000-00000000ab0a");
    expect(secondPage.page.has_more).toBe(false);
  });
});
