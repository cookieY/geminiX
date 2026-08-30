#!/usr/bin/env node
// OpenAPI breaking-change detection entry (code-generation-policy.json
// breaking_change_gate). Baseline: the merge-base of the current branch against
// the target branch in the YearningX repository, executed BEFORE generation on
// every OpenAPI change. Incompatible changes require an approved Requirement
// Change Proposal; this command exits non-zero whenever any breaking change is
// detected so the pipeline blocks until the RCP is recorded.
// Detector: oasdiff via @oasdiff-js/oasdiff-js (exact versions locked in
// package.json / pnpm-lock.yaml); oasdiff 1.15 supports the contract's
// OpenAPI 3.1.0 natively.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", targetBranch]).trim();
} catch {
  console.error(`api:breaking: cannot resolve merge base against ${targetBranch}; ` +
    `run inside a YearningX worktree with the target branch fetched.`);
  process.exit(2);
}

const currentOpenapi = git(["show", `HEAD:${openapiRel}`]);
const baselineOpenapi = git(["show", `${mergeBase}:${openapiRel}`]);

if (currentOpenapi === baselineOpenapi) {
  console.log(`api:breaking: ${openapiRel} unchanged since merge base ${mergeBase.slice(0, 12)}; no detection needed.`);
  process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), "yearning-openapi-"));
const baselinePath = join(temp, "baseline.yaml");
const currentPath = join(temp, "current.yaml");
writeFileSync(baselinePath, baselineOpenapi);
writeFileSync(currentPath, currentOpenapi);

const oasdiff = await import("@oasdiff-js/oasdiff-js");
const result = await oasdiff.runOasdiffBreaking(baselinePath, currentPath, []);

let findings = [];
try {
  findings = JSON.parse(String(result.stdout || "[]"));
} catch {
  console.error("api:breaking: detector produced unparseable output:", String(result.stdout));
  process.exit(2);
}

if (findings.length === 0) {
  console.log(`api:breaking: no breaking changes against merge base ${mergeBase.slice(0, 12)}.`);
  process.exit(0);
}

console.error(`api:breaking: ${findings.length} breaking change(s) against merge base ${mergeBase.slice(0, 12)}:`);
for (const finding of findings) {
  console.error(`  - [${finding.id}] ${finding.text} (${finding.operation ?? ""} ${finding.path ?? ""})`);
}
console.error("An approved Requirement Change Proposal (api/development/requirement-change-proposal.schema.json) " +
  "is required before incompatible changes enter generation.");
process.exit(1);
