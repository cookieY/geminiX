#!/usr/bin/env node
// Asset provenance gate (yearning-ui-design-spec.md §12, migration contract
// §7): every carried asset must (a) exist, (b) match the SHA-256 recorded in
// src/assets/brand/asset-manifest.json, (c) be the only copy of its content
// in the shipped asset locations, and (d) leave no file under src/assets/
// outside the manifest.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(frontendRoot, "src/assets/brand/asset-manifest.json"), "utf8"),
);

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

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
const contentToPath = new Map();
const manifestPaths = new Set();

for (const asset of manifest.assets) {
  manifestPaths.add(asset.path);
  const absolute = join(frontendRoot, asset.path);
  try {
    const hash = sha256File(absolute);
    if (hash !== asset.sha256) {
      problems.push(`${asset.path}: sha256 ${hash.slice(0, 12)} does not match manifest ${asset.sha256.slice(0, 12)}`);
    }
    const existing = contentToPath.get(hash);
    if (existing) {
      problems.push(`duplicate content: ${asset.path} and ${existing} are byte-identical`);
    } else {
      contentToPath.set(hash, asset.path);
    }
  } catch {
    problems.push(`${asset.path}: recorded in manifest but missing from the repository`);
  }
}

// Every font and image under public/ and src/assets/ must be manifest-covered.
const shippedLocations = [join(frontendRoot, "public"), join(frontendRoot, "src/assets")];
const publicRootExclusions = new Set([
  join(frontendRoot, "public", "mockServiceWorker.js"), // MSW tooling, dev/test only
]);
for (const location of shippedLocations) {
  for (const file of walk(location)) {
    if (publicRootExclusions.has(file)) continue;
    const relativePath = relative(frontendRoot, file).split("\\").join("/");
    if (relativePath === "src/assets/brand/asset-manifest.json") continue;
    if (!manifestPaths.has(relativePath)) {
      problems.push(`${relativePath}: asset file is not covered by asset-manifest.json`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`asset check: ${problem}\n`);
  process.exit(1);
}
console.log(`asset check ok: ${manifest.assets.length} assets match recorded hashes, no duplicates, no unmanifested files`);
