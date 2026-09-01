#!/usr/bin/env node
// Prohibited-content scans (FE-F2 acceptance gates; migration contract §8):
// (1) no template/Registry/MCP references in product code,
// (2) no Ant Design dependency, import or lockfile entry,
// (3) no chat shell entry (v4 has no AI chat — product contract P002).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      walk(absolute, files);
    } else {
      files.push(absolute);
    }
  }
  return files;
}

const problems = [];

// 1. Template / shadcndashboard Registry / MCP references must not appear in
// product code. Provenance documentation in asset-manifest.json is expected.
const codeFiles = walk(join(frontendRoot, "src"))
  .filter((file) => /\.(ts|tsx|css)$/.test(file))
  .concat([join(frontendRoot, "package.json"), join(frontendRoot, "index.html")]);
const templatePatterns = [/shadcndashboard/, /@shadcn-dashboard/, /ui\.shadcn\.com/];
for (const file of codeFiles) {
  const content = readFileSync(file, "utf8");
  for (const pattern of templatePatterns) {
    if (pattern.test(content)) {
      problems.push(`template/registry reference in ${relative(frontendRoot, file)}`);
    }
  }
}

// 2. Ant Design must not exist anywhere in dependencies, source or lockfile.
const antdTargets = walk(join(frontendRoot, "src"))
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .concat([join(frontendRoot, "package.json"), join(frontendRoot, "pnpm-lock.yaml")]);
for (const file of antdTargets) {
  const content = readFileSync(file, "utf8");
  if (/antd|@ant-design/.test(content)) {
    problems.push(`ant design reference in ${relative(frontendRoot, file)}`);
  }
}

// 3. No chat shell: routes, imports or components referencing chat.
const chatPattern = /chatbot|AiChat|\/chat\b|chat-session|ChatSession/;
for (const file of walk(join(frontendRoot, "src"))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  if (chatPattern.test(content)) {
    problems.push(`chat shell reference in ${relative(frontendRoot, file)}`);
  }
}

// 4. No AutoTask and no legacy datasource-permission transfer fields
// (migration contract §8; FE-F10 gate "旧核心页面无未处置项"). The scan is
// scoped to the legacy field names themselves — `flow_id` remains legal in
// v4 payloads (drafts, query sessions); only the removed datasource-level
// bindings use the *_source field names, so those are what we pin here.
const legacyPattern = /autotask|AutoTask|ddl_source|dml_source|query_source/;
for (const file of walk(join(frontendRoot, "src"))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  if (legacyPattern.test(content)) {
    problems.push(`legacy autotask/datasource-transfer reference in ${relative(frontendRoot, file)}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`prohibited scan: ${problem}\n`);
  process.exit(1);
}
console.log("prohibited scan ok: no template/registry/MCP refs in product code, no antd, no chat shell, no autotask/legacy datasource transfers");
