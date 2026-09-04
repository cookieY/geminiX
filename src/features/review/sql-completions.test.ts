import { describe, expect, it } from "vitest";
import { buildSqlSuggestions, type SqlCompletionCatalog } from "./sql-completions";

/**
 * The suggestion builder is pure: schema/table/column entries come first in
 * catalog order, the curated keyword list follows. Kinds stay plain strings
 * — the panel maps them onto Monaco CompletionItemKind values.
 */

const CATALOG: SqlCompletionCatalog = {
  schemas: ["app", "analytics"],
  tables: [
    { schema: "app", name: "orders" },
    { schema: null, name: "standalone" },
  ],
  columns: [{ schema: "app", table: "orders", name: "user_id" }],
};

describe("buildSqlSuggestions", () => {
  it("suggests schemas, tables and columns ahead of the keyword list", () => {
    const items = buildSqlSuggestions(CATALOG);
    // Catalog entries come first: schemas, then tables, then columns.
    expect(items[0]).toMatchObject({ label: "app", kind: "schema", detail: "schema" });
    expect(items[1]).toMatchObject({ label: "analytics", kind: "schema" });
    expect(items[2]).toMatchObject({
      label: "app.orders",
      insertText: "app.orders",
      kind: "table",
      detail: "table",
    });
    expect(items[3]).toMatchObject({ label: "standalone", kind: "table" });
    expect(items[4]).toMatchObject({
      label: "user_id",
      kind: "column",
      detail: "column · orders",
    });
    expect(items.length).toBe(5 + 54);
  });

  it("keeps the keyword list last without catalog entries", () => {
    const items = buildSqlSuggestions({ schemas: [], tables: [], columns: [] });
    expect(items.length).toBeGreaterThanOrEqual(50);
    expect(items.every((item) => item.kind === "keyword")).toBe(true);
    expect(items.map((item) => item.label)).toContain("SELECT");
  });
});
