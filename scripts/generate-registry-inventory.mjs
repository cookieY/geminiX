#!/usr/bin/env node
// Generates registry-inventory.json: the component source inventory required by
// FE-F1 (docs/frontend/yearning-ui-design-spec.md §12 — shadcn registry entries
// carry no semantic version, so pinning means recording each entry's content
// SHA-256 at introduction plus the landed file hashes). Re-run with --check to
// verify landed files still match the recorded hashes. Adding components later
// re-runs `shadcn add` and refreshes the entry for that component only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const componentsJson = JSON.parse(readFileSync(join(frontendRoot, "components.json"), "utf8"));
const COMPONENTS = [
  "alert",
  "avatar",
  "badge",
  "button",
  "card",
  "dropdown-menu",
  "empty",
  "input",
  "label",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "sonner",
  "spinner",
  "tooltip",
  "use-mobile",
];
const REGISTRY_BASE = "https://ui.shadcn.com/r/styles";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sha256File = (path) => sha256(readFileSync(path));

// Map a landed ui file back to the registry style path recorded in components.json.
const style = componentsJson.style;

const inventory = {
  contract_version: 1,
  registry_base: REGISTRY_BASE,
  style,
  icon_library: componentsJson.iconLibrary,
  note: "shadcn registry entries have no semantic version; pinning is the entry content SHA-256 recorded at introduction plus landed file hashes (yearning-ui-design-spec.md section 12).",
  components: [],
};

const checkOnly = process.argv.includes("--check");

// Map a registry item file path (e.g. "registry/base-lyra/ui/sidebar.tsx",
// "registry/base-lyra/hooks/use-mobile") to its landed repo path using the
// aliases pinned in components.json — the same substitution the shadcn CLI
// performs when writing files.
const aliasRoot = (alias) => alias.replace(/^@\//, "src/");
const landedPathFor = (registryPath) => {
  const relative = registryPath.replace(new RegExp(`^registry/${style}/`), "");
  if (relative.startsWith("ui/")) return `${aliasRoot(componentsJson.aliases.ui)}/${relative.slice(3)}`;
  if (relative.startsWith("hooks/")) {
    const name = relative.slice(6);
    return `${aliasRoot(componentsJson.aliases.hooks)}/${name}${name.includes(".") ? "" : ".ts"}`;
  }
  if (relative.startsWith("lib/")) return `${aliasRoot(componentsJson.aliases.lib)}/${relative.slice(4)}.ts`;
  return `src/${relative}`;
};

const fetchRegistryItem = (name) => {
  const url = `${REGISTRY_BASE}/${style}/${name}.json`;
  const content = execFileSync("curl", ["-sf", url], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
  return { content, item: JSON.parse(content.toString("utf8")) };
};

if (!checkOnly) {
  for (const name of COMPONENTS) {
    const { content, item } = fetchRegistryItem(name);
    const files = (item.files ?? [])
      .filter((file) => file && typeof file.path === "string")
      .map((file) => landedPathFor(file.path))
      .map((relativePath) => ({
        path: relativePath.split("\\").join("/"),
        sha256: sha256File(join(frontendRoot, relativePath)),
      }));
    inventory.components.push({
      name,
      registry_type: item.type,
      content_sha256: sha256(content),
      files,
    });
  }
}

if (checkOnly) {
  // Real verification: compare the recorded inventory against (a) the landed
  // files on disk and (b) the registry entry content as served right now, so
  // both hand edits to landed components and upstream registry drift surface.
  const recorded = JSON.parse(readFileSync(join(frontendRoot, "registry-inventory.json"), "utf8"));
  let mismatches = 0;
  const recordedByName = new Map(recorded.components.map((c) => [c.name, c]));
  for (const name of COMPONENTS) {
    const entry = recordedByName.get(name);
    if (!entry) {
      process.stderr.write(`registry inventory check: ${name} missing from registry-inventory.json\n`);
      mismatches += 1;
      continue;
    }
    for (const file of entry.files) {
      try {
        if (sha256File(join(frontendRoot, file.path)) !== file.sha256) {
          process.stderr.write(`registry inventory check: landed file drifted from recorded hash: ${file.path}\n`);
          mismatches += 1;
        }
      } catch {
        process.stderr.write(`registry inventory check: recorded file missing: ${file.path}\n`);
        mismatches += 1;
      }
    }
    const url = `${REGISTRY_BASE}/${style}/${name}.json`;
    try {
      const content = execFileSync("curl", ["-sf", url], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
      if (sha256(content) !== entry.content_sha256) {
        process.stderr.write(`registry inventory check: upstream registry content changed for ${name} (recorded ${entry.content_sha256.slice(0, 12)}, now ${sha256(content).slice(0, 12)}); re-run shadcn add and refresh the entry deliberately\n`);
        mismatches += 1;
      }
    } catch (error) {
      process.stderr.write(`registry inventory check: cannot fetch ${url}: ${error.message}\n`);
      mismatches += 1;
    }
  }
  if (mismatches > 0) {
    process.stderr.write(`registry inventory check failed: ${mismatches} mismatch(es)\n`);
    process.exit(1);
  }
  console.log(`registry inventory check ok: ${recorded.components.length} components, landed files and upstream registry content match the recorded hashes`);
  process.exit(0);
}

const target = join(frontendRoot, "registry-inventory.json");
writeFileSync(target, JSON.stringify(inventory, null, 2) + "\n");
console.log(`registry-inventory.json written: ${inventory.components.length} components`);
