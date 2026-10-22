#!/usr/bin/env node
// Motion discipline scan (UI design spec §motion; source: the motion review that
// landed on 2026-10-22). Four rules the codebase already satisfies, pinned so a
// later change cannot quietly reintroduce them:
// (1) no `transition-all` — transition the properties that actually move,
// (2) never `ease-in` (accelerating) for UI; use ease-out / ease-in-out,
// (3) curves come from the two `--ease-*` tokens in global.css, not new literals,
// (4) UI transitions stay at or below 500ms, and nothing enters from scale(0).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const srcRoot = join(frontendRoot, "src");
const globalCss = join(srcRoot, "app/styles/global.css");

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
const report = (file, line, message) =>
  problems.push(`${relative(frontendRoot, file)}:${line} ${message}`);

// The only two curves the design system owns. Anything else is a new easing
// opinion smuggled into a component.
const CANONICAL_CURVES = [
  /^cubic-bezier\(\s*0?\.23,\s*1,\s*0?\.32,\s*1\s*\)$/,
  /^cubic-bezier\(\s*0?\.32,\s*0?\.72,\s*0,\s*1\s*\)$/,
];

// Tokens the CSS layer must keep defining; removing one silently flattens every
// component back onto Tailwind's built-in (too weak) default curve.
const REQUIRED_TOKENS = ["--ease-out", "--ease-sheet"];

// Tailwind's `duration-*` is milliseconds; arbitrary values may use ms or s.
const MAX_UI_DURATION_MS = 500;

const files = walk(srcRoot).filter((file) => /\.(ts|tsx|css)$/.test(file));

// Comments legitimately quote curves (the global.css header explains why the
// Tailwind defaults are too weak), so blank them out before scanning while
// keeping every newline so line numbers stay honest. Only whole comment lines
// and /* */ blocks are blanked — never inline code after a URL.
function stripComments(content) {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
        ? " ".repeat(line.length)
        : line;
    })
    .join("\n");
}

// Maps a character offset in the (comment-blanked) content to its 1-based line.
function lineAt(content, index) {
  return content.slice(0, index ?? 0).split("\n").length;
}

if (!existsSync(globalCss)) {
  process.stderr.write(`motion scan: missing ${relative(frontendRoot, globalCss)}\n`);
  process.exit(1);
}

const globalCssText = readFileSync(globalCss, "utf8");
for (const token of REQUIRED_TOKENS) {
  if (!new RegExp(`${token}\\s*:`).test(globalCssText)) {
    problems.push(`app/styles/global.css missing easing token ${token}`);
  }
}

for (const file of files) {
  const content = stripComments(readFileSync(file, "utf8"));
  const lines = content.split("\n");
  const isTest = /\.test\.[jt]sx?$/.test(file);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // (1) `transition-all` / `transition-property: all`.
    if (/\btransition-all\b/.test(line) || /transition-property:\s*all\b/.test(line)) {
      report(file, lineNumber, "transition-all: name the properties that move (transition-[opacity,translate] etc.)");
    }

    // (2) Accelerating easing. `ease-in-out` stays legal, so require the match to
    // not be followed by `-out`.
    if (/(?<![\w-])ease-in(?![\w-])/.test(line)) {
      report(file, lineNumber, "ease-in accelerates into the change: use ease-out (enter) or ease-in-out (on-screen move)");
    }

    // (3) Every literal curve must be one of the two design-system curves.
    for (const match of line.matchAll(/cubic-bezier\([^)]*\)/g)) {
      if (!CANONICAL_CURVES.some((pattern) => pattern.test(match[0]))) {
        report(file, lineNumber, `off-token curve ${match[0]}: use var(--ease-out) or var(--ease-sheet)`);
      }
    }

    // (4a) Transition duration ceiling. Decorative keyframe loops (the skeleton
    // shimmer at 1.4s) are exempt: they do not gate interaction.
    for (const match of line.matchAll(/\bduration-(\d+)\b/g)) {
      const ms = Number(match[1]);
      if (ms > MAX_UI_DURATION_MS) {
        report(file, lineNumber, `duration-${match[1]} exceeds the ${MAX_UI_DURATION_MS}ms UI ceiling`);
      }
    }
    for (const match of line.matchAll(/\bduration-\[(\d+(?:\.\d+)?)(ms|s)\]/g)) {
      const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
      if (ms > MAX_UI_DURATION_MS) {
        report(file, lineNumber, `duration-[${match[1]}${match[2]}] exceeds the ${MAX_UI_DURATION_MS}ms UI ceiling`);
      }
    }
    for (const match of line.matchAll(/transition-duration:\s*(\d+(?:\.\d+)?)(ms|s)\b/g)) {
      const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
      if (ms > MAX_UI_DURATION_MS) {
        report(file, lineNumber, `${match[0]} exceeds the ${MAX_UI_DURATION_MS}ms UI ceiling`);
      }
    }

    // (4b) Never enter from scale(0) — it reads as a pop, not a surface.
    if (/\bscale-0\b/.test(line) || /\bzoom-in-0\b/.test(line) || /\bscale:\s*0\b/.test(line)) {
      report(file, lineNumber, "entry from scale(0): start at 0.95 with opacity 0 instead");
    }
  });

  // (1b) The same "name the properties" rule, but across line breaks: a
  // `transition: all 200ms` shorthand, a Tailwind arbitrary `transition-[all]`,
  // or a `transition-property:` split over two lines all evade the per-line
  // checks above, because the space between the colon and `all` is a newline.
  const acrossLines = [
    {
      pattern: /transition-property:\s*all\b/g,
      message: "transition-property: all — name the properties that move",
    },
    {
      pattern: /transition:\s*all\b/g,
      message: "transition: all shorthand — name the properties that move",
    },
    {
      pattern: /transition-\[[^\]]*\ball\b[^\]]*\]/g,
      message: "transition-[…all…] arbitrary value — name the properties that move",
    },
    {
      pattern: /transitionProperty:\s*["']all["']/g,
      message: "transitionProperty = 'all' — name the properties that move",
    },
    {
      pattern: /transition:\s*["'`]all\b/g,
      message: "transition: 'all' inside a style object — name the properties that move",
    },
  ];
  for (const rule of acrossLines) {
    for (const match of content.matchAll(rule.pattern)) {
      report(file, lineAt(content, match.index), rule.message);
    }
  }

  // (4c) Shorthand durations (`transition: opacity 2s`) bypass the duration-*
  // checks above, and a long hand-off is just as sluggish.
  for (const match of content.matchAll(/transition:[^;}]*?\b(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
    if (ms > MAX_UI_DURATION_MS) {
      report(file, lineAt(content, match.index), `${match[0].trim()} exceeds the ${MAX_UI_DURATION_MS}ms UI ceiling`);
    }
  }

  // (4d) `scale-x-0` / `scale-[0]` are the same pop as `scale-0`.
  if (/\bscale-[xy]-0\b/.test(content) || /\bscale-\[0(?:%|)\]/.test(content)) {
    report(file, 1, "entry from scale(0): start at 0.95 with opacity 0 instead");
  }

  // (2b) The same acceleration rule for CSS timing functions and WAAPI options.
  if (!isTest && /\banimation-timing-function:\s*ease-in\b/.test(content)) {
    report(file, 1, "animation-timing-function: ease-in on a CSS animation");
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`motion scan: ${problem}\n`);
  process.exit(1);
}

console.log(
  `motion scan ok: ${files.length} files checked — no transition-all, no ease-in, curves from --ease-out/--ease-sheet, durations <= ${MAX_UI_DURATION_MS}ms, no scale(0) entry`,
);
