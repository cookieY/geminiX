// monaco-editor 0.56 exposes deep ESM entry points through its exports map
// ("./*.js": "./esm/vs/*.js"), but its type declarations for those subpaths
// are not resolvable by TypeScript's bundler mode. Bridge the two entry
// points the SQL editor uses to the package's root type surface, which
// re-exports the full editor API.
declare module "monaco-editor/editor/editor.api.js" {
  export * from "monaco-editor";
}

// Side-effect contribution: registers the SQL monarch tokenizer.
declare module "monaco-editor/languages/definitions/sql/register.js";
