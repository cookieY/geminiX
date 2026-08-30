import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**"],
      exclude: [
        "src/api/generated/**",
        "src/shared/components/ui/**",
        "src/**/*.d.ts",
        "src/**/*.css",
        "src/assets/**",
        // Assembly and entry layers with no decision logic. The shell and its
        // components are FE-F2 deliverables and carry their own unit tests;
        // only thin entry/assembly files stay outside the 80% gate.
        // Logic-bearing modules (api, i18n, theme, providers' policy code,
        // mock scenarios) stay inside the 80% gate.
        "src/main.tsx",
        "src/app/router/**",
        "src/app/layouts/**",
        "src/routes/**",
        "src/app/providers/app-providers.tsx",
        "src/shared/mock/browser.ts",
      ],
      thresholds: {
        // Shared pure functions and state logic carry the highest bar
        // (frontend implementation PRD §21); the generated layer is excluded.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
