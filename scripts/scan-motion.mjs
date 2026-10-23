#!/usr/bin/env node
// Motion discipline scan (UI design spec §motion; source: the motion review that
// landed on 2026-10-22). Six rules the codebase already satisfies, pinned so a
// later change cannot quietly reintroduce them:
// (1) no catch-all transition — name the properties that actually move,
// (2) never `ease-in` (accelerating) for UI; use ease-out / ease-in-out,
// (3) curves come from the two `--ease-*` tokens in global.css, not new literals,
// (4) UI transitions stay at or below 500ms, and nothing enters from scale(0),
// (5) no transition on a layout property (width/height/inset/margin/padding/gap):
//     those reflow on every frame. Three sidebar occupancy transitions are a
//     reviewed exception — see ALLOWED_LAYOUT_TRANSITIONS and
//     artifacts/development/FE-F11-MOTION-SPATIAL/assessment.md,
// (6) on a surface that owns both an enter and an exit state, dismissal is
//     faster than arrival (enter:exit between 1.2x and 2.0x). Judged only on
//     lines carrying `data-open`/`data-starting-style`/`data-closed`/
//     `data-ending-style`, so a plain hover transition is not mistaken for an
//     overlay lifecycle.
//
// `node scripts/scan-motion.mjs --self-test` runs the fixtures below, and
// `pnpm check:motion` runs both. The fixtures assemble class strings at runtime
// on purpose: a literal layout-transition utility in this file is picked up by
// Tailwind's source scanner — even inside a comment — and would ship a junk rule
// in the CSS bundle (review finding N1).
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

// The only curves the design system owns. Anything else is a new easing opinion
// smuggled into a component. --ease-data is the flatter data curve (charts,
// counting numbers); --ease-out remains the interaction curve.
const CANONICAL_CURVES = [
  /^cubic-bezier\(\s*0?\.23,\s*1,\s*0?\.32,\s*1\s*\)$/,
  /^cubic-bezier\(\s*0?\.32,\s*0?\.72,\s*0,\s*1\s*\)$/,
  /^cubic-bezier\(\s*0?\.25,\s*0?\.46,\s*0?\.45,\s*0?\.94\s*\)$/,
];

// Tokens the CSS layer must keep defining; removing one silently flattens every
// component back onto Tailwind's built-in (too weak) default curve.
const REQUIRED_TOKENS = ["--ease-out", "--ease-sheet", "--ease-data"];

// Tailwind's `duration-*` is milliseconds; arbitrary values may use ms or s.
const MAX_UI_DURATION_MS = 500;

// ---------------------------------------------------------------- rule 5 data
// Layout properties reflow siblings every frame; only transform/opacity are
// compositor-only. Logical and min/max variants count too, so the canonical form
// resolves both qualifiers and longhand atoms.
const LAYOUT_ATOMS = new Set([
  "width",
  "height",
  "inline-size",
  "block-size",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "margin",
  "padding",
  "gap",
  "grid-template",
  "flex-basis",
]);

function canonicalProperty(rawToken) {
  const token = String(rawToken)
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
  // Exact atoms first: `inline-size` / `block-size` are atoms, not qualifiers.
  if (LAYOUT_ATOMS.has(token)) return token;
  // Longhands resolve to their atom: `margin-inline-start`, `padding-block`,
  // `inset-inline-start`, `grid-template-columns`, `row-gap`, `column-gap`.
  for (const atom of ["inset", "margin", "padding", "gap", "grid-template"]) {
    if (token === atom || token.startsWith(`${atom}-`) || token.endsWith(`-${atom}`)) return atom;
  }
  // `max-height`, `min-width`, `inline-size` written with a qualifier prefix.
  let stripped = token;
  for (;;) {
    const next = stripped.replace(/^(min|max|inline|block)-/, "");
    if (next === stripped) break;
    stripped = next;
    if (LAYOUT_ATOMS.has(stripped)) return stripped;
  }
  return stripped;
}

const isLayoutProperty = (rawToken) => LAYOUT_ATOMS.has(canonicalProperty(rawToken));

// Reviewed exceptions. A finding on one of these lines is silenced only when the
// line contains the anchor AND its entire set of transition tokens equals the
// recorded set, so appending any further transition (arbitrary value or
// the Tailwind arbitrary property form) fails the scan. None of these claims "the rail
// is exempt"; each names the geometry it actually owns.
const ALLOWED_LAYOUT_TRANSITIONS = [
  {
    file: "src/shared/components/ui/sidebar.tsx",
    anchor: "bg-transparent transition-[width] duration-200 ease-out",
    tokens: ["transition-[width]"],
    why: "sidebar-gap: the placeholder column whose width reflow IS the occupancy change.",
  },
  {
    file: "src/shared/components/ui/sidebar.tsx",
    anchor: "transition-[translate,width] duration-200 ease-out",
    tokens: ["transition-[translate,width]"],
    why: "sidebar-container: icon mode collapses the rail's own width; offcanvas slides via translate.",
  },
  {
    file: "src/shared/components/ui/sidebar.tsx",
    anchor: "transition-[width,height,padding] group-has-data-[sidebar=menu-action]",
    tokens: ["transition-[width,height,padding]"],
    why: "menu-button: the collapsed icon size (p-2 to size-8), not expressible with transform.",
  },
];

// Every transition token on a line, across all the syntaxes rule 5 understands.
function transitionTokensOnLine(line) {
  return [
    ...[...line.matchAll(/transition-\[([^\]]*)\]/g)].map((match) => `transition-[${match[1]}]`),
    ...[...line.matchAll(/\[transition-property:([^\]]*)\]/g)].map(
      (match) => `transition-property:[${match[1]}]`,
    ),
    ...[...line.matchAll(/\[transition:([^\]]*)\]/g)].map((match) => `transition:[${match[1]}]`),
  ].sort();
}

function isAllowedLayoutTransition(file, line) {
  const relativeFile = relative(frontendRoot, file).split("\\").join("/");
  const tokens = transitionTokensOnLine(line);
  return ALLOWED_LAYOUT_TRANSITIONS.some(
    (allowed) =>
      allowed.file === relativeFile &&
      line.includes(allowed.anchor) &&
      tokens.length === allowed.tokens.length &&
      allowed.tokens.every((token, index) => token === tokens[index]),
  );
}

// ---------------------------------------------------------------- detectors
// Every detector takes the comment-blanked content of one file and returns
// `{ line, message }` records, so the fixtures below exercise exactly what the
// real scan uses.
function detectLayoutTransitions(file, content) {
  const found = [];
  const lines = content.split("\n");
  const offendersIn = (value, { skipAll = false } = {}) =>
    value
      .split(/[,\s]+/)
      .filter((token) => token && (!skipAll || token !== "all") && isLayoutProperty(token));

  // (5a) Tailwind arbitrary values: `transition-[width]`,
  // the arbitrary property form, and the arbitrary shorthand form.
  lines.forEach((line, index) => {
    const offenders = [
      ...[...line.matchAll(/transition-\[([^\]]*)\]/g)].flatMap((match) => offendersIn(match[1])),
      ...[...line.matchAll(/\[transition-property:([^\]]*)\]/g)].flatMap((match) =>
        offendersIn(match[1]),
      ),
      ...[...line.matchAll(/\[transition:([^\]]*)\]/g)].flatMap((match) =>
        offendersIn(match[1].replace(/_/g, " ")),
      ),
    ];
    if (offenders.length === 0) return;
    if (isAllowedLayoutTransition(file, line)) return;
    found.push({
      line: index + 1,
      message: `layout property in a transition (${offenders.join(", ")}): animate transform/opacity instead`,
    });
  });

  // (5b) CSS shorthand `transition: width 200ms`, including vendor prefixes,
  // stray whitespace before the colon and `Transition:`. A quoted value is a
  // style object and belongs to (5c).
  for (const match of content.matchAll(/(?:-webkit-)?transition\s*:\s*([^;}]+)/gi)) {
    if (/^["'`]/.test(match[1].trim())) continue;
    const offenders = offendersIn(match[1], { skipAll: true });
    if (offenders.length === 0) continue;
    found.push({
      line: content.slice(0, match.index).split("\n").length,
      message: `layout property in a transition shorthand (${offenders.join(", ")}): animate transform/opacity instead`,
    });
  }

  // (5c) JS style objects: `transitionProperty: "width"`, `transition: "width 200ms"`.
  for (const match of content.matchAll(/transitionProperty:\s*["'`]([^"'`]+)["'`]/g)) {
    const offenders = offendersIn(match[1]);
    if (offenders.length === 0) continue;
    found.push({
      line: content.slice(0, match.index).split("\n").length,
      message: `layout property in transitionProperty (${offenders.join(", ")}): animate transform/opacity instead`,
    });
  }
  for (const match of content.matchAll(/\btransition:\s*["'`]([^"'`]+)["'`]/g)) {
    const offenders = offendersIn(match[1], { skipAll: true });
    if (offenders.length === 0) continue;
    found.push({
      line: content.slice(0, match.index).split("\n").length,
      message: `layout property in a transition string (${offenders.join(", ")}): animate transform/opacity instead`,
    });
  }

  // (5d) CSS longhand `transition-property: width, opacity` — the bare form, not
  // the Tailwind arbitrary one. `all` is rule (1)'s job.
  // `(?<!\[)` keeps the Tailwind arbitrary property form
  // in 5a's hands; without it the same token would be reported twice.
  for (const match of content.matchAll(/(?<!\[)transition-property\s*:\s*([^;}]+)/gi)) {
    const offenders = offendersIn(match[1], { skipAll: true });
    if (offenders.length === 0) continue;
    found.push({
      line: content.slice(0, match.index).split("\n").length,
      message: `layout property in transition-property (${offenders.join(", ")}): animate transform/opacity instead`,
    });
  }

  return found;
}

// ------------------------------------------------------- rule 6: enter vs exit
// Lifecycle timing lives in class strings, not in code lines: scan each string
// literal and only evaluate the ones that name a state variant. This sees
// `duration-150` (non-bracket), `data-[state=open]:` prefixes and multi-line
// template literals, and fails closed when a stateful animation has no
// parseable duration at all.
const ENTER_STATE = /data-(?:open|starting-style):|data-\[state=open\]:/;
const EXIT_STATE = /data-(?:closed|ending-style):|data-\[state=closed\]:/;
const ENTER_DURATION =
  /(?:data-(?:open|starting-style):|data-\[state=open\]:)duration-(?:\[(\d+(?:\.\d+)?)(ms|s)\]|(\d+))/g;
const EXIT_DURATION =
  /(?:data-(?:closed|ending-style):|data-\[state=closed\]:)duration-(?:\[(\d+(?:\.\d+)?)(ms|s)\]|(\d+))/g;
const BASE_DURATION = /(?<![\w:-])duration-(?:\[(\d+(?:\.\d+)?)(ms|s)\]|(\d+))(?!-?[\w-])/g;
const STATEFUL_ANIMATION = /animate-(?:in|out)/;

const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/gs;

function durationsIn(string, pattern) {
  return [...string.matchAll(pattern)].map((match) => {
    const amount = Number(match[1] ?? match[3]);
    const unit = match[2] ?? "ms";
    return unit === "s" ? amount * 1000 : amount;
  });
}

function detectEnterExitAsymmetry(file, content) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  const found = [];
  for (const match of content.matchAll(STRING_LITERAL)) {
    const value = match[2];
    const hasEnterState = ENTER_STATE.test(value);
    const hasExitState = EXIT_STATE.test(value);
    if (!hasEnterState && !hasExitState) continue;

    const explicitEnter = durationsIn(value, ENTER_DURATION);
    const explicitExit = durationsIn(value, EXIT_DURATION);
    const base = durationsIn(value, BASE_DURATION);
    const enter = explicitEnter.length > 0 ? Math.max(...explicitEnter) : base.length > 0 ? Math.max(...base) : null;
    const exit = explicitExit.length > 0 ? Math.min(...explicitExit) : base.length > 0 ? Math.min(...base) : null;
    const line = content.slice(0, match.index).split("\n").length;

    if (enter === null && exit === null) {
      if (STATEFUL_ANIMATION.test(value)) {
        found.push({
          line,
          message:
            "stateful animation has no parseable enter/exit duration — write duration-[Nms] for each state",
        });
      }
      continue;
    }
    if (enter !== null && exit === null) {
      found.push({
        line,
        message: `entry duration ${enter}ms without an exit duration — dismissal must be faster`,
      });
      continue;
    }
    if (enter === null && exit !== null) {
      found.push({
        line,
        message: `exit duration ${exit}ms without an entry duration — measure both sides`,
      });
      continue;
    }
    if (enter === exit) {
      found.push({
        line,
        message: `enter ${enter}ms / exit ${exit}ms = 1.00x — make dismissal faster than arrival`,
      });
      continue;
    }
    const ratio = enter / exit;
    if (ratio < 1.2 || ratio > 2) {
      found.push({
        line,
        message: `enter ${enter}ms / exit ${exit}ms = ${ratio.toFixed(2)}x — keep enter:exit between 1.2x and 2.0x`,
      });
    }
  }
  return found;
}

// ------------------------------------------------------- rule 5c/6c: CSS-only motion
// Classes are not the only place motion is authored: global.css owns keyframes
// and can carry lifecycle selectors. Rule 5 already reads CSS transition
// declarations, but keyframes and data-state durations were invisible before.
const CSS_LAYOUT_PROP = /(?:^|[;{\s])(width|height|inline-size|block-size|top|right|bottom|left|inset|margin[\w-]*|padding[\w-]*|gap|grid-template[\w-]*|flex-basis)\s*:/g;
const CSS_ENTER_STATE = /\[data-(?:open|starting-style)(?:=[^\]]*)?\]|\[data-state=["']?open["']?\]/;
const CSS_EXIT_STATE = /\[data-(?:closed|ending-style)(?:=[^\]]*)?\]|\[data-state=["']?closed["']?\]/;

function cssKeyframes(content) {
  const bodies = [];
  const opener = /@keyframes\s+[\w-]+\s*\{/g;
  for (const match of content.matchAll(opener)) {
    let index = opener.lastIndex;
    let depth = 1;
    const bodyStart = index;
    for (; index < content.length && depth > 0; index += 1) {
      if (content[index] === "{") depth += 1;
      else if (content[index] === "}") depth -= 1;
    }
    bodies.push({ body: content.slice(bodyStart, index - 1), offset: match.index });
  }
  return bodies;
}

function detectCssMotion(file, content) {
  if (!/\.css$/.test(file)) return [];
  const found = [];

  for (const keyframe of cssKeyframes(content)) {
    const props = [...keyframe.body.matchAll(CSS_LAYOUT_PROP)].map((match) => match[1]);
    if (props.length > 0) {
      found.push({
        line: content.slice(0, keyframe.offset).split("\n").length,
        message: `layout property in @keyframes (${[...new Set(props)].join(", ")}): animate transform/opacity instead`,
      });
    }
  }

  const enter = [];
  const exit = [];
  for (const match of content.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const body = match[2];
    if (!/transition(?:-duration)?\s*:/.test(body)) continue;
    const values = [
      ...body.matchAll(/(?:^|[;\s])transition-duration\s*:\s*([^;]+)/g),
      ...body.matchAll(/(?:^|[;\s])transition\s*:\s*([^;]+)/g),
    ].flatMap((entry) =>
      [...entry[1].matchAll(/(\d+(?:\.\d+)?|\.\d+)(ms|s)\b/g)].map((value) =>
        value[2] === "s" ? Number(value[1]) * 1000 : Number(value[1]),
      ),
    );
    if (values.length === 0) continue;
    if (CSS_ENTER_STATE.test(selector)) enter.push(...values);
    if (CSS_EXIT_STATE.test(selector)) exit.push(...values);
  }
  if (enter.length > 0 && exit.length > 0) {
    const entry = Math.max(...enter);
    const dismissal = Math.min(...exit);
    if (entry === dismissal) {
      found.push({
        line: 1,
        message: `css enter ${entry}ms / exit ${dismissal}ms = 1.00x — make dismissal faster than arrival`,
      });
    } else {
      const ratio = entry / dismissal;
      if (ratio < 1.2 || ratio > 2) {
        found.push({
          line: 1,
          message: `css enter ${entry}ms / exit ${dismissal}ms = ${ratio.toFixed(2)}x — keep enter:exit between 1.2x and 2.0x`,
        });
      }
    }
  }

  return found;
}

function detectAll(file, content) {
  return [
    ...detectLayoutTransitions(file, content),
    ...detectEnterExitAsymmetry(file, content),
    ...detectCssMotion(file, content),
  ];
}

// ---------------------------------------------------------------- self-test
// Never write a full utility literal here: Tailwind scans this file too. `u()`
// assembles the strings at runtime so the bundle stays clean (finding N1).
const u = (...parts) => parts.join("");
const SIDEBAR = "src/shared/components/ui/sidebar.tsx";
const GAP_LINE = '          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-out",';
const CONTAINER_LINE = '          "fixed transition-[translate,width] duration-200 ease-out",';
const MENU_LINE = '          "transition-[width,height,padding] group-has-data-[sidebar=menu-action]",';

const FIXTURES = [
  { name: "arbitrary value", file: "src/a.tsx", code: `x = "transition-${u("[", "height]")}"`, expected: 1 },
  { name: "arbitrary property pair", file: "src/a.tsx", code: `x = "${u("[transition", "-property:width]")}"`, expected: 1 },
  { name: "arbitrary transition shorthand", file: "src/a.tsx", code: `x = "${u("[transition", ":margin_200ms]")}"`, expected: 1 },
  { name: "css shorthand", file: "src/a.css", code: `.a { transition: ${u("width")} 200ms; }`, expected: 1 },
  { name: "css shorthand, several properties", file: "src/a.css", code: `.a { transition: opacity 200ms, ${u("margin")} 1s; }`, expected: 1 },
  { name: "css longhand", file: "src/a.css", code: `.a { transition-property: ${u("width")}, opacity; }`, expected: 1 },
  { name: "css longhand across lines", file: "src/a.css", code: `.a { transition-property:\n  ${u("height")}; }`, expected: 1 },
  { name: "vendor prefixed shorthand", file: "src/a.css", code: `.a { -webkit-transition: ${u("width")} 200ms; }`, expected: 1 },
  { name: "shorthand with space before colon", file: "src/a.css", code: `.a { transition : ${u("width")} 200ms; }`, expected: 1 },
  { name: "capitalised shorthand", file: "src/a.css", code: `.a { Transition: ${u("width")} 200ms; }`, expected: 1 },
  { name: "js transitionProperty", file: "src/a.tsx", code: `const s = { transitionProperty: "${u("width")}" }`, expected: 1 },
  { name: "js transition string", file: "src/a.tsx", code: `const s = { transition: "${u("width")} 200ms" }`, expected: 1 },
  { name: "min/max qualifier", file: "src/a.tsx", code: `x = "transition-${u("[", "max-height]")}"`, expected: 1 },
  { name: "logical longhand", file: "src/a.tsx", code: `x = "transition-${u("[", "margin-inline-start]")}"`, expected: 1 },
  { name: "inline-size", file: "src/a.tsx", code: `x = "transition-${u("[", "inline-size]")}"`, expected: 1 },
  { name: "row-gap", file: "src/a.tsx", code: `x = "transition-${u("[", "row-gap]")}"`, expected: 1 },
  { name: "allowed gap width", file: SIDEBAR, code: GAP_LINE, expected: 0 },
  { name: "allowed container width+translate", file: SIDEBAR, code: CONTAINER_LINE, expected: 0 },
  { name: "allowed menu-button size", file: SIDEBAR, code: MENU_LINE, expected: 0 },
  {
    name: "allowlisted line with an appended arbitrary transition (fail-closed)",
    file: SIDEBAR,
    code: `${CONTAINER_LINE.slice(0, -3)} transition-${u("[", "height]")}",`,
    expected: 1,
  },
  {
    name: "allowlisted line with an appended bracketed property (fail-closed)",
    file: SIDEBAR,
    code: `${CONTAINER_LINE.slice(0, -3)} ${u("[transition", "-property:height]")}`,
    expected: 1,
  },
  {
    name: "bare layout transition inside sidebar.tsx without the anchor",
    file: SIDEBAR,
    code: `export const Fake = () => <div className="transition-${u("[", "width]")}" />;`,
    expected: 1,
  },
  { name: "allowlisted tokens copied into another file", file: "src/b.tsx", code: CONTAINER_LINE, expected: 1 },
  { name: "compositor-only transitions are clean", file: "src/a.tsx", code: `x = "transition-${u("[", "opacity,translate]")}"`, expected: 0 },
  { name: "transform shorthand is clean", file: "src/a.css", code: ".a { transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }", expected: 0 },
  { name: "leading-dot duration is not read as 15s", file: "src/a.css", code: ".a { transition: transform .15s; }", expected: 0 },
  { name: "symmetric enter/exit", file: "src/a.tsx", code: `x = "${u("data-open:duration-[160ms]")} ${u("data-closed:duration-[160ms]")}"`, expected: 1 },
  { name: "exit far too short", file: "src/a.tsx", code: `x = "${u("data-open:duration-[300ms]")} ${u("data-closed:duration-[100ms]")}"`, expected: 1 },
  { name: "entry without exit", file: "src/a.tsx", code: `x = "${u("data-open:duration-[160ms]")}"`, expected: 1 },
  { name: "base duration with faster exit", file: "src/a.tsx", code: `x = "duration-[280ms] ${u("data-ending-style:duration-[180ms]")}"`, expected: 0 },
  { name: "asymmetric pair", file: "src/a.tsx", code: `x = "${u("data-open:duration-[180ms]")} ${u("data-closed:duration-[120ms]")}"`, expected: 0 },
  { name: "base duration shared by both states", file: "src/a.tsx", code: `x = "duration-100 ${u("data-open:animate-in")} ${u("data-closed:animate-out")}"`, expected: 1 },
  { name: "a plain hover duration is not a lifecycle", file: "src/a.tsx", code: `x = "transition-colors duration-100"`, expected: 0 },
  { name: "two ordinary durations without state variants", file: "src/a.tsx", code: `x = "duration-200 ${u("data-active:duration-100")}"`, expected: 0 },
  {
    name: "non-bracket symmetric enter/exit",
    file: "src/a.tsx",
    code: `x = "${u("data-open:duration-150")} ${u("data-closed:duration-150")}"`,
    expected: 1,
  },
  {
    name: "non-bracket asymmetric enter/exit",
    file: "src/a.tsx",
    code: `x = "${u("data-open:duration-150")} ${u("data-closed:duration-100")}"`,
    expected: 0,
  },
  {
    name: "data-state=open/closed asymmetry",
    file: "src/a.tsx",
    code: `x = "${u("data-[state=open]:duration-[160ms]")} ${u("data-[state=closed]:duration-[100ms]")}"`,
    expected: 0,
  },
  {
    name: "data-state=open/closed symmetric",
    file: "src/a.tsx",
    code: `x = "${u("data-[state=open]:duration-[160ms]")} ${u("data-[state=closed]:duration-[160ms]")}"`,
    expected: 1,
  },
  {
    name: "state and duration on different template lines",
    file: "src/a.tsx",
    code: `x = \`${u("data-open:duration-[160ms]")}\n${u("data-closed:duration-[100ms]")}\``,
    expected: 0,
  },
  {
    name: "stateful animation without any duration fails closed",
    file: "src/a.tsx",
    code: `x = "${u("data-open:animate-in")} ${u("data-closed:animate-out")}"`,
    expected: 1,
  },
  {
    name: "css lifecycle asymmetric",
    file: "src/a.css",
    code: `[data-open] { transition-duration: 160ms; }\n[data-closed] { transition-duration: 100ms; }`,
    expected: 0,
  },
  {
    name: "css lifecycle symmetric",
    file: "src/a.css",
    code: `[data-open] { transition-duration: 160ms; }\n[data-closed] { transition-duration: 160ms; }`,
    expected: 1,
  },
  {
    name: "css lifecycle shorthand asymmetric",
    file: "src/a.css",
    code: `[data-open] { transition: opacity 160ms; }\n[data-closed] { transition: opacity 100ms; }`,
    expected: 0,
  },
  {
    name: "css lifecycle shorthand symmetric",
    file: "src/a.css",
    code: `[data-open] { transition: opacity 160ms; }\n[data-closed] { transition: opacity 160ms; }`,
    expected: 1,
  },
  {
    name: "css keyframe layout property",
    file: "src/a.css",
    code: `@keyframes grow {\n  from { width: 0; }\n  to { width: 100px; }\n}`,
    expected: 1,
  },
  {
    name: "css keyframe compositor-only",
    file: "src/a.css",
    code: `@keyframes fade {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: none; }\n}`,
    expected: 0,
  },
];

function selfTest() {
  const failures = [];
  for (const fixture of FIXTURES) {
    const found = detectAll(join(frontendRoot, fixture.file), fixture.code);
    if (found.length !== fixture.expected) {
      failures.push(`${fixture.name}: expected ${fixture.expected} violation(s), got ${found.length}`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const failures = selfTest();
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`motion scan self-test: ${failure}\n`);
    process.exit(1);
  }
  console.log(`motion scan self-test ok: ${FIXTURES.length} fixtures (rules 5-6 detectors)`);
  process.exit(0);
}

// ---------------------------------------------------------------- real scan
// Spelled in two pieces on purpose: a literal here would be picked up by
// Tailwind's source extractor and emitted into the bundle as a real utility.
const CATCH_ALL = new RegExp("\\btransition-" + "all\\b");

const problems = [];
const report = (file, line, message) =>
  problems.push(`${relative(frontendRoot, file)}:${line} ${message}`);

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

    // (1) the catch-all transition utility / `transition-property: all`.
    if (CATCH_ALL.test(line) || /transition-property\s*:\s*all\b/i.test(line)) {
      report(file, lineNumber, `${CATCH_ALL.source.replace(/\\b/g, "")}: name the properties that move (e.g. transition-[opacity,translate])`);
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
  // `transition: all 200ms` shorthand, a Tailwind arbitrary catch-all value,
  // or a `transition-property:` split over two lines all evade the per-line
  // checks above, because the space between the colon and `all` is a newline.
  const acrossLines = [
    {
      pattern: /transition-property:\s*all\b/gi,
      message: "transition-property: all — name the properties that move",
    },
    {
      pattern: /transition:\s*all\b/gi,
      message: "transition: all shorthand — name the properties that move",
    },
    {
      pattern: /transition-\[[^\]]*\ball\b[^\]]*\]/g,
      message: "an arbitrary-value transition containing all — name the properties that move",
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

  // (4c) Shorthand durations (`transition: opacity 2s`, `transition: transform
  // .15s`) bypass the duration-* checks; a leading dot must read as 0.15s, not
  // 15s (finding N3).
  for (const match of content.matchAll(
    /transition\s*:[^;}]*?(?<![\w.])(\d+(?:\.\d+)?|\.\d+)(ms|s)\b/gi,
  )) {
    const ms = Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
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

  // (6) Enter/exit asymmetry — see detectEnterExitAsymmetry for the scoping.
  // (5) Layout properties must not be animated (three reviewed sidebar
  // occupancy transitions are the only allowances).
  // (5c/6c) CSS keyframes and lifecycle selectors are only reachable through
  // detectAll; keep the real scan on that same path so a detector cannot ship
  // unwired (selfTest uses detectAll too).
  for (const finding of detectAll(file, content)) {
    report(file, finding.line, finding.message);
  }
}

// (5e) Each reviewed allowance must appear exactly once: the anchor check alone
// cannot tell the real sidebar line from the same class string pasted onto a new
// element in the same file, so count occurrences.
for (const allowed of ALLOWED_LAYOUT_TRANSITIONS) {
  const allowedPath = join(frontendRoot, allowed.file);
  if (!existsSync(allowedPath)) {
    report(allowedPath, 1, `reviewed exemption points at a file that does not exist: ${allowed.file}`);
    continue;
  }
  const allowedLines = stripComments(readFileSync(allowedPath, "utf8")).split("\n");
  const hits = allowedLines.filter((line) => line.includes(allowed.anchor));
  if (hits.length > 1) {
    report(
      allowedPath,
      allowedLines.findIndex((line) => line.includes(allowed.anchor)) + 1,
      `reviewed exemption for ${allowed.tokens.join(" ")} appears ${hits.length} times: only the original element may use it`,
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`motion scan: ${problem}\n`);
  process.exit(1);
}

console.log(
  `motion scan ok: ${files.length} files checked — no catch-all transition, no ease-in, curves from --ease-out/--ease-sheet/--ease-data, durations <= ${MAX_UI_DURATION_MS}ms, no scale(0) entry, no layout-property transitions outside the 3 reviewed sidebar exceptions`,
);
