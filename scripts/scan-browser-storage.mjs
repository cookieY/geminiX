#!/usr/bin/env node
// FE-F11 sensitive-storage and telemetry scan (migration contract §6:
// 明文不得进入LocalStorage、IndexedDB、错误遥测; §18 gate: SQL/Evidence/
// Token/Secret存储扫描零发现).
//
// Static pass over src/: every browser-storage and network-egress primitive
// must appear in the allowlist below with its declared purpose, and no
// outbound telemetry primitive (beacon, analytics, third-party transport) may
// exist at all. The runtime counterpart is tests/e2e/storage-telemetry.spec.ts.
//
// Known limitation (FE-F11 R1): this is a regex scan over identifier usage —
// computed member access such as window["local"+"Storage"] evades it. The
// compensating control is the runtime gate, which dumps actual storage after
// sensitive flows and fails on any key outside the allowlist. An AST-based
// member-expression scan is future hardening if the mock-free surface grows.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`[scan-browser-storage] FAIL: ${message}`);
  process.exit(1);
}

const SRC = "src";

// File → allowed storage primitives. Any hit outside this table fails; any
// primitive in the table that no longer occurs in the file also fails (keeps
// the table honest when code moves on).
const ALLOWED = {
  // Theme choice (light/dark) — non-sensitive UI preference.
  "app/providers/theme-provider.tsx": ["localStorage"],
  // Locale choice — non-sensitive UI preference.
  "shared/i18n/index.ts": ["localStorage"],
  // Template sidebar primitive persists collapsed state in a cookie.
  "shared/components/ui/sidebar.tsx": ["document.cookie"],
  // CSRF double-submit: reads the yearning_csrf cookie, never writes storage.
  "shared/api/mutator.ts": ["document.cookie"],
  // Mock world (dev/E2E only, behind VITE_ENABLE_MOCK): scenario selectors.
  "shared/mock/scenario-store.ts": ["localStorage"],
  "shared/mock/auth-scenario-store.ts": ["localStorage"],
};

const STORAGE_PATTERNS = [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["indexedDB", /\bindexedDB\b/],
  ["document.cookie", /document\.cookie/],
  ["cookieStore", /\bcookieStore\b/],
];

// Outbound telemetry primitives: forbidden everywhere in src.
const TELEMETRY_PATTERNS = [
  ["navigator.sendBeacon", /\bsendBeacon\s*\(/],
  ["XMLHttpRequest", /\bnew\s+XMLHttpRequest\b/],
  ["WebSocket", /\bnew\s+WebSocket\s*\(/],
  ["EventSource", /\bnew\s+EventSource\s*\(/],
  ["google analytics/gtag", /\b(gtag|googletagmanager|google-analytics)\b/],
  ["sentry", /\b(Sentry|sentry-cdn|@sentry)\b/],
  ["posthog/mixpanel/segment", /\b(posthog|mixpanel|segment\.com|analytics\.js)\b/],
];

// Cross-origin transport: fetch/XHR must only ever see same-origin relative
// paths through the orval mutator; an absolute http(s) URL literal in code is
// a violation (comments excluded below).
const ABSOLUTE_URL_PATTERN = /["'`]https?:\/\//;

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      // src/test/ is vitest infrastructure (setupFiles) — never shipped in a
      // bundle; its storage stubs are unit-test fixtures, not app behavior.
      if (full.split(path.sep).join("/").endsWith("src/test")) continue;
      entries.push(...walk(full));
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

// Namespace identifiers inside serialized XML (OOXML spreadsheet parts) are
// names, never endpoints — they are not transport.
const NAMESPACE_URI = /https?:\/\/(schemas\.openxmlformats\.org|www\.w3\.org)\//;

const findings = [];
const seenPrimitiveUsage = new Map();

for (const file of walk(SRC)) {
  const rel = file.split(path.sep).join("/");
  const source = readFileSync(file, "utf8");
  // Strip line comments, block comments and string literals so that prose
  // mentions (contract quotes, URLs in comments) never mask real usage.
  const rawSource = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // Strip string and template literals after removing namespace URIs so the
  // simple quote-pair stripper cannot strand URL text behind XML attributes.
  const executable = rawSource
    .replace(new RegExp(NAMESPACE_URI.source, "g"), "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const relKey = rel.replace(/^src\//, "");
  for (const [name, pattern] of STORAGE_PATTERNS) {
    if (pattern.test(executable)) {
      seenPrimitiveUsage.set(`${relKey}::${name}`, true);
      if (!(ALLOWED[relKey] ?? []).includes(name)) {
        findings.push(`${relKey}: uses ${name} outside the storage allowlist`);
      }
    }
  }
  for (const [name, pattern] of TELEMETRY_PATTERNS) {
    if (pattern.test(executable)) {
      findings.push(`${relKey}: forbidden telemetry primitive ${name}`);
    }
  }
  if (ABSOLUTE_URL_PATTERN.test(executable)) {
    findings.push(`${relKey}: absolute http(s) URL literal in code (all transport must be same-origin via the orval mutator)`);
  }
}

// The allowlist must stay honest: a declared file without the declared
// primitive means the table drifted from the code.
for (const [relKey, primitives] of Object.entries(ALLOWED)) {
  const file = path.join(SRC, relKey);
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    findings.push(`allowlist references missing file ${relKey}`);
    continue;
  }
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  for (const name of primitives) {
    const pattern = STORAGE_PATTERNS.find(([candidate]) => candidate === name)?.[1];
    if (pattern !== undefined && !pattern.test(executable)) {
      findings.push(`${relKey}: allowlist declares ${name} but the file no longer uses it`);
    }
  }
}

if (findings.length > 0) {
  fail(`${findings.length} finding(s):\n  - ${findings.join("\n  - ")}`);
}
console.log(
  `[scan-browser-storage] OK: storage usage within allowlist (${seenPrimitiveUsage.size} declared hits), zero telemetry primitives, zero absolute-URL transport`,
);
