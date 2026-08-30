#!/usr/bin/env node
// Business semantic token gate (yearning-ui-design-spec.md §4): every
// --risk-*, --exec-* and --state-* token in global.css must keep WCAG 2.1 AA
// text contrast (>= 4.5:1) against --card in both the light and the dark
// theme. --chart-series-* aliases must resolve to the template chart tokens.
// Pure implementation of OKLCH -> linear sRGB -> relative luminance, no
// dependencies.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const css = readFileSync(join(frontendRoot, "src/app/styles/global.css"), "utf8");

const BUSINESS_TEXT_TOKENS = [
  "risk-critical",
  "risk-high",
  "risk-warning",
  "risk-safe",
  "exec-failed",
  "exec-partial-failed",
  "exec-cancelled",
  "state-forbidden",
  "state-reveal",
];
const CHART_SERIES = ["chart-series-1", "chart-series-2", "chart-series-3", "chart-series-4", "chart-series-5"];

function extractBlock(selector) {
  const marker = css.indexOf(`${selector} {`);
  if (marker < 0) throw new Error(`global.css: ${selector} block not found`);
  let depth = 0;
  for (let index = marker + selector.length; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", marker) + 1, index);
    }
  }
  throw new Error(`global.css: unterminated ${selector} block`);
}

function parseDeclarations(block) {
  const declarations = new Map();
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of stripped.split(";")) {
    const match = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+?)\s*$/);
    if (match) declarations.set(match[1], match[2]);
  }
  return declarations;
}

function resolveValue(declarations, name, depth = 0) {
  if (depth > 5) throw new Error(`cyclic var() reference at ${name}`);
  const raw = declarations.get(name);
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  const reference = raw.match(/^var\((--[\w-]+)\)$/);
  if (reference) return resolveValue(declarations, reference[1], depth + 1);
  return raw;
}

function oklchToLuminance(value) {
  const match = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!match) throw new Error(`unsupported color value: ${value}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hueDegrees = Number(match[3]);
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Browsers clamp out-of-gamut channels for display; clamp here so the
  // measured luminance is the one actually rendered.
  const clamp = (channel) => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(bl);
}

function contrast(front, back) {
  const [y1, y2] = [front, back].sort((x, y) => y - x);
  return (y1 + 0.05) / (y2 + 0.05);
}

const problems = [];
for (const [theme, selector] of [["light", ":root"], ["dark", ".dark"]]) {
  const declarations = parseDeclarations(extractBlock(selector));
  const card = oklchToLuminance(resolveValue(declarations, "--card"));
  for (const token of BUSINESS_TEXT_TOKENS) {
    const value = resolveValue(declarations, `--${token}`);
    const ratio = contrast(oklchToLuminance(value), card);
    if (ratio < 4.5) {
      problems.push(`${theme} --${token} = ${value} contrast ${ratio.toFixed(2)}:1 against --card (needs 4.5:1)`);
    } else {
      console.log(`${theme} --${token}: ${ratio.toFixed(2)}:1`);
    }
  }
  for (const token of CHART_SERIES) {
    const value = declarations.get(`--${token}`);
    if (!value || !/^var\(--chart-\d\)$/.test(value.trim())) {
      problems.push(`${theme} --${token} must alias var(--chart-N), got ${value ?? "(missing)"}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`token contrast: ${problem}\n`);
  process.exit(1);
}
console.log("token contrast ok: business semantic tokens meet WCAG 2.1 AA text contrast in both themes");
