import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";
// editor.main (not editor.api): the api entry omits the editor
// contributions — the suggest widget, find, etc. — which the completion
// provider depends on. All languages ship here too; the chunk stays lazy.
import * as monaco from "monaco-editor/editor/editor.main.js";
// SQL is a monarch-highlighted basic language: tokenization runs on the main
// thread and only the general editor worker is needed. Bundled workers only —
// no runtime CDN or floating remote loading (UI spec §14).
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { useTheme } from "@/app/providers/theme-provider";

// Register the SQL language definition (monaco 0.56 layout) for monarch
// tokenization.
import "monaco-editor/languages/definitions/sql/register.js";

/**
 * Monaco SQL editor panel (frontend PRD F4; UI spec §7.4). The editor is the
 * SQL workspace core: bundled workers, one instance per mount with a single
 * unified dispose path (legacy baseline finding #12 — no leaked providers or
 * models), and a controlled `value` bridge for programmatic loads (reveal).
 * The syntax theme is the one sanctioned business-semantic exception to the
 * Shadcn Dashboard token system; container, toolbar and borders stay on
 * standard components.
 */

let environmentConfigured = false;
function configureWorkers(): void {
  if (environmentConfigured) return;
  environmentConfigured = true;
  self.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };
}

/**
 * Monaco's theme parser only accepts hex colors, not oklch(). The SQL syntax
 * theme is the one sanctioned business-semantic exception to the Shadcn
 * Dashboard token system (UI spec §4), so the two palettes are the template
 * semantic tokens (—card, —primary, —muted-foreground, —accent, —success,
 * —warning) statically converted to hex at adoption time.
 */
const THEME_COLORS = {
  light: {
    primary: "171717",
    success: "00a63e",
    warning: "9a6700",
    mutedForeground: "737373",
    card: "ffffff",
    accent: "f5f5f5",
    // --chart-3 hue (227°) with editor-legible lightness/chroma, static
    // conversions documented here: light L0.5 C0.13, dark L0.72 C0.07.
    keywordBlue: "006ba3",
    schemaTeal: "009689",
  },
  dark: {
    primary: "e5e5e5",
    success: "00a63e",
    warning: "f0b100",
    mutedForeground: "a1a1a1",
    card: "171717",
    accent: "262626",
    keywordBlue: "75aec7",
    schemaTeal: "009689",
  },
} as const;

function defineYearningThemes(resolved: "light" | "dark"): void {
  const dark = resolved === "dark";
  const palette = THEME_COLORS[resolved];
  monaco.editor.defineTheme("yearning-sql", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: palette.keywordBlue },
      { token: "string", foreground: palette.success },
      { token: "number", foreground: palette.warning },
      { token: "comment", foreground: palette.mutedForeground, fontStyle: "italic" },
      { token: "operator", foreground: palette.keywordBlue },
      { token: "predefined", foreground: palette.schemaTeal },
    ],
    colors: {
      "editor.background": `#${palette.card}`,
      "editorLineNumber.foreground": `#${palette.mutedForeground}`,
      "editor.selectionBackground": `#${palette.accent}`,
    },
  });
}

/** Optional schema/table/column catalog feeding the SQL completion provider.
 * Schemas come from the frozen flow's schema mappings; tables and columns
 * require a metadata read surface the submission journey does not have yet
 * (contract: metadata endpoints are query-session scoped only), so the
 * catalog ships empty there and lights up when a read surface exists. */
import {
  buildSqlSuggestions,
  type SqlCompletionCatalog,
} from "./sql-completions";

export type { SqlCompletionCatalog };

const EMPTY_CATALOG: SqlCompletionCatalog = { schemas: [], tables: [], columns: [] };

export interface SqlEditorPanelProps {
  value: string;
  onChange: (sql: string) => void;
  readOnly?: boolean;
  /** Programmatic value loads (reveal); keeps the user's undo stack intact. */
  loadValue?: { text: string; nonce: number } | null;
  onLocate?: null | { target: string; nonce: number };
  /** Schema/table/column suggestions for the completion provider. */
  completionCatalog?: SqlCompletionCatalog;
  /** Size overrides from the host page (default 46vh stays for other users). */
  className?: string;
  "data-testid"?: string;
}

export function SqlEditorPanel({
  value,
  onChange,
  readOnly = false,
  loadValue = null,
  onLocate = null,
  completionCatalog = EMPTY_CATALOG,
  className,
  "data-testid": testId,
}: SqlEditorPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const { resolvedTheme } = useTheme();
  const valueRef = useRef(value);
  const suppressChangeRef = useRef(false);

  // Keep the handler/value mirrors current without touching refs during
  // render (react-hooks/refs): declared before the editor mount effect so
  // the first creation reads fresh values.
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  // The provider reads the catalog through a ref so hot-reloads and late
  // catalog arrivals are always honored by the live editor instance; the
  // registration is per-panel and disposed with it (no leaked providers).
  const catalogRef = useRef(completionCatalog);
  useEffect(() => {
    catalogRef.current = completionCatalog;
  }, [completionCatalog]);

  useEffect(() => {
    configureWorkers();
    defineYearningThemes(resolvedTheme);
    const providerDisposable = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [".", " ", "`"],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const KIND_MAP = {
          keyword: monaco.languages.CompletionItemKind.Keyword,
          schema: monaco.languages.CompletionItemKind.Module,
          table: monaco.languages.CompletionItemKind.Class,
          column: monaco.languages.CompletionItemKind.Field,
        } as const;
        const suggestions = buildSqlSuggestions(catalogRef.current).map((item) => ({
          label: item.label,
          kind: KIND_MAP[item.kind],
          insertText: item.insertText,
          range,
          detail: item.detail,
        }));
        return { suggestions };
      },
    });
    return () => { providerDisposable.dispose(); };
  }, [resolvedTheme]);

  useEffect(() => {
    if (containerRef.current === null) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: valueRef.current,
      language: "sql",
      theme: "yearning-sql",
      automaticLayout: true,
      minimap: { enabled: false },
      // The app's registered mono face (Geist Mono variable font, global.css)
      // keeps the editor on the same typographic system as UI mono texts.
      fontFamily: '"Geist Mono", "SFMono-Regular", "JetBrains Mono", Menlo, monospace',
      fontSize: 14,
      lineHeight: 22,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      renderWhitespace: "none",
      readOnly,
    });
    editorRef.current = editor;
    const disposable = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return;
      const model = editor.getModel();
      if (model !== null) onChangeRef.current(model.getValue());
    });
    return () => {
      disposable.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // The editor mounts once per panel lifetime; prop changes flow through
    // the dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    if (editor.getOption(monaco.editor.EditorOption.readOnly) !== readOnly) {
      editor.updateOptions({ readOnly });
    }
  }, [readOnly]);

  // Programmatic loads (e.g. revealed SQL) replace the model content without
  // emitting a user-change event back into the store.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor == null || model == null || loadValue === null) return;
    if (model.getValue() === loadValue.text) return;
    suppressChangeRef.current = true;
    try {
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: loadValue.text }],
        () => null,
      );
    } finally {
      suppressChangeRef.current = false;
    }
  }, [loadValue]);

  // Statement locating: select the first occurrence of the target snippet.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor == null || model == null || onLocate === null) return;
    const text = model.getValue();
    const index = text.indexOf(onLocate.target);
    if (index < 0) return;
    const start = model.getPositionAt(index);
    const end = model.getPositionAt(index + onLocate.target.length);
    editor.setSelection({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
    editor.revealRangeInCenter({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
    editor.focus();
  }, [onLocate]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "min-h-[240px] h-[46vh] border-input rounded-md border overflow-hidden",
        className,
      )}
      data-testid={testId}
      data-slot="sql-editor-panel"
    />
  );
}

/** Hard height cap for the read-only viewer (§18.45): bulk reveals scroll
 * inside the cap; Monaco virtualizes line rendering, so a hundred-thousand
 * line reveal costs the same DOM as a one-liner. */
export const SQL_READONLY_MAX_HEIGHT = 320;

/**
 * Read-only SQL viewer for revealed plaintext (order detail, §18.45 owner
 * request): the same Monaco surface as the editor — SQL highlighting, line
 * numbers and code folding for bulk statements — in a container that grows
 * with the content up to the hard cap so no reveal can stretch the page.
 * Deliberately not an editor prop: no change events, no completion provider,
 * no context menu — it is a viewer, and the reveal plaintext stays in
 * component memory exactly as before.
 */
export function SqlReadOnlyViewer({
  value,
  "data-testid": testId,
}: {
  value: string;
  "data-testid"?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    configureWorkers();
    defineYearningThemes(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const fit = (): void => {
      const editor = editorRef.current;
      if (editor === null) return;
      const height = Math.min(editor.getContentHeight(), SQL_READONLY_MAX_HEIGHT);
      container.style.height = `${String(height)}px`;
    };
    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: "yearning-sql",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      renderWhitespace: "none",
      readOnly: true,
      lineNumbersMinChars: 3,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      contextmenu: false,
      stickyScroll: { enabled: false },
      guides: { indentation: false },
      padding: { top: 10, bottom: 10 },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
    });
    editorRef.current = editor;
    const sizeDisposable = editor.onDidContentSizeChange(fit);
    fit();
    return () => {
      sizeDisposable.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // The viewer mounts once per reveal; a value swap flows through the
    // effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defensive value sync (the card remounts the viewer per reveal, but a
  // same-mount swap must still land): read-only models never emit the
  // user-change path, so a plain setValue is enough.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor == null || model == null || model.getValue() === value) return;
    model.setValue(value);
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{ height: SQL_READONLY_MAX_HEIGHT }}
      className="border-input overflow-hidden rounded-md border"
      data-testid={testId}
      data-slot="sql-readonly-viewer"
    />
  );
}
