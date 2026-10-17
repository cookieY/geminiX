#!/usr/bin/env node
/**
 * Mock/Real contract divergence report (FE-F12).
 *
 * Joins the two contract-suite reports (tests/contract/.reports/mock.json and
 * real.json) case by case and classifies every pair:
 *   schema_invalid   — a 200 envelope failed the generated zod schema (gate)
 *   status_divergent — different HTTP status between modes
 *   errcode_divergent— different err_code between modes
 *   parity           — identical status + err_code + schema verdict
 * Rows carrying a `note` are known, accepted gaps (e.g. the mock does not
 * model authorization) and are listed separately from unexplained ones.
 *
 * Identity gate: both reports must have run against the same zod artifact,
 * and that digest must equal contract-manifest.json outputs.zod_runtime_schemas
 * (the generated runtime schema pinned to the OpenAPI SHA-256).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const mockPath = process.argv[2] ?? resolve(root, "tests/contract/.reports/mock.json");
const realPath = process.argv[3] ?? resolve(root, "tests/contract/.reports/real.json");
const outPath = process.argv[4] ?? resolve(root, "tests/contract/.reports/mock-real-diff.json");

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const mock = load(mockPath);
const real = load(realPath);
const manifest = load(resolve(root, "src/api/generated/contract-manifest.json"));
const zodDigest = manifest.outputs.zod_runtime_schemas.sha256;

const identity = {
  manifest_zod_sha256: zodDigest,
  mock_sha256: mock.runtime_schema_sha256,
  real_sha256: real.runtime_schema_sha256,
  identical: mock.runtime_schema_sha256 === zodDigest && real.runtime_schema_sha256 === zodDigest,
};

const key = (r) => `${r.operation_id}::${r.case_id}`;
const byKey = (rows) => new Map(rows.map((r) => [key(r), r]));
const mockRows = byKey(mock.rows);
const realRows = byKey(real.rows);

const pairs = [];
for (const [k, m] of mockRows) {
  const r = realRows.get(k);
  if (!r) { pairs.push({ key: k, operation_id: m.operation_id, case_id: m.case_id, classification: "real_missing", mock: m, real: null, ...(m.note ? { note: m.note, accepted: true } : {}) }); continue; }
  const schemaInvalid = m.schema_valid === false || r.schema_valid === false;
  let classification = "parity";
  if (schemaInvalid) classification = "schema_invalid";
  else if (m.http_status !== r.http_status) classification = "status_divergent";
  else if (m.err_code !== r.err_code) classification = "errcode_divergent";
  pairs.push({
    key: k, operation_id: m.operation_id, case_id: m.case_id, classification,
    accepted: Boolean(m.note || r.note), note: m.note ?? r.note ?? null,
    mock: { http_status: m.http_status, err_code: m.err_code, schema_valid: m.schema_valid, issues: m.issues },
    real: { http_status: r.http_status, err_code: r.err_code, schema_valid: r.schema_valid, issues: r.issues },
  });
}
for (const [k, r] of realRows) {
  if (!mockRows.has(k)) pairs.push({ key: k, operation_id: r.operation_id, case_id: r.case_id, classification: "mock_missing", mock: null, real: r, ...(r.note ? { note: r.note, accepted: true } : {}) });
}

const count = (pred) => pairs.filter(pred).length;
const summary = {
  pairs: pairs.length,
  operations: new Set(pairs.map((p) => p.operation_id)).size,
  parity: count((p) => p.classification === "parity"),
  schema_invalid: count((p) => p.classification === "schema_invalid"),
  status_divergent: count((p) => p.classification === "status_divergent"),
  errcode_divergent: count((p) => p.classification === "errcode_divergent"),
  missing: count((p) => p.classification.endsWith("_missing")),
  unexplained_divergences: count((p) => p.classification !== "parity" && !p.accepted),
  accepted_divergences: count((p) => p.classification !== "parity" && p.accepted),
};

const report = {
  contract_version: 1,
  generated_at: new Date().toISOString(),
  mock_base: mock.base_url, real_base: real.base_url,
  runtime_schema_identity: identity,
  summary,
  pairs: pairs.sort((a, b) => a.key.localeCompare(b.key)),
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`mock/real diff → ${outPath}`);
console.log(JSON.stringify({ identity: identity.identical, ...summary }));
if (!identity.identical) { console.error("runtime schema identity mismatch"); process.exit(1); }
if (summary.schema_invalid > 0) { console.error("schema-invalid envelopes present"); process.exit(1); }
