export interface SqlCompletionCatalog {
  schemas: string[];
  tables: Array<{ schema: string | null; name: string }>;
  columns: Array<{ schema: string | null; table: string; name: string }>;
}

/**
 * Pure suggestion builder for the SQL completion provider (§18.40/§18.40
 * supplement). Kept free of the Monaco namespace so the unit tests exercise
 * it without an editor instance; sql-editor-panel maps the string kinds to
 * Monaco CompletionItemKind values.
 */

export const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW", "JOIN",
  "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT", "NULL",
  "ORDER", "GROUP", "BY", "HAVING", "LIMIT", "OFFSET", "DISTINCT", "AS",
  "IN", "BETWEEN", "LIKE", "EXISTS", "UNION", "ALL", "ASC", "DESC",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "CONSTRAINT",
  "BEGIN", "COMMIT", "ROLLBACK", "TRUNCATE", "RENAME", "IF", "EXISTS",
] as const;

export interface SqlCompletionSuggestion {
  label: string;
  insertText: string;
  detail: string;
  kind: "keyword" | "schema" | "table" | "column";
}

export function buildSqlSuggestions(
  catalog: SqlCompletionCatalog,
): SqlCompletionSuggestion[] {
  const schemaSuggestions = catalog.schemas.map((schema) => ({
    label: schema,
    insertText: schema,
    detail: "schema",
    kind: "schema" as const,
  }));
  const tableSuggestions = catalog.tables.map((table) => ({
    label: table.schema === null ? table.name : `${table.schema}.${table.name}`,
    insertText: table.schema === null ? table.name : `${table.schema}.${table.name}`,
    detail: "table",
    kind: "table" as const,
  }));
  const columnSuggestions = catalog.columns.map((column) => ({
    label: column.name,
    insertText: column.name,
    detail: `column · ${column.table}`,
    kind: "column" as const,
  }));
  const keywordSuggestions = SQL_KEYWORDS.map((keyword) => ({
    label: keyword,
    insertText: keyword,
    detail: "SQL",
    kind: "keyword" as const,
  }));
  return [...schemaSuggestions, ...tableSuggestions, ...columnSuggestions, ...keywordSuggestions];
}
