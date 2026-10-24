#!/usr/bin/env node
// OpenAPI breaking-change detection entry (code-generation-policy.json
// breaking_change_gate). Baseline: the merge-base of the current branch against
// the target branch in the YearningX repository, executed BEFORE generation on
// every OpenAPI change.
//
// Policy (`api/development/code-generation-policy.json`):
//   incompatible_change: approved_requirement_change_proposal_required
//
// A breaking change is therefore NOT automatically a failure — it is a failure
// only when no approved Requirement Change Proposal covers it. This script:
//   1. detects breaking changes against the merge base (oasdiff);
//   2. when any are found, loads every approved RCP from
//      `artifacts/development/*/proposals/` and
//      `artifacts/security-review/remediation/*/proposals/` and checks whether
//      each finding's affected path is named in that RCP's
//      `proposed_contract_changes`;
//   3. passes only when every breaking finding is covered by an approved RCP,
//      naming the RCP per finding so a reviewer can verify the linkage.
//
// An uncovered finding still exits non-zero, so the pipeline blocks until the
// RCP is recorded and approved.
// Detector: oasdiff via @oasdiff-js/oasdiff-js (exact versions locked in
// package.json / pnpm-lock.yaml); oasdiff 1.15 supports the contract's
// OpenAPI 3.1.0 natively.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const yearningRoot = resolve(frontendRoot, "..");
const openapiRel = "api/openapi/yearning-v4.yaml";

const targetBranch = process.env.YEARNING_TARGET_BRANCH ?? "origin/main";

const git = (args, cwd = yearningRoot) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

// ---------------------------------------------------------------------------
// Approved RCP index
// ---------------------------------------------------------------------------

const RCP_ROOTS = ["artifacts/development", "artifacts/security-review/remediation"];

// Collect every proposal JSON under `<root>/<any>/proposals/`.
function collectProposalFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (
        name.startsWith("RCP-") &&
        name.endsWith(".json") &&
        dir.endsWith("proposals")
      ) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Load every proposal and keep the approved ones. `proposed_contract_changes`
 * entries may be plain strings or objects; both are flattened to searchable
 * text.
 */
function loadApprovedProposals() {
  const approved = [];
  for (const rel of RCP_ROOTS) {
    for (const file of collectProposalFiles(join(yearningRoot, rel))) {
      let doc;
      try {
        doc = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (doc.status !== "approved") continue;
      const changes = Array.isArray(doc.proposed_contract_changes)
        ? doc.proposed_contract_changes
        : [];
      const text = changes
        .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
        .join("\n");
      approved.push({
        id: doc.proposal_id,
        packageId: doc.package_id,
        file: file.slice(yearningRoot.length + 1),
        text,
      });
    }
  }
  return approved;
}

/**
 * A finding is covered when an approved RCP's change list names the affected
 * path. The path is the stable identity of the removed/changed surface; we do
 * NOT require the HTTP method, because RCPs describe removals in prose
 * ("删除 /admin/dashboard/review-quality 路径") and demanding "GET" would reject
 * legitimate coverage. When several proposals name the same path we prefer one
 * that also names the method, purely to make the reported linkage more precise.
 *
 * Path matching must be **boundary-aware**, not `String.includes`. A plain
 * substring test lets a proposal that only *adds* `/api/v4/dashboard/me/summary`
 * cover a removal of `/api/v4/dashboard/me`, and that is exactly the silent
 * pass this gate exists to prevent. Two things make it safe:
 *   1. the character after the path may not continue the path — `/` included,
 *      otherwise `/api/v4/dashboard/me` matches the prefix of `.../me/summary`;
 *   2. a `{param}` segment on either side matches a concrete value, and also
 *      matches a differently-named `{param}` (RCPs often write `{id}` where the
 *      contract writes `{datasource_id}`).
 */
function pathMatches(text, path) {
  // Build one regex per path SEGMENT. Segment-wise (not character-wise)
  // matching is what makes the template handling symmetric: a `{param}` on
  // either side stands for exactly one segment, whether the other side wrote a
  // concrete value or a differently-named placeholder.
  const pattern = path
    .split("/")
    .map((segment) => {
      if (/^\{[^}]*\}$/.test(segment)) return "[^/]+";
      const literal = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `(?:${literal}|\\{[^}/]*\\})`;
    })
    .join("/");
  return new RegExp(`${pattern}(?![A-Za-z0-9_\\-{}/])`, "i").test(text);
}

function findCoveringProposal(finding, approved) {
  const path = finding.path ?? "";
  if (!path) return null;
  const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.exec(
    finding.operation ?? "",
  )?.[1];
  const byPath = approved.filter((p) => pathMatches(p.text, path));
  if (byPath.length === 0) return null;
  if (method) {
    const withMethod = byPath.find((p) =>
      new RegExp(`\\b${method}\\b`, "i").test(p.text),
    );
    if (withMethod) return withMethod;
  }
  return byPath[0];
}

// Path-coverage boundary fixtures. `node scripts/api-breaking.mjs --self-test`
// runs them; `scripts/scan-motion.mjs` set the precedent for shipping the
// detector's own fixtures next to the detector.
//
// They drive `findCoveringProposal` — the function that actually decides
// coverage — not `pathMatches`. A fixture set that only exercises the helper
// would still pass after the call site regressed to `text.includes(path)`,
// which is precisely the silent hole this gate exists to close.
const COVERAGE_FIXTURES = [
  // A pure ADDITION of a longer sibling must not cover a removal.
  {
    name: "sibling-add does not cover parent removal",
    changes: ["api/openapi/yearning-v4.yaml：新增 GET /api/v4/dashboard/me/summary 端点"],
    finding: { path: "/api/v4/dashboard/me", operation: "GET" },
    want: false,
  },
  {
    name: "parent-prefix proposal does not cover child removal",
    changes: ["删除 /admin/dashboard 路径"],
    finding: { path: "/admin/dashboard/review-quality", operation: "GET" },
    want: false,
  },
  // The real, legitimate case this gate was written for.
  {
    name: "prose removal of the exact path covers it",
    changes: ["api/openapi/yearning-v4.yaml：删除 /admin/dashboard/review-quality 路径与三个 schema"],
    finding: { path: "/admin/dashboard/review-quality", operation: "GET" },
    want: true,
  },
  // Templated segments on either side.
  {
    name: "templated RCP path covers concrete finding path",
    changes: ["删除 /users/me/datasources/{datasource_id}/test"],
    finding: { path: "/users/me/datasources/42/test", operation: "DELETE" },
    want: true,
  },
  {
    name: "differently named template still matches",
    changes: ["删除 /users/me/datasources/{id}/test"],
    finding: { path: "/users/me/datasources/{datasource_id}/test", operation: "DELETE" },
    want: true,
  },
  {
    name: "sibling action on a templated path does not cover",
    changes: ["删除 /users/me/datasources/{datasource_id}/rotate"],
    finding: { path: "/users/me/datasources/{datasource_id}/test", operation: "DELETE" },
    want: false,
  },
  // An unrelated proposal must never cover.
  {
    name: "unrelated proposal does not cover",
    changes: ["新增 GET /api/v4/query/orders"],
    finding: { path: "/admin/dashboard/review-quality", operation: "GET" },
    want: false,
  },
];

// Detector-result classification, extracted so the self-test can drive it with
// synthetic results. Fail closed: a non-zero exit or a non-array payload means
// "cannot decide", never "no breaking changes".
function classifyDetectorResult(result) {
  if (result?.exitCode !== 0) {
    return { kind: "detector-failed", exitCode: result?.exitCode, stderr: String(result?.stderr ?? "") };
  }
  let findings;
  try {
    findings = JSON.parse(String(result.stdout || ""));
  } catch {
    return { kind: "unparseable", stdout: String(result.stdout ?? "") };
  }
  if (!Array.isArray(findings)) return { kind: "not-an-array", got: typeof findings };
  return { kind: "ok", findings };
}

const DETECTOR_FIXTURES = [
  {
    name: "clean run returns findings",
    result: { exitCode: 0, stdout: "[]", stderr: "" },
    want: "ok",
  },
  {
    name: "breaking findings still classify as ok",
    result: { exitCode: 0, stdout: '[{"id":"x"}]', stderr: "" },
    want: "ok",
  },
  {
    // The hole this guards: oasdiff exits 102 on unparsable YAML with empty
    // stdout, which previously parsed as [] and reported "no breaking changes".
    name: "detector crash is not an empty finding set",
    result: { exitCode: 102, stdout: "", stderr: "failed to load revision spec" },
    want: "detector-failed",
  },
  {
    name: "unparseable stdout is not an empty finding set",
    result: { exitCode: 0, stdout: "not json", stderr: "" },
    want: "unparseable",
  },
  {
    name: "non-array payload is rejected",
    result: { exitCode: 0, stdout: '{"findings":[]}', stderr: "" },
    want: "not-an-array",
  },
];

function detectorSelfTest() {
  const failures = [];
  for (const fixture of DETECTOR_FIXTURES) {
    const got = classifyDetectorResult(fixture.result).kind;
    if (got !== fixture.want) {
      failures.push(`${fixture.name}: want ${fixture.want}, got ${got}`);
    }
  }
  return failures;
}

function coverageSelfTest() {
  const failures = [];
  for (const fixture of COVERAGE_FIXTURES) {
    const approved = [
      {
        id: "RCP-SELFTEST",
        packageId: "BE-SELFTEST",
        file: "selftest.json",
        text: fixture.changes.join("\n"),
      },
    ];
    const covered = findCoveringProposal(fixture.finding, approved) !== null;
    if (covered !== fixture.want) {
      failures.push(`${fixture.name}: want ${String(fixture.want)}, got ${String(covered)}`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const failures = [...coverageSelfTest(), ...detectorSelfTest()];
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`api:breaking self-test: ${failure}\n`);
    process.exit(1);
  }
  console.log(
    `api:breaking self-test ok: ${COVERAGE_FIXTURES.length} coverage fixtures, ` +
      `${DETECTOR_FIXTURES.length} detector fixtures`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", targetBranch]).trim();
} catch {
  console.error(
    `api:breaking: cannot resolve merge base against ${targetBranch}; ` +
      `run inside a YearningX worktree with the target branch fetched.`,
  );
  process.exit(2);
}

// Compare the working tree, not HEAD: generation runs before the commit that
// would carry the OpenAPI change, so HEAD still holds the previous revision.
const currentOpenapi = readFileSync(join(yearningRoot, openapiRel), "utf8");
const baselineOpenapi = git(["show", `${mergeBase}:${openapiRel}`]);

if (currentOpenapi === baselineOpenapi) {
  console.log(
    `api:breaking: ${openapiRel} unchanged since merge base ${mergeBase.slice(0, 12)}; no detection needed.`,
  );
  process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), "yearning-openapi-"));
const baselinePath = join(temp, "baseline.yaml");
const currentPath = join(temp, "current.yaml");
writeFileSync(baselinePath, baselineOpenapi);
writeFileSync(currentPath, currentOpenapi);

const oasdiff = await import("@oasdiff-js/oasdiff-js");
const result = await oasdiff.runOasdiffBreaking(baselinePath, currentPath, []);

// Fail CLOSED on detector failure. `@oasdiff-js/oasdiff-js` wraps the binary: a
// parse error exits non-zero with empty stdout, so treating empty stdout as
// "[]" would report "no breaking changes" for an OpenAPI file that cannot even
// be parsed — anyone could green this gate by writing a broken YAML. Exit 2 is
// deliberately distinct from 1 ("uncovered breaking change") so the two
// failures stay distinguishable in CI logs.
// The classification lives in `classifyDetectorResult` above, and this call site
// is its ONLY consumer — that is what makes DETECTOR_FIXTURES guard production
// rather than a helper nobody calls. An earlier revision inlined the same three
// checks here; the self-test then stayed green even after this branch was
// reverted to "empty stdout means no findings" (review finding F1).
const classified = classifyDetectorResult(result);
if (classified.kind === "detector-failed") {
  console.error(
    `api:breaking: detector failed (exit ${String(classified.exitCode)}); cannot decide coverage.`,
  );
  const stderr = String(classified.stderr ?? "").trim();
  if (stderr) console.error(stderr);
  process.exit(2);
}
if (classified.kind === "unparseable") {
  console.error("api:breaking: detector produced unparseable output:", classified.stdout);
  process.exit(2);
}
if (classified.kind === "not-an-array") {
  console.error("api:breaking: detector did not return a findings array:", classified.got);
  process.exit(2);
}

const findings = classified.findings;

if (findings.length === 0) {
  console.log(`api:breaking: no breaking changes against merge base ${mergeBase.slice(0, 12)}.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

const approved = loadApprovedProposals();
const covered = [];
const uncovered = [];

for (const finding of findings) {
  const proposal = findCoveringProposal(finding, approved);
  if (proposal) covered.push({ finding, proposal });
  else uncovered.push(finding);
}

console.log(
  `api:breaking: ${findings.length} breaking change(s) against merge base ${mergeBase.slice(0, 12)}; ` +
    `${covered.length} covered by an approved Requirement Change Proposal, ${uncovered.length} not.`,
);

for (const { finding, proposal } of covered) {
  const target = `${finding.path ?? ""} ${finding.operation ?? ""}`.trim();
  console.log(`  ok  [${finding.id}] ${target}  <- ${proposal.id} (${proposal.packageId})`);
}

if (uncovered.length > 0) {
  console.error("api:breaking: uncovered breaking change(s):");
  for (const finding of uncovered) {
    console.error(
      `  - [${finding.id}] ${finding.text} (${finding.operation ?? ""} ${finding.path ?? ""})`,
    );
  }
  const ids = approved.length === 0 ? "none" : approved.map((p) => p.id).join(", ");
  console.error(
    "An approved Requirement Change Proposal (api/development/requirement-change-proposal.schema.json) " +
      "naming the affected path is required before incompatible changes enter generation. " +
      `Approved proposals found: ${ids}.`,
  );
  process.exit(1);
}

console.log(
  "api:breaking: every breaking change is covered by an approved Requirement Change Proposal.",
);
