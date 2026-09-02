import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Yearning v4 frontend. Production builds must not reach the network:
// dependencies are fully resolved from the lockfile at install time and the
// shadcn registry, the Shadcn Dashboard MCP and the frozen template checkout
// are development-time inputs only (code-generation-policy.json).

// Home release banner (owner ruling 2026-09-02): the client fetches the
// upstream GitHub release metadata. The endpoint is inlined at build time —
// mock/e2e builds (VITE_ENABLE_MOCK=true) get a same-origin MSW fixture path
// so tests never leave localhost and the banner stays byte-stable; the
// literal lives here in build config, not in src (browser-storage gate).
const releaseLatestUrl =
  process.env.VITE_RELEASE_LATEST_URL ??
  (process.env.VITE_ENABLE_MOCK === "true"
    ? "/mock/github-releases/latest"
    : "https://api.github.com/repos/cookieY/Yearning/releases/latest");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __RELEASE_LATEST_URL__: JSON.stringify(releaseLatestUrl),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
  },
});
