import { describe, expect, it } from "vitest";
import type { ChangeOrder } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  executionAttemptTone,
  frozenExecutorStageFor,
  statementStateTone,
} from "./order-state";
import { FIXTURE_OWNER_ID } from "@/shared/mock/review-fixture";

/**
 * Pure presentation derivations for the execution workspace (FE-F8): the
 * frozen-executor gate mirrors W006 (admin gains no execution right — the
 * membership check is against the frozen stage snapshot only), and the tone
 * mappings keep `unknown` visually distinct from `not_started` (E005).
 */

function orderWithExecutor(
  overrides: Partial<ChangeOrder> = {},
  executorIds: string[] = [FIXTURE_OWNER_ID],
): ChangeOrder {
  const user = (id: string) => ({
    id,
    username: "u",
    display_name: "u",
    email: null,
    is_builtin_admin: false,
    version: 1,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  });
  return {
    id: "aa6f1a2b-0000-4000-8000-00000000aa01",
    display_number: "YR-20260830-000501",
    submitter_user_id: FIXTURE_OWNER_ID,
    state: "stage_execution_pending",
    stages: [
      {
        id: "aa6f1a2b-0000-4000-8000-00000000aa11",
        position: 1,
        datasource_name: "orders-mysql",
        state: "execution_pending",
        approval_steps: [],
        execution_actors: executorIds.map(user),
      },
    ],
    has_sql: true,
    version: 1,
    submitted_at: "2026-08-30T11:00:00Z",
    ...overrides,
  } as unknown as ChangeOrder;
}

describe("frozenExecutorStageFor", () => {
  it("returns the execution_pending stage only for a frozen member of it", () => {
    const order = orderWithExecutor();
    const stage = frozenExecutorStageFor(order, FIXTURE_OWNER_ID);
    expect(stage?.id).toBe("aa6f1a2b-0000-4000-8000-00000000aa11");
  });

  it("rejects non-members, anonymous sessions and non-waiting states", () => {
    const order = orderWithExecutor({}, ["1111d9cc-e65d-7b9d-a8aa-3c81945f99ac"]);
    expect(frozenExecutorStageFor(order, FIXTURE_OWNER_ID)).toBeNull();
    expect(frozenExecutorStageFor(order, undefined)).toBeNull();
    expect(
      frozenExecutorStageFor(
        orderWithExecutor({ state: "stage_approval_active" }),
        FIXTURE_OWNER_ID,
      ),
    ).toBeNull();
    // A stage no longer waiting (already scheduled) yields no executor stage.
    const scheduledOrder = orderWithExecutor();
    const waitingStage = scheduledOrder.stages[0];
    if (waitingStage === undefined) throw new Error("seed stage missing");
    waitingStage.state = "scheduled";
    expect(frozenExecutorStageFor(scheduledOrder, FIXTURE_OWNER_ID)).toBeNull();
  });
});

describe("execution tone mappings", () => {
  it("tones attempt states: terminal outcomes, live progress and unknown", () => {
    expect(executionAttemptTone("succeeded")).toBe("emerald");
    expect(executionAttemptTone("failed")).toBe("red");
    expect(executionAttemptTone("partial_failed")).toBe("rose");
    expect(executionAttemptTone("result_unknown")).toBe("orange");
    expect(executionAttemptTone("cancelled")).toBe("stone");
    expect(executionAttemptTone("partial_cancelled")).toBe("rose");
    expect(executionAttemptTone("created")).toBe("indigo");
    expect(executionAttemptTone("preflight")).toBe("indigo");
    expect(executionAttemptTone("running")).toBe("indigo");
    expect(executionAttemptTone("cancelling")).toBe("indigo");
    expect(executionAttemptTone("mystery")).toBe("stone");
  });

  it("tones statement states: unknown is orange, skipped and not_started stone", () => {
    expect(statementStateTone("succeeded")).toBe("emerald");
    expect(statementStateTone("failed")).toBe("red");
    expect(statementStateTone("unknown")).toBe("orange");
    expect(statementStateTone("cancelled")).toBe("stone");
    expect(statementStateTone("sent")).toBe("sky");
    expect(statementStateTone("not_started")).toBe("stone");
    expect(statementStateTone("skipped")).toBe("stone");
    expect(statementStateTone("mystery")).toBe("stone");
  });
});
