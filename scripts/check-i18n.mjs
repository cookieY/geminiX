#!/usr/bin/env node
// i18n gate: zh-CN and en-US must define exactly the same key set with
// non-empty string values (migration contract §8 — missing-translation check).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

const flatten = (object, prefix = "") =>
  Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || typeof value !== "object") return [[path, value]];
    return flatten(value, path);
  });

const problems = [];
const keySets = {};
for (const locale of ["zh-CN", "en-US"]) {
  const document = JSON.parse(
    readFileSync(join(frontendRoot, "src/shared/i18n/locales", `${locale}.json`), "utf8"),
  );
  const entries = flatten(document);
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${locale}: empty translation for ${key}`);
    }
  }
  keySets[locale] = new Set(entries.map(([key]) => key));
}

const zhKeys = keySets["zh-CN"];
const enKeys = keySets["en-US"];
for (const key of zhKeys) {
  if (!enKeys.has(key)) problems.push(`en-US is missing key ${key}`);
}
for (const key of enKeys) {
  if (!zhKeys.has(key)) problems.push(`en-US defines key ${key} missing from zh-CN`);
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`i18n check: ${problem}\n`);
  process.exit(1);
}
console.log(`i18n check ok: ${zhKeys.size} keys, zh-CN and en-US in parity`);
