#!/usr/bin/env node
// Raw color gate (yearning-ui-design-spec.md §3, §14): page and shell code
// must not use raw hex/rgb()/hsl() values or Tailwind palette classes; all
// color flows through semantic tokens. The token stylesheet itself and the
// generated API surface are excluded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const scanRoots = ["src/app", "src/routes", "src/shared", "src/assets"];
const scanExtensions = new Set([".ts", ".tsx", ".css", ".json"]);

const rawHex = /#[0-9a-fA-F]{3,8}\b/;
const rawFunction = /\b(rgba?|hsla?)\(/;
const paletteClass =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|divide|outline|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/;
const shadeLessPalette = /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white)\b/;
const arbitraryColor = /-\[(?:oklch|rgba?|hsla?|color-mix|lab|lch)/;

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

const violations = [];
for (const root of scanRoots) {
  const absoluteRoot = join(frontendRoot, root);
  const files = walk(absoluteRoot);
  for (const file of files) {
    if (!scanExtensions.has(file.slice(file.lastIndexOf(".")))) continue;
    const relativePath = relative(frontendRoot, file);
    if (relativePath === "src/app/styles/global.css") continue; // the token source itself
    if (relativePath.startsWith("src/api/generated/")) continue; // generated, contract-bound
    if (relativePath.startsWith("src/shared/components/ui/")) continue; // registry-vendored variant layer, hash-pinned
    if (relativePath.endsWith(".test.ts") || relativePath.endsWith(".test.tsx")) continue;
    if (relativePath.includes("asset-manifest.json")) continue; // provenance hashes, not UI color
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (paletteClass.test(line) || shadeLessPalette.test(line)) {
        violations.push(`${relativePath}:${index + 1}: palette class ${line.trim().slice(0, 90)}`);
      } else if (arbitraryColor.test(line)) {
        violations.push(`${relativePath}:${index + 1}: arbitrary color value ${line.trim().slice(0, 90)}`);
      } else if (rawFunction.test(line)) {
        violations.push(`${relativePath}:${index + 1}: raw color function ${line.trim().slice(0, 90)}`);
      } else if (rawHex.test(line) && !relativePath.startsWith("src/assets/")) {
        violations.push(`${relativePath}:${index + 1}: raw hex color ${line.trim().slice(0, 90)}`);
      }
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`raw color: ${violation}\n`);
  process.stderr.write(`raw color scan failed: ${violations.length} violation(s)\n`);
  process.exit(1);
}
console.log("raw color scan ok: no palette classes, raw functions or raw hex outside the token stylesheet");
