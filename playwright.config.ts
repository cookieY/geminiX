import { defineConfig } from "@playwright/test";

// E2E runs against the production build served by vite preview. The smoke
// suite asserts static structure; scenario-driven browser flows (MSW worker
// via VITE_ENABLE_MOCK builds) extend this suite from FE-F2 on
// (code-generation-policy.json mock_layer).
export default defineConfig({
  testDir: "./tests/e2e",
  // SEC-0012: csp-security.spec.ts needs the real Go backend (embedded
  // release SPA) as the document source — vite preview sends no CSP. The
  // spec runs via its own project (tests/e2e/csp.playwright.config.ts,
  // driver scripts/run-csp-e2e.mjs) and is excluded here so the mock
  // regression baseline never executes it against a CSP-less server.
  testIgnore: /csp-security\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    // The e2e suite is mock-driven (code-generation-policy.json mock_layer):
    // the build inlines VITE_ENABLE_MOCK=true so the shared MSW worker backs
    // the session, flows and dashboard endpoints exactly as in vitest. Release
    // builds keep the flag off — mock code is a dynamic import and never part
    // of the default bundle. The release banner reads the backend snapshot
    // endpoint (RCP-20261020), backed by the MSW fixture below — tests never
    // leave localhost and the banner stays deterministic.
    command:
      "VITE_BUILD_OUT_DIR=dist-e2e VITE_ENABLE_MOCK=true pnpm build && "
      + "VITE_BUILD_OUT_DIR=dist-e2e pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
