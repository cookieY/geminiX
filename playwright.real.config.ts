import { defineConfig } from "@playwright/test";

// FE-F12 real-backend e2e: a release build (no VITE_ENABLE_MOCK — the MSW
// worker is never bundled) served by `vite preview`, with /api proxied to the
// local serve stack (scripts/integration/f12_stack.py, port 18080) via
// VITE_E2E_API_PROXY. Credentials come from the stack environment
// (F12_ADMIN_PASSWORD; seed users default to the fixture password documented
// in scripts/integration/f12_seed.py) — nothing is hardcoded here.
//
// The mock-driven suite (playwright.config.ts) remains the regression
// baseline; this suite proves the same UI against the real backend.
export default defineConfig({
  testDir: "./tests/e2e-real",
  timeout: 45_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4273",
    trace: "retain-on-failure",
  },
  webServer: {
    // The release banner points at a same-origin path that 404s without the
    // MSW worker, so the banner deterministically hides and no test leaves
    // localhost.
    command:
      "VITE_BUILD_OUT_DIR=dist-real VITE_RELEASE_LATEST_URL=/mock/github-releases/latest pnpm build && " +
      "VITE_BUILD_OUT_DIR=dist-real VITE_E2E_API_PROXY=http://127.0.0.1:18080 pnpm preview --port 4273 --strictPort",
    url: "http://localhost:4273",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { browserName: "chromium" },
      dependencies: ["setup"],
    },
  ],
});
