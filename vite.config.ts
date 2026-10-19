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
    // 共享dist保护（2026-10-19联调事故）：e2e webServer此前把共享dist/
    // 重建成mock版，实时覆盖手动preview（4273）正在服务的产物——操作者
    // 刷新即落入MSW假世界。e2e构建一律走独立目录，dist/只属于显式构建。
    outDir: process.env.VITE_BUILD_OUT_DIR ?? "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
  },
  // FE-F12 real-backend e2e: `vite preview` proxies /api to the local serve
  // stack when VITE_E2E_API_PROXY is set (playwright.real.config.ts). The
  // default config — mock e2e, dev, release — never sets the variable and
  // keeps no proxy.
  preview: process.env.VITE_E2E_API_PROXY
    ? {
        proxy: {
          "/api": {
            target: process.env.VITE_E2E_API_PROXY,
            changeOrigin: true,
          },
        },
      }
    : undefined,
});
