import { create } from "zustand";

/**
 * Mock scenario switch shared by vitest (node MSW server) and Playwright
 * (browser MSW worker), per code-generation-policy.json mock_layer. Scenarios
 * prove the generated client's full outcome surface before the real backend
 * exists: ready (err_code 0), blocked (typed business error), running
 * (long-running acceptance), error (transport failure). The review-* values
 * select the stateful precheck fixture's run outcome for FE-F4 acceptance
 * gates (Ready/Blocked/Partial/Provider失败 E2E).
 */
export type MockScenario =
  | "ready"
  | "blocked"
  | "running"
  | "error"
  | "review-ready"
  | "review-blocked"
  | "review-partial"
  | "review-provider-failed"
  | "order-partial-execution"
  | "execution-partial"
  | "execution-unknown"
  | "execution-ghost"
  | "execution-preflight"
  | "schedule-missed"
  | "query-flow"
  | "query-flow-direct"
  | "query-session"
  | "query-revoked"
  | "query-approval";
export const MOCK_SCENARIOS: MockScenario[] = [
  "ready",
  "blocked",
  "running",
  "error",
  "review-ready",
  "review-blocked",
  "review-partial",
  "review-provider-failed",
  "order-partial-execution",
  "execution-partial",
  "execution-unknown",
  "execution-ghost",
  "execution-preflight",
  "schedule-missed",
  "query-flow",
  "query-flow-direct",
  "query-session",
  "query-revoked",
  "query-approval",
];

interface MockScenarioStore {
  scenario: MockScenario;
  setScenario: (scenario: MockScenario) => void;
}

const STORAGE_KEY = "yearning-mock-scenario";

export function readStoredScenario(): MockScenario {
  const value = localStorage.getItem(STORAGE_KEY);
  return MOCK_SCENARIOS.includes(value as MockScenario) ? (value as MockScenario) : "ready";
}

export const useMockScenario = create<MockScenarioStore>((set) => ({
  scenario: "ready",
  setScenario: (scenario) => {
    localStorage.setItem(STORAGE_KEY, scenario);
    set({ scenario });
    window.dispatchEvent(new CustomEvent("yearning:mock-scenario"));
  },
}));
