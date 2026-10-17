import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers/real-auth";

// FE-F12 real-backend e2e — the query workbench entry over a REAL grant. A
// fresh access request is created through the real API from the quser
// session and approved from the approver's, so the flows catalog renders
// deterministically with an active grant (no conditional skip). The full
// SELECT round-trip through the workspace editor is exercised headlessly by
// the contract suite (tests/contract/batch5: session → paged executeSelect
// → fetchQueryResultPage).
test.use({ storageState: statePath("quser") });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("yearning-locale", "zh-CN");
  });
});

async function ensureActiveGrant(quserPage: Page): Promise<void> {
  // 1) quser requests access through the real API.
  const request = await quserPage.evaluate(async () => {
    const csrf = document.cookie.split("; ")
      .map((row) => row.split("="))
      .find(([name]) => name === "yearning_csrf");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (csrf !== undefined) headers["X-CSRF-Token"] = csrf[1] ?? "";
    const flows = (await (await fetch("/api/v4/users/me/flows?flow_type=query_access")).json()) as {
      data?: { items?: Array<{ id: string; query_capabilities?: Array<{ datasource_id?: string }> }> };
    };
    const flow = flows.data?.items?.[0];
    if (flow === undefined) throw new Error("no query_access flow visible");
    const dsId = flow.query_capabilities?.[0]?.datasource_id;
    if (dsId === undefined) throw new Error("query flow carries no datasource");
    // Reuse a leftover pending request from an interrupted run instead of
    // failing on the single-open-request rule.
    const pending = (await (await fetch("/api/v4/query-access-requests")).json()) as {
      data?: { items?: Array<{ id: string; version: number; state?: string }> };
    };
    const open = pending.data?.items?.find((row) => row.state === "access_pending");
    if (open !== undefined) return { requestId: open.id, version: open.version };
    const response = await fetch("/api/v4/query-access-requests", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        flow_id: flow.id,
        datasource_ids: [dsId],
        requested_until: new Date(Date.now() + 2 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        reason: `f12 e2e query entry ${Date.now()}`,
      }),
    });
    const envelope = (await response.json()) as {
      data?: { id?: string; version?: number }; err_code?: number;
    };
    if (envelope.data?.id === undefined) throw new Error(`request create failed: ${envelope.err_code}`);
    return { requestId: envelope.data.id, version: envelope.data.version ?? 1 };
  });

  // 2) the approver approves it from their own session.
  const approverContext = await quserPage.context().browser()?.newContext({
    storageState: statePath("approver"),
  });
  if (approverContext === undefined) throw new Error("no browser for the approver context");
  try {
    const approverPage = await approverContext.newPage();
    await approverPage.goto("/workspace");
    await approverPage.waitForLoadState("networkidle");
    await approverPage.evaluate(async (input: { requestId: string; version: number }) => {
      const csrf = document.cookie.split("; ")
        .map((row) => row.split("="))
        .find(([name]) => name === "yearning_csrf");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrf !== undefined) headers["X-CSRF-Token"] = csrf[1] ?? "";
      const response = await fetch(`/api/v4/query-access-requests/${input.requestId}/decisions`, {
        method: "POST",
        headers: {
          ...headers,
          "If-Match": `"${String(input.version)}"`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ decision: "approve", comment: "f12 e2e query entry" }),
      });
      const envelope = (await response.json()) as { err_code?: number };
      if (envelope.err_code !== 0) {
        throw new Error(`decision failed: ${envelope.err_code}`);
      }
    }, request);
  } finally {
    await approverContext.close();
  }
}

test("quser opens the query entry with the real flows catalog", async ({ page }) => {
  // document.cookie is unreadable on about:blank: land on the app first so
  // the API seeding runs inside an authenticated same-origin document.
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  await ensureActiveGrant(page);
  await page.goto("/query");
  await expect(page.getByTestId("query-entry")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("query-entry-error")).toBeHidden();
  // With the fresh grant the needs-access hint must NOT show — the catalog
  // is the deterministic outcome.
  await expect(page.getByTestId("query-needs-access-hint")).toBeHidden();
  await expect(page.getByTestId("query-entry")).toContainText(/在线|查询|流程/);
});
