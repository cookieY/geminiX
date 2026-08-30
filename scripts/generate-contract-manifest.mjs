#!/usr/bin/env node
// Generates src/api/generated/contract-manifest.json, the machine record bound by
// api/development/frontend-generated-contract-manifest.schema.json and validated by
// YearningX scripts/contracts/validate_frontend_operation_coverage.py
// (validate_generated_contract_manifest). The output-tree hash must match the
// Python sha256_path algorithm byte for byte: sorted relative posix paths, each
// contributing `relative \0 content \0`.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const yearningRoot = resolve(frontendRoot, "..");

const SOURCE_CONTRACTS = {
  openapi: "api/openapi/yearning-v4.yaml",
  error_codes: "api/contracts/error-codes.json",
  operation_error_profiles: "api/contracts/operation-error-profiles.json",
  state_machines: "api/contracts/state-machines.json",
};

const OUTPUTS = {
  typescript_client: "src/api/generated/client",
  zod_runtime_schemas: "src/api/generated/zod",
  tanstack_query_hooks: "src/api/generated/hooks",
  msw_mock_handlers: "src/api/generated/mocks",
  business_error_catalog: "src/api/generated/projections/business-error-catalog.ts",
  operation_error_profiles: "src/api/generated/projections/operation-error-profiles.ts",
  state_display_projection: "src/api/generated/projections/state-display-projection.ts",
};

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function sha256Path(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`generated output tree contains a symlink: ${path}`);
  if (stat.isFile()) return sha256File(path);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = lstatSync(full);
      if (s.isSymbolicLink()) throw new Error(`generated output tree contains a symlink: ${full}`);
      if (s.isDirectory()) walk(full);
      else if (s.isFile()) files.push(full);
    }
  };
  walk(path);
  if (files.length === 0) throw new Error(`generated output directory is empty: ${path}`);
  files.sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(relative(path, file).split("\\").join("/"));
    digest.update(Buffer.alloc(1, 0));
    digest.update(readFileSync(file));
    digest.update(Buffer.alloc(1, 0));
  }
  return digest.digest("hex");
}

const packageJson = JSON.parse(readFileSync(join(frontendRoot, "package.json"), "utf8"));
const orvalVersion = packageJson.devDependencies.orval ?? packageJson.dependencies.orval;
if (!/^\d+\.\d+\.\d+/.test(orvalVersion)) {
  throw new Error(`orval version must be exact in package.json, found: ${orvalVersion}`);
}

const manifest = {
  contract_version: 1,
  sources: Object.fromEntries(
    Object.entries(SOURCE_CONTRACTS).map(([name, path]) => [
      name,
      { path, sha256: sha256File(resolve(yearningRoot, path)) },
    ]),
  ),
  generator: {
    name: "orval",
    version: orvalVersion,
    version_source: "package.json",
    lockfile: "pnpm-lock.yaml",
    lockfile_sha256: sha256File(join(frontendRoot, "pnpm-lock.yaml")),
  },
  generation_command: "pnpm api:generate",
  outputs: Object.fromEntries(
    Object.entries(OUTPUTS).map(([name, path]) => [
      name,
      { path, sha256: sha256Path(resolve(frontendRoot, path)) },
    ]),
  ),
  authorization_policy_generated: false,
  generated_at: new Date().toISOString(),
};

const target = join(frontendRoot, "src/api/generated/contract-manifest.json");

// Idempotence: generated_at is the only nondeterministic field. When every
// hash matches the already-committed manifest, keep the original timestamp so
// regeneration is byte-stable (clean_tree_regeneration_diff: must_be_empty).
try {
  const existing = JSON.parse(readFileSync(target, "utf8"));
  const stripTimestamp = ({ generated_at: _ignored, ...facts }) => facts; // eslint-disable-line no-unused-vars
  if (JSON.stringify(stripTimestamp(manifest)) === JSON.stringify(stripTimestamp(existing))) {
    manifest.generated_at = existing.generated_at;
  }
} catch {
  // No existing manifest (first generation) — keep the fresh timestamp.
}

writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
console.log(`contract-manifest.json written: ${Object.keys(manifest.outputs).length} outputs, ` +
  `${Object.keys(manifest.sources).length} sources`);
