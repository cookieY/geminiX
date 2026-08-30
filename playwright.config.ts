import { defineConfig } from "@playwright/test";

// E2E runs against the production build served by vite preview. The smoke
// suite asserts static structure; scenario-driven browser flows (MSW worker
// via VITE_ENABLE_MOCK builds) extend this suite from FE-F2 on
// (code-generation-policy.json mock_layer).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
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
