import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import type { ClientRequest } from "node:http";
import path from "node:path";

// Yearning v4 frontend. Production builds must not reach the network:
// dependencies are fully resolved from the lockfile at install time and the
// shadcn registry, the Shadcn Dashboard MCP and the frozen template checkout
// are development-time inputs only (code-generation-policy.json).

// Home release banner (RCP-20261020-RELEASE-FEED-BACKEND): the client reads
// the backend's /releases/latest snapshot; the server-side refresher is the
// only component that talks to the upstream GitHub API. The former
// __RELEASE_LATEST_URL__ build-time injection is gone with the browser
// direct-fetch design.

// Owner-mandated footer links (2026-09-02). Inlined here so src stays free
// of absolute-URL literals.
const footerLinks = {
  __SPONSOR_URL__: JSON.stringify(
    process.env.VITE_SPONSOR_URL ?? "https://next.yearning.io/zh/about/w5jt71jw/",
  ),
  __DOCS_URL__: JSON.stringify(process.env.VITE_DOCS_URL ?? "https://next.yearning.io/"),
};

// SEC-0032: the MSW service worker is dev/test tooling and must never ship in
// a release dist. Everything under public/ is copied into every build
// unconditionally, so the worker lives at src/shared/mock/mockServiceWorker.js
// and this plugin is its only route to a URL:
//   - dev server: served at /mockServiceWorker.js regardless of flags (the
//     browser only registers it when main.tsx enables the mock world);
//   - build: emitted into the bundle only when the build opts into the mock
//     world (VITE_ENABLE_MOCK=true — the e2e webServer build). Release
//     builds keep the flag off and get neither the file nor any reference.
const MSW_WORKER_URL = "/mockServiceWorker.js";
const MSW_WORKER_SOURCE = path.resolve(__dirname, "src/shared/mock/mockServiceWorker.js");

// FE-F12 real-backend e2e proxy target (VITE_E2E_API_PROXY). Precomputed
// origin for the SEC-0004 same-origin rewrite below (empty when unset).
const e2eApiProxyTarget = process.env.VITE_E2E_API_PROXY;
const e2eApiProxyOrigin = e2eApiProxyTarget ? new URL(e2eApiProxyTarget).origin : "";

function mswWorkerPlugin(): Plugin {
  return {
    name: "msw-worker-dev-only",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" || (req.url ?? "").split("?")[0] !== MSW_WORKER_URL) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/javascript");
        res.end(readFileSync(MSW_WORKER_SOURCE));
      });
    },
    generateBundle() {
      if (process.env.VITE_ENABLE_MOCK === "true") {
        this.emitFile({
          type: "asset",
          fileName: "mockServiceWorker.js",
          source: readFileSync(MSW_WORKER_SOURCE, "utf8"),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mswWorkerPlugin()],
  define: {
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
  //
  // SEC-0004 / F-ENV-002: the backend's RequireSameOrigin middleware rejects
  // anonymous auth POSTs whose Origin host != request Host. http-proxy's
  // changeOrigin rewrites Host to the target but leaves the browser's
  // preview-origin Origin untouched, so every proxied POST /api/v4/auth/login
  // came back 403 and the real-backend e2e could not sign in. The proxy is a
  // same-site hop we operate — not an attacker-supplied header — so rewrite
  // Origin to the target here; the backend then sees a coherent same-origin
  // request. Backend posture is unchanged: genuine cross-site browser
  // requests still carry Sec-Fetch-Site: cross-site and mismatched Origins
  // and keep getting 403.
  preview: e2eApiProxyTarget
    ? {
        proxy: {
          "/api": {
            target: e2eApiProxyTarget,
            changeOrigin: true,
            configure: (proxy) => {
              proxy.on("proxyReq", (proxyReq: ClientRequest) => {
                proxyReq.setHeader("origin", e2eApiProxyOrigin);
              });
            },
          },
        },
      }
    : undefined,
});
