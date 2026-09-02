import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Yearning v4 frontend. Production builds must not reach the network:
// dependencies are fully resolved from the lockfile at install time and the
// shadcn registry, the Shadcn Dashboard MCP and the frozen template checkout
// are development-time inputs only (code-generation-policy.json).

// Home release banner (owner ruling 2026-09-02): the client fetches the
// upstream GitHub release metadata from cookieY/Yearning (real data in dev
// and production). The e2e webServer overrides the URL to a same-origin MSW
// fixture so tests never leave localhost and the banner stays byte-stable;
// the literal lives here in build config, not in src (browser-storage gate).
const releaseLatestUrl =
  process.env.VITE_RELEASE_LATEST_URL ??
  "https://api.github.com/repos/cookieY/Yearning/releases/latest";

// Owner-mandated footer links (2026-09-02). Same pattern: inlined here so
// src stays free of absolute-URL literals.
const footerLinks = {
  __SPONSOR_URL__: JSON.stringify(
    process.env.VITE_SPONSOR_URL ?? "https://next.yearning.io/zh/about/w5jt71jw/",
  ),
  __DOCS_URL__: JSON.stringify(process.env.VITE_DOCS_URL ?? "https://next.yearning.io/"),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __RELEASE_LATEST_URL__: JSON.stringify(releaseLatestUrl),
    ...footerLinks,
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
