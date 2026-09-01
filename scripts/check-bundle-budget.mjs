#!/usr/bin/env node
// FE-F11 bundle budget gate (migration contract §8: 路由级Code Splitting、
// 管理Bundle不进入普通用户首屏, §18 defines the numeric budgets).
//
// Builds the RELEASE bundle itself (VITE_ENABLE_MOCK removed — the e2e
// webServer leaves a mock build in dist/, where the mock world legitimately
// compiles in), then verifies the initial-transfer budget from the entry
// document's own script/preload list and proves structurally that the admin
// surface, the migration workbench, the Monaco editor and the mock world stay
// off the first screen. Writes JSON evidence to
// tests/performance/bundle-budget.json.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const DIST = "dist";
const EVIDENCE = "tests/performance/bundle-budget.json";
// ~25% headroom over the FE-F11 measurements (JS 235.1 KiB, CSS 15.4 KiB).
const BUDGET_JS_KIB = 300;
const BUDGET_CSS_KIB = 24;

function fail(message) {
  console.error(`[check-bundle-budget] FAIL: ${message}`);
  process.exit(1);
}

const buildEnv = { ...process.env };
delete buildEnv.VITE_ENABLE_MOCK;
delete buildEnv.VITE_CONFIG_NATIVE_IGNORE_WARNING;
console.log("[check-bundle-budget] building release bundle (no VITE_ENABLE_MOCK)…");
execFileSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit", env: buildEnv });

let html;
try {
  html = readFileSync(path.join(DIST, "index.html"), "utf8");
} catch {
  fail("dist/index.html missing after release build");
}
const initialAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
  (match) => match[1],
);
if (initialAssets.length === 0) fail("entry document references no bundle assets");

const rows = initialAssets.map((asset) => {
  const raw = readFileSync(path.join(DIST, asset));
  return {
    asset: asset.replace("/assets/", ""),
    kind: asset.endsWith(".css") ? "css" : "js",
    rawBytes: raw.length,
    gzipBytes: gzipSync(raw, { level: 9 }).length,
  };
});

const jsKib = rows.filter((r) => r.kind === "js").reduce((sum, r) => sum + r.gzipBytes, 0) / 1024;
const cssKib = rows.filter((r) => r.kind === "css").reduce((sum, r) => sum + r.gzipBytes, 0) / 1024;

const violations = [];
if (jsKib > BUDGET_JS_KIB) {
  violations.push(`initial JS ${jsKib.toFixed(1)} KiB gzip exceeds budget ${BUDGET_JS_KIB} KiB`);
}
if (cssKib > BUDGET_CSS_KIB) {
  violations.push(`initial CSS ${cssKib.toFixed(1)} KiB gzip exceeds budget ${BUDGET_CSS_KIB} KiB`);
}

// Structural: admin/migration workbench, Monaco and the mock world must never
// sit on the first screen's critical path.
const FORBIDDEN_INITIAL = [
  { pattern: /^admin-/, why: "admin surface chunk" },
  { pattern: /^admin-migrations-/, why: "migration workbench chunk" },
  { pattern: /^sql-editor-panel-/, why: "Monaco editor chunk" },
  { pattern: /^editor\.worker-/, why: "Monaco worker chunk" },
  { pattern: /(^|-)(mock|msw|fixture)(-|\.|$)/, why: "mock/fixture chunk" },
];
for (const row of rows) {
  for (const rule of FORBIDDEN_INITIAL) {
    if (rule.pattern.test(row.asset)) {
      violations.push(`${rule.why} "${row.asset}" is on the initial-load critical path`);
    }
  }
}

// Monaco must exist as a lazy chunk (route-level code splitting actually
// splits it rather than the tree having silently lost the editor).
const allAssets = readdirSync(path.join(DIST, "assets"));
const monacoChunks = allAssets.filter(
  (name) => /^sql-editor-panel-.*\.js$/.test(name) || /^editor\.worker-.*\.js$/.test(name),
);
if (monacoChunks.length < 2) {
  violations.push(`Monaco lazy chunks missing from dist (found: ${monacoChunks.join(", ")})`);
}
// The mock world must not ship at all (dynamic import behind VITE_ENABLE_MOCK
// is dead-code-eliminated from release builds). Substring matching is
// intentionally fail-safe: a legitimate chunk named "…fixture…" fails the
// gate rather than silently shipping mock code.
const mockChunks = allAssets.filter(/mock|msw|fixture/i.test.bind(/mock|msw|fixture/i));
if (mockChunks.length > 0) {
  violations.push(`mock-world chunks shipped in release build: ${mockChunks.join(", ")}`);
}

mkdirSync(path.dirname(EVIDENCE), { recursive: true });
writeFileSync(
  EVIDENCE,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      budgets: { initial_js_gzip_kib: BUDGET_JS_KIB, initial_css_gzip_kib: BUDGET_CSS_KIB },
      measured: {
        initial_js_gzip_kib: Number(jsKib.toFixed(2)),
        initial_css_gzip_kib: Number(cssKib.toFixed(2)),
        initial_chunks: rows,
      },
      monaco_lazy_chunks: monacoChunks,
      violations,
    },
    null,
    2,
  )}\n`,
);

if (violations.length > 0) {
  fail(`${violations.length} violation(s):\n  - ${violations.join("\n  - ")}`);
}
console.log(
  `[check-bundle-budget] OK: initial JS ${jsKib.toFixed(1)}/${BUDGET_JS_KIB} KiB, initial CSS ${cssKib.toFixed(1)}/${BUDGET_CSS_KIB} KiB (gzip), Monaco lazy, admin/migration/mock off the first screen`,
);
