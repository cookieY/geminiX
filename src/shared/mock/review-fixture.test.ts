import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FIXTURE_FLOW_ID,
  FIXTURE_RAW_EVIDENCE_MARKER,
  resetReviewFixture,
} from "./review-fixture";
import { setMockAuthBehavior } from "./auth-scenario-store";

/**
 * The fixture owns GET /users/me/flows for the mock layer: the zero-
 * permission contract (auth PRD §11) derives from the auth behavior, and a
 * granted session sees the change flow for the precheck workspace. The
 * lifecycle tests pin the contract semantics the E2E relies on — revision
 * increments, run progression to a terminal state, the submission gate
 * failure code and the audited/watermarked raw-reveal envelope.
 *
 * The shared global MSW server (setup.ts) already registers the fixture via
 * baseHandlers; a second in-file server would double-intercept requests.
 */

afterEach(() => {
  resetReviewFixture();
});

interface FixtureDraftView {
  id: string;
  revision: number;
  state: string;
  has_sql: boolean;
}

async function createDraft(): Promise<FixtureDraftView> {
  const response = await fetch("https://yearning.test/change-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flow_id: FIXTURE_FLOW_ID, title: "夹具草稿" }),
  });
  return ((await response.json()) as { data: FixtureDraftView }).data;
}

async function saveSql(draftId: string, sql: string): Promise<FixtureDraftView> {
  const response = await fetch(`https://yearning.test/change-drafts/${draftId}/sql`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  return ((await response.json()) as { data: FixtureDraftView }).data;
}

async function runReview(draftId: string): Promise<string> {
  const response = await fetch(
    `https://yearning.test/change-drafts/${draftId}/review-runs`,
    { method: "POST" },
  );
  const body = (await response.json()) as { data: { id: string; result_ref: string | null } | null };
  if (body.data === null) {
    throw new Error(`review-runs POST failed: ${JSON.stringify(body)}`);
  }
  // The POST returns the async Task; its result_ref points at the Review Run
  // (ai-review-production-prd.md §13) — that resource is what the workspace reads.
  const runId = body.data.result_ref?.split("/").pop();
  if (runId === undefined || runId === "") {
    throw new Error(`task carries no result_ref: ${JSON.stringify(body)}`);
  }
  return runId;
}

async function runToTerminal(draftId: string): Promise<string> {
  const runId = await runReview(draftId);
  // Fixture timeline: queued → (400ms) → running → (900ms) → terminal.
  // Real timers only: fake timers stall the undici/MSW network stack.
  await new Promise((resolve) => {
    setTimeout(resolve, 1_600);
  });
  return runId;
}

describe("review fixture flow catalog", () => {
  beforeEach(() => {
    setMockAuthBehavior("default");
  });

  it("returns an empty page for the zero-permission default session", async () => {
    const response = await fetch("https://yearning.test/users/me/flows?flow_type=change_review");
    const body = (await response.json()) as { data: { items: unknown[]; page: { has_more: boolean } } };
    expect(body.data.items).toEqual([]);
    expect(body.data.page.has_more).toBe(false);
  });

  it("grants the change flow to an admin session", async () => {
    setMockAuthBehavior("admin");
    const response = await fetch("https://yearning.test/users/me/flows?flow_type=change_review");
    const body = (await response.json()) as { data: { items: Array<{ id: string; flow_type: string }> } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.id).toBe(FIXTURE_FLOW_ID);
  });

  it("returns an empty page for query_access flow type", async () => {
    setMockAuthBehavior("admin");
    const response = await fetch("https://yearning.test/users/me/flows?flow_type=query_access");
    const body = (await response.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toEqual([]);
  });
});

describe("review fixture draft and run lifecycle", () => {
  beforeEach(() => {
    setMockAuthBehavior("admin");
  });

  it("creates a draft and increments the revision on each SQL save", async () => {
    const draft = await createDraft();
    expect(draft.state).toBe("draft");
    expect(draft.revision).toBe(1);
    const saved = await saveSql(draft.id, "SELECT 1;");
    expect(saved.revision).toBe(2);
    expect(saved.has_sql).toBe(true);
  });

  it("advances the run to the ready terminal state and voids it on edit", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    const runId = await runToTerminal(draft.id);

    const finished = (await (
      await fetch(`https://yearning.test/review-runs/${runId}`)
    ).json()) as { data: { state: string; gate: { passed: boolean }; draft_revision: number } };
    expect(finished.data.state).toBe("ready");
    expect(finished.data.gate.passed).toBe(true);
    expect(finished.data.draft_revision).toBe(2);

    // Editing a ready draft voids the result server-side (review_inputs_changed).
    const edit = await saveSql(draft.id, "SELECT 2;");
    expect(edit.state).toBe("outdated");
  });

  it("rejects submission with SUBMISSION_GATE_FAILED when no ready run exists", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "DROP TABLE orders;");
    const response = await fetch(
      `https://yearning.test/change-drafts/${draft.id}/submission`,
      { method: "POST" },
    );
    const body = (await response.json()) as { err_code: number };
    // draft_submit profile: 2013 SUBMISSION_GATE_FAILED, never a fake success.
    expect(body.err_code).toBe(2013);
  });

  it("succeeds submission for a ready draft and freezes the order", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    await runToTerminal(draft.id);
    const response = await fetch(
      `https://yearning.test/change-drafts/${draft.id}/submission`,
      { method: "POST" },
    );
    const body = (await response.json()) as {
      data: { display_number: string; state: string; snapshot_hash: string } | null;
    };
    expect(body.data?.display_number).toMatch(/^YR-/);
    expect(body.data?.state).toBe("submitted");
    expect(body.data?.snapshot_hash).not.toBe("");
  });

  it("enforces If-Match optimistic concurrency on SQL, run and submission", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    const stale = { "If-Match": '"1"' };
    const put = await fetch(`https://yearning.test/change-drafts/${draft.id}/sql`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...stale },
      body: JSON.stringify({ sql: "SELECT 2;" }),
    });
    expect(((await put.json()) as { err_code: number }).err_code).toBe(1003);

    const runPost = await fetch(
      `https://yearning.test/change-drafts/${draft.id}/review-runs`,
      { method: "POST", headers: stale },
    );
    expect(((await runPost.json()) as { err_code: number }).err_code).toBe(1003);

    const submit = await fetch(
      `https://yearning.test/change-drafts/${draft.id}/submission`,
      { method: "POST", headers: stale },
    );
    expect(((await submit.json()) as { err_code: number }).err_code).toBe(1003);
  });

  it("rejects a review run started from a ready draft (run_review illegal from ready)", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    const first = (await (
      await fetch(`https://yearning.test/change-drafts/${draft.id}/review-runs`, {
        method: "POST",
      })
    ).json()) as { data: { id: string } | null };
    expect(first.data).not.toBeNull();
    // wait for terminal: ready
    await new Promise((resolve) => {
      setTimeout(resolve, 1_600);
    });
    const second = (await (
      await fetch(`https://yearning.test/change-drafts/${draft.id}/review-runs`, {
        method: "POST",
      })
    ).json()) as { err_code: number };
    expect(second.err_code).toBe(1010);
  });

  it("marks a finished run born outdated when inputs moved on mid-run", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    const runId = await runReview(draft.id);
    // Still queued (the fixture flips to running at 400ms): save new SQL so
    // the draft revision moves past the run's frozen draft_revision.
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    const edit = await saveSql(draft.id, "SELECT 2;");
    expect(edit.revision).toBe(3);
    await new Promise((resolve) => {
      setTimeout(resolve, 1_600);
    });

    // The run still finished ready, but it can no longer endorse the newer
    // inputs: the draft is born outdated instead of ready.
    const run = (await (
      await fetch(`https://yearning.test/review-runs/${runId}`)
    ).json()) as { data: { state: string; draft_revision: number } };
    expect(run.data.state).toBe("ready");
    expect(run.data.draft_revision).toBe(2);
    const moved = (await (
      await fetch(`https://yearning.test/change-drafts/${draft.id}`)
    ).json()) as { data: { state: string; revision: number } };
    expect(moved.data.state).toBe("outdated");
    expect(moved.data.revision).toBe(3);
  });

  it("keeps raw evidence reveals watermarked and copy actions audited", async () => {
    const draft = await createDraft();
    await saveSql(draft.id, "SELECT 1;");
    const runId = await runToTerminal(draft.id);

    const findings = (await (
      await fetch(`https://yearning.test/review-runs/${runId}/findings`)
    ).json()) as { data: { items: Array<{ id: string; evidence_ids: string[] }> } };
    const finding = findings.data.items[0];
    if (finding === undefined) {
      throw new Error("the ready run carries no findings");
    }

    const evidence = (await (
      await fetch(`https://yearning.test/review-findings/${finding.id}/evidence`)
    ).json()) as {
      data: Array<{ id: string; has_raw_payload: boolean; raw_payload_expires_at: string | null }>;
    };
    const evidenceId = evidence.data[0]?.id;
    expect(evidenceId).toBeDefined();
    expect(evidence.data[0]?.has_raw_payload).toBe(true);
    expect(evidence.data[0]?.raw_payload_expires_at).not.toBeNull();

    const reveal = (await (
      await fetch(`https://yearning.test/review-evidence/${evidenceId as string}/raw-reveals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "review-evidence" }),
      })
    ).json()) as { data: { reveal_id: string; watermark: string; raw_payload: { note: string } } };
    expect(reveal.data.raw_payload.note).toContain(FIXTURE_RAW_EVIDENCE_MARKER);
    expect(reveal.data.watermark).toContain("henry");

    const copy = await fetch(
      `https://yearning.test/review-evidence/${evidenceId as string}/raw-copy-events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_reveal_id: reveal.data.reveal_id }),
      },
    );
    expect(copy.status).toBe(200);
  });
});
