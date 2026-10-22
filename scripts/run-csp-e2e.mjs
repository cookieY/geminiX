#!/usr/bin/env node
// SEC-0012 CSP browser E2E driver — proves the strict CSP the Go backend ships
// (backend/internal/httpapi/security.go) against the real embedded SPA in a
// real browser. vite-preview-based suites (mock + real) cannot do this: they
// serve documents without any CSP header.
//
// Pipeline:
//   1. verify (or bring up) the FE-F12 real stack (scripts/integration/f12_stack.py)
//   2. build the frontend release-style (VITE_ENABLE_MOCK=false → dist-csp)
//   3. embed dist-csp into the backend (go build -tags nomsgpack,assets with the
//      dist tree digest injected exactly like `make frontend-release-assets` does
//      for the release binary) into a temp directory
//   4. start `yearning serve` with the stack's metadata/keyring env on a random
//      127.0.0.1 port (the f12 serve on 18080 keeps running, untouched)
//   5. run playwright with tests/e2e/csp.playwright.config.ts against that origin
//   6. tear the serve instance down and restore backend/internal/platform/assets/dist
//
// Usage: cd frontend && node scripts/run-csp-e2e.mjs
// Environment:
//   F12_WORKDIR    f12 stack workdir (default /tmp/yearning-f12-integration)
//   CSP_SKIP_BUILD=1  reuse the previous dist-csp build (debugging only)
//   CSP_KEEP_BUILD=1  keep the dist-csp build directory after the run
//
// The pre-existing `backend/internal/platform/assets/dist` (release-flow
// artifact, gitignored) is backed up for the duration of the build and restored
// afterwards; no tracked file anywhere is touched.
//
// CI note: real-stack e2e has no CI job today (existing decision); this suite
// follows the same model — local runs with evidence captured under
// artifacts/security-review/remediation/<batch>/SEC-0012/.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "backend");
const assetsDist = path.join(backendRoot, "internal", "platform", "assets", "dist");

const workdir = process.env.F12_WORKDIR ?? "/tmp/yearning-f12-integration";
const stackWork = path.join(workdir, "work");
const buildDir = path.join(frontendRoot, "dist-csp");

const log = (...args) => console.log("csp-e2e:", ...args);
const die = (msg) => {
  console.error("csp-e2e: FATAL:", msg);
  process.exit(1);
};

function readSecret(name, fallback) {
  const p = path.join(stackWork, name);
  if (!fs.existsSync(p)) {
    if (fallback !== undefined) return fallback;
    die(`missing ${p} — bring the stack up first: python3 scripts/integration/f12_stack.py up`);
  }
  return fs.readFileSync(p, "utf8").trim();
}

function stackEnvValue(key, fallback) {
  const p = path.join(stackWork, "stack.env");
  if (!fs.existsSync(p)) return fallback;
  const line = fs.readFileSync(p, "utf8").split("\n").find((l) => l.startsWith(`export ${key}=`));
  return line ? line.slice(line.indexOf("=") + 1) : fallback;
}

/** f12_stack.py status exit 0 == whole stack healthy; otherwise run `up`. */
function ensureStack() {
  const status = spawnSync("python3", [path.join(repoRoot, "scripts/integration/f12_stack.py"), "status"], {
    cwd: repoRoot, encoding: "utf8",
  });
  if (status.status === 0) {
    log("f12 stack healthy (status exit 0)");
    return;
  }
  log("f12 stack not healthy — running `f12_stack.py up` (this may take minutes)…");
  const up = spawnSync("python3", [path.join(repoRoot, "scripts/integration/f12_stack.py"), "up"], {
    cwd: repoRoot, stdio: "inherit",
  });
  if (up.status !== 0) die(`f12 stack up failed with exit ${up.status}`);
}

/** Release-flow dist digest: sha256 over "<relpath>\0<sha256(file)>\n" with
 * POSIX relpaths sorted lexicographically (release_frontend_lock.py算法). */
async function distTreeHash(distDir) {
  const files = [];
  const walk = async (rel) => {
    const entries = await fs.promises.readdir(path.join(distDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile()) files.push(relPath);
      else die(`symlink in dist is not embeddable: ${relPath}`);
    }
  };
  await walk("");
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    const sha = createHash("sha256").update(await fs.promises.readFile(path.join(distDir, rel))).digest("hex");
    hash.update(`${rel}\0${sha}\n`);
  }
  return hash.digest("hex");
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady(pid, baseURL, deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (pid.exitCode !== null && pid.signal === null) {
      throw new Error(`serve exited early (code ${pid.exitCode}) — see ${logPath}`);
    }
    try {
      const res = await fetch(`${baseURL}/api/v4/health/ready`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`serve not ready within ${deadlineMs}ms — see ${logPath}`);
}

const logPath = path.join(fs.mkdtempSync(path.join("/tmp", "yearning-csp-e2e-")), "serve-csp.log");

let serve = null;
let assetsBackup = null;

async function main() {
  ensureStack();

  const metaPassword = readSecret("meta-password.txt");
  const adminPassword = readSecret("admin-password.txt");
  const seedPassword = stackEnvValue("F12_SEED_USER_PASSWORD", "f12seed-pw12345");
  const metaDb = stackEnvValue("F12_METADATA_DB", "yearning_f12b");

  // ---- 1. frontend release-style build -------------------------------
  if (process.env.CSP_SKIP_BUILD === "1" && fs.existsSync(buildDir)) {
    log("CSP_SKIP_BUILD=1 — reusing existing dist-csp");
  } else {
    log("building frontend (VITE_ENABLE_MOCK=false → dist-csp)…");
    const build = spawnSync("pnpm", ["build"], {
      cwd: frontendRoot,
      env: { ...process.env, VITE_BUILD_OUT_DIR: "dist-csp", VITE_ENABLE_MOCK: "false" },
      stdio: "inherit",
    });
    if (build.status !== 0) die(`frontend build failed with exit ${build.status}`);
  }
  const digest = await distTreeHash(buildDir);
  log(`dist-csp tree digest ${digest}`);

  // ---- 2. embed into the backend & build the serve binary ------------
  if (fs.existsSync(assetsDist)) {
    assetsBackup = `${assetsDist}.csp-backup-${Date.now()}`;
    fs.renameSync(assetsDist, assetsBackup);
    log(`backed up existing ${path.relative(repoRoot, assetsDist)}`);
  }
  fs.cpSync(buildDir, assetsDist, { recursive: true, verbatimSymlinks: false });
  const tmpBin = path.join(path.dirname(logPath), "yearning-csp");
  log("building backend with embedded assets (-tags nomsgpack,assets)…");
  const goBuild = spawnSync("go", [
    "build", "-tags", "nomsgpack,assets", "-trimpath",
    "-ldflags", `-X github.com/cookieY/YearningX/backend/internal/platform/assets.frontendDigest=${digest}`,
    "-o", tmpBin, "./cmd/yearning",
  ], { cwd: backendRoot, stdio: "inherit" });
  if (goBuild.status !== 0) die(`backend build failed with exit ${goBuild.status}`);

  // ---- 3. serve on a random loopback port ----------------------------
  const port = await freeLoopbackPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const serveEnv = {
    ...process.env,
    YEARNING_ENVIRONMENT: "development",
    YEARNING_DATABASE_HOST: "127.0.0.1",
    YEARNING_DATABASE_PORT: "54332", // f12_stack.py METADATA_PORT
    YEARNING_DATABASE_USER: "yearning",
    YEARNING_DATABASE_PASSWORD: metaPassword,
    YEARNING_DATABASE_DBNAME: metaDb,
    YEARNING_DATABASE_SSLMODE: "disable",
    YEARNING_SESSION_SECURE: "false",
    YEARNING_KEY_PROVIDER_KIND: "file",
    YEARNING_KEY_PROVIDER_PATH: path.join(stackWork, "keyring.json"),
    YEARNING_ALLOW_LOOPBACK_TARGETS: "1",
    SSL_CERT_FILE: path.join(stackWork, "ai-certs", "ca.pem"),
  };
  const serveLog = fs.openSync(logPath, "a");
  serve = spawn(tmpBin, [
    "serve", "--listen", `127.0.0.1:${port}`,
    "--bootstrap-admin-password-file", path.join(stackWork, "admin-password.txt"),
  ], { env: serveEnv, detached: true, stdio: ["ignore", serveLog, serveLog] });
  log(`serve pid ${serve.pid} on ${baseURL} (log ${logPath})`);
  await waitReady(serve, baseURL, 40_000);

  // Evidence line: the document CSP the browser will actually enforce.
  const doc = await fetch(`${baseURL}/`);
  log("document Content-Security-Policy:");
  console.log(doc.headers.get("content-security-policy"));
  console.log(`csp-e2e: document response headers date=${doc.headers.get("date")}`);

  // ---- 4. playwright --------------------------------------------------
  log("running CSP e2e suite…");
  const run = spawnSync("pnpm", [
    "exec", "playwright", "test", "--config", "tests/e2e/csp.playwright.config.ts",
  ], {
    cwd: frontendRoot,
    env: {
      ...serveEnv,
      CSP_E2E_BASE_URL: baseURL,
      F12_ADMIN_PASSWORD: adminPassword,
      F12_SEED_USER_PASSWORD: seedPassword,
    },
    stdio: "inherit",
  });
  log(`playwright exited with ${run.status}`);
  return run.status ?? 1;
}

try {
  const code = await main();
  process.exitCode = code;
} finally {
  if (serve !== null && serve.pid !== undefined && serve.exitCode === null) {
    try { process.kill(-serve.pid, "SIGTERM"); } catch { /* already gone */ }
    await sleep(1500);
    try { process.kill(-serve.pid, "SIGKILL"); } catch { /* already gone */ }
    log(`serve (pid ${serve.pid}) stopped`);
  }
  if (assetsBackup !== null) {
    fs.rmSync(assetsDist, { recursive: true, force: true });
    fs.renameSync(assetsBackup, assetsDist);
    log(`restored ${path.relative(repoRoot, assetsDist)}`);
  } else {
    fs.rmSync(assetsDist, { recursive: true, force: true });
  }
  if (process.env.CSP_KEEP_BUILD !== "1") {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}
