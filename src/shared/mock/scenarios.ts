import { HttpResponse, delay, http } from "msw";
import { BUSINESS_ERROR_CATALOG } from "@/api/generated/projections/business-error-catalog";
import {
  getGetMyDashboardMockHandler,
  getGetMyDashboardResponseBusinessErrorResponseMock,
  getGetMyDashboardResponseMyDashboardSuccessMock,
} from "@/api/generated/mocks/dashboard/dashboard.msw";
import type { BusinessErrorCode } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import type { SetupWorker } from "msw/browser";
import type { SetupServer } from "msw/node";
import { type MockScenario } from "@/shared/mock/scenario-store";
import { authMockHandlers } from "@/shared/mock/auth-handlers";
import { reviewFixtureHandlers } from "@/shared/mock/review-fixture";
import { adminFixtureHandlers, siteFixtureHandlers } from "@/shared/mock/admin-fixture";
import { queryFixtureHandlers } from "@/shared/mock/query-fixture";

/**
 * Scenario switching layered on top of the orval-generated base handlers
 * (code-generation-policy.json mock_layer): ready returns the typed success
 * envelope, blocked returns a declared business error envelope, running adds
 * realistic latency before success, error answers on the Problem Details path.
 * The demo operations share one deterministic request_id so assertions and UI
 * display stay stable across scenarios.
 */
export const DEMO_REQUEST_ID = "22222222-2222-4222-8222-222222222222";

// Deterministic dashboard payload (FE-F11 baseline determinism): the
// generated default handler drew every count from faker at request time,
// which churned the committed screenshot baseline on every regeneration and
// made visual review meaningless for the metric cards. One fixed,
// schema-valid dataset serves every dashboard response; refreshed_at matches
// the screenshot clock pin (tests/e2e/screenshots*.spec.ts).
const DASHBOARD_DATA = {
  data: {
    draft_count: 2,
    submitted_order_count: 3,
    pending_approval_count: 1,
    pending_execution_count: 1,
    blocked_review_count: 1,
    active_query_grant_count: 1,
    active_query_session_count: 1,
    refreshed_at: "2026-09-01T08:00:00Z",
  },
} as const;

function codeByName(name: string): BusinessErrorCode {
  for (const [code, entry] of Object.entries(BUSINESS_ERROR_CATALOG.errors)) {
    if (entry.name === name) return Number(code) as BusinessErrorCode;
  }
  throw new Error(`unknown business error name: ${name}`);
}

export function scenarioHandlers(scenario: MockScenario) {
  switch (scenario) {
    case "ready":
      return [
        getGetMyDashboardMockHandler(
          getGetMyDashboardResponseMyDashboardSuccessMock({
            request_id: DEMO_REQUEST_ID,
            ...DASHBOARD_DATA,
          }),
        ),
      ];
    case "blocked":
      return [
        getGetMyDashboardMockHandler(
          getGetMyDashboardResponseBusinessErrorResponseMock({
            err_code: codeByName("RESOURCE_NOT_FOUND"),
            message: "resource not found",
            data: null,
            request_id: DEMO_REQUEST_ID,
            retryable: false,
            meta: undefined,
          }),
        ),
      ];
    case "running":
      return [
        getGetMyDashboardMockHandler(async () => {
          await delay(1200);
          return getGetMyDashboardResponseMyDashboardSuccessMock({
            request_id: DEMO_REQUEST_ID,
            ...DASHBOARD_DATA,
          });
        }),
      ];
    case "error":
      // Transport failures bypass the typed envelope factories entirely and
      // answer on the Problem Details path, exactly as the real backend would.
      return [
        http.get(
          "*/dashboard/me",
          () =>
            HttpResponse.json(
              {
                type: "about:blank",
                title: "service_unavailable",
                status: 503,
                detail: "mocked transport failure",
                request_id: DEMO_REQUEST_ID,
              },
              { status: 503, headers: { "Content-Type": "application/problem+json" } },
            ),
        ),
      ];
    default:
      // review-* scenarios: no dashboard override — the stateful review
      // fixture reads its behavior from the scenario store directly.
      return [];
  }
}

/** Base set: the deterministic dashboard handler plus the hand-written
 * authentication handlers that simulate the cookie session, the stateful
 * change-draft/review fixture backing the FE-F4 workspace, and the stateful
 * admin fixture backing the FE-F9 review-admin management pages. */
export function baseHandlers() {
  return [
    getGetMyDashboardMockHandler(
      getGetMyDashboardResponseMyDashboardSuccessMock({
        request_id: DEMO_REQUEST_ID,
        ...DASHBOARD_DATA,
      }),
    ),
    ...authMockHandlers(),
    ...reviewFixtureHandlers(),
    ...adminFixtureHandlers(),
    ...queryFixtureHandlers(),
    ...siteFixtureHandlers(),
  ];
}

/** Vitest: apply a scenario as an override on the shared node server. */
export function applyScenarioToServer(server: SetupServer, scenario: MockScenario) {
  server.use(...scenarioHandlers(scenario));
}

/** Browser dev/e2e: apply a scenario as an override on the shared worker. */
export function applyScenarioToWorker(worker: SetupWorker, scenario: MockScenario) {
  worker.use(...scenarioHandlers(scenario));
}

