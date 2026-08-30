import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetReviewFixture,
} from "./review-fixture";
import { setMockAuthBehavior } from "./auth-scenario-store";
import {
  readStoredScenario,
  useMockScenario,
  type MockScenario,
} from "./scenario-store";
import { createMockEventTransport } from "./review-fixture";

/**
 * Behavior-matrix tests for the stateful fixture: every review scenario
 * outcome (Ready/Blocked/Partial/Provider失败) produces the exact run
 * shape, gate reasons and failure codes the acceptance-gate E2E asserts
 * on, and the mock event transport replays the outbox with per-subject
 * sequence semantics (at-least-once with resume points).
 */

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";

const scenarioByBehavior: Record<string, MockScenario> = {
  ready: "review-ready",
  blocked: "review-blocked",
  partial: "review-partial",
  provider_failed: "review-provider-failed",
};

async function createAndRunToTerminal(): Promise<{ draftId: string; runId: string }> {
  const create = (await (
    await fetch("https://yearning.test/change-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "行为矩阵" }),
    })
  ).json()) as { data: { id: string } };
  const draftId = create.data.id;
  await fetch(`https://yearning.test/change-drafts/${draftId}/sql`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT 1;" }),
  });
  const run = (await (
    await fetch(`https://yearning.test/change-drafts/${draftId}/review-runs`, {
      method: "POST",
    })
  ).json()) as { data: { id: string; result_ref: string | null } };
  const runId = run.data.result_ref?.split("/").pop() ?? "";
  // Fixture timeline: queued → (400ms) → running → (900ms) → terminal.
  await new Promise((resolve) => {
    setTimeout(resolve, 1_600);
  });
  return { draftId, runId };
}

describe("review fixture behavior matrix", () => {
  beforeEach(() => {
    setMockAuthBehavior("admin");
    resetReviewFixture();
  });
  afterEach(() => {
    resetReviewFixture();
    useMockScenario.getState().setScenario("ready");
  });

  for (const [behavior, scenario] of Object.entries(scenarioByBehavior)) {
    it(`produces the ${behavior} run shape under scenario ${scenario}`, async () => {
      useMockScenario.getState().setScenario(scenario);
      expect(readStoredScenario()).toBe(scenario);
      const { draftId, runId } = await createAndRunToTerminal();
      expect(runId).not.toBe("");

      const run = (await (
        await fetch(`https://yearning.test/review-runs/${runId}`)
      ).json()) as {
        data: {
          state: string;
          gate: { passed: boolean; reason_codes: string[] };
          failure_code: string | null;
        } | null;
      };
      expect(run.data).not.toBeNull();

      if (behavior === "ready") {
        expect(run.data?.state).toBe("ready");
        expect(run.data?.gate.passed).toBe(true);
        expect(run.data?.gate.reason_codes).toEqual([]);
        expect(run.data?.failure_code).toBeNull();
      } else if (behavior === "blocked") {
        expect(run.data?.state).toBe("blocked");
        expect(run.data?.gate.reason_codes).toContain("stage_review_blocked");
        expect(run.data?.gate.reason_codes).toContain("critical_severity_finding");
      } else if (behavior === "partial") {
        expect(run.data?.state).toBe("partial");
        expect(run.data?.gate.reason_codes).toEqual(["stage_review_incomplete"]);
        expect(run.data?.failure_code).toBe("budget_exhausted");
      } else {
        expect(run.data?.state).toBe("failed");
        expect(run.data?.failure_code).toBe("provider_unavailable");
      }

      // The draft mirrors the run's terminal state.
      const draft = (await (
        await fetch(`https://yearning.test/change-drafts/${draftId}`)
      ).json()) as { data: { state: string } };
      expect(draft.data.state).toBe(run.data?.state);
    });
  }

  it("replays outbox events through the mock transport with sequence order", async () => {
    useMockScenario.getState().setScenario("review-ready");
    const { draftId, runId } = await createAndRunToTerminal();
    // A second SQL save voids the ready result and emits a second draft
    // event (review_inputs_changed) — only terminal transitions emit events.
    await fetch(`https://yearning.test/change-drafts/${draftId}/sql`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 2;" }),
    });

    const received: Array<{ subject: string; sequence: number }> = [];
    const transport = createMockEventTransport({});
    for await (const raw of transport) {
      const event = raw as { subject: string; sequence: number };
      received.push({ subject: event.subject, sequence: event.sequence });
      // One run event + two draft events make the full outbox.
      if (received.length >= 3) break;
    }
    const runEvents = received.filter((entry) => entry.subject === `review-runs/${runId}`);
    const draftEvents = received.filter((entry) => entry.subject === `change-drafts/${draftId}`);
    expect(runEvents.length).toBe(1);
    expect(draftEvents.length).toBe(2);
    // Per-subject sequences strictly increase (events README).
    for (const [index, entry] of draftEvents.entries()) {
      if (index > 0) {
        expect(entry.sequence).toBeGreaterThan(draftEvents[index - 1]?.sequence ?? 0);
      }
    }
    // A fresh transport seeded with a resume cursor re-feeds only later
    // events for that subject — the reconnect semantics the client relies on.
    const subject = draftEvents[0]?.subject ?? "";
    const resume = { [subject]: draftEvents[0]?.sequence ?? 1 };
    const replayTransport = createMockEventTransport(resume);
    const replay: Array<{ subject: string; sequence: number }> = [];
    for await (const raw of replayTransport) {
      const event = raw as { subject: string; sequence: number };
      if (event.subject === subject) {
        replay.push(event);
        break;
      }
      if (replay.length > 10) break;
    }
    expect(replay[0]?.sequence).toBeGreaterThan(resume[subject] ?? 0);
  });
});
