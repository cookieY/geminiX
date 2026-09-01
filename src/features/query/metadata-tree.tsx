import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Database, EyeOff, Table2 } from "lucide-react";
import type { QuerySession } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  useSessionColumns,
  useSessionSchemas,
  useSessionTables,
} from "@/features/query/use-query-domain";

/**
 * Frozen-scope metadata tree (UI spec §7.5): datasource → schema → table,
 * lazy per level through the session metadata endpoints. Tables insert a
 * SELECT template into the editor; expanding a table loads its column list
 * where masked columns render the 脱敏 badge from the LIVE vocabulary — the
 * per-run masking itself is frozen server-side at execution time.
 */

interface MetadataTreeProps {
  session: QuerySession;
  activeDatasourceId: string;
  onTableSelected: (schemaName: string, tableName: string) => void;
}

export function MetadataTree({ session, activeDatasourceId, onTableSelected }: MetadataTreeProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const schemasQuery = useSessionSchemas(session.id, activeDatasourceId, session.state === "active");
  const schemas = schemasQuery.data ?? [];
  const filterText = filter.trim().toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="query-metadata-tree">
      <Input
        value={filter}
        onChange={(event) => { setFilter(event.target.value); }}
        placeholder={t("query.tree.searchPlaceholder")}
        data-testid="query-tree-filter"
      />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {schemasQuery.isPending && <p className="text-muted-foreground px-2 py-4 text-xs">{t("common.loading")}</p>}
        {schemasQuery.error !== null && (
          <p className="text-destructive px-2 py-4 text-xs">{t("query.tree.loadFailed")}</p>
        )}
        {!schemasQuery.isPending &&
          schemas.map((schema) => (
            <SchemaNode
              key={schema.name}
              sessionId={session.id}
              datasourceId={activeDatasourceId}
              schemaName={schema.name}
              expanded={expandedSchemas.has(schema.name)}
              expandedTables={expandedTables}
              filterText={filterText}
              onToggle={() => { setExpandedSchemas((current) => {
                  const next = new Set(current);
                  if (next.has(schema.name)) next.delete(schema.name);
                  else next.add(schema.name);
                  return next;
                }); }
              }
              onToggleTable={(tableName) => { setExpandedTables((current) => {
                  const key = `${schema.name}.${tableName}`;
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                }); }
              }
              onTableSelected={onTableSelected}
            />
          ))}
      </div>
    </div>
  );
}

interface SchemaNodeProps {
  sessionId: string;
  datasourceId: string;
  schemaName: string;
  expanded: boolean;
  expandedTables: Set<string>;
  filterText: string;
  onToggle: () => void;
  onToggleTable: (tableName: string) => void;
  onTableSelected: (schemaName: string, tableName: string) => void;
}

function SchemaNode({
  sessionId,
  datasourceId,
  schemaName,
  expanded,
  expandedTables,
  filterText,
  onToggle,
  onToggleTable,
  onTableSelected,
}: SchemaNodeProps) {
  const { t } = useTranslation();
  const tablesQuery = useSessionTables(sessionId, datasourceId, schemaName, expanded);
  const tables = tablesQuery.data ?? [];
  const visibleTables = useMemo(
    () =>
      filterText === ""
        ? tables
        : tables.filter((table) => table.table_name.toLowerCase().includes(filterText)),
    [filterText, tables],
  );

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm"
        data-testid={`query-tree-schema-${schemaName}`}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Database className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{schemaName}</span>
      </button>
      {expanded && (
        <div className="ml-4">
          {tablesQuery.isPending && <p className="text-muted-foreground px-2 py-1 text-xs">{t("common.loading")}</p>}
          {visibleTables.map((table) => {
            const key = `${schemaName}.${table.table_name}`;
            const tableExpanded = expandedTables.has(key);
            return (
              <div key={table.table_name}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => { onToggleTable(table.table_name); }}
                    aria-expanded={tableExpanded}
                    className="hover:bg-accent rounded p-0.5"
                    data-testid={`query-tree-expand-${schemaName}-${table.table_name}`}
                  >
                    {tableExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { onTableSelected(schemaName, table.table_name); }}
                    title={t("query.tree.insertTemplate")}
                    className="hover:bg-accent flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-sm"
                    data-testid={`query-tree-table-${schemaName}-${table.table_name}`}
                  >
                    <Table2 className="size-3.5 text-muted-foreground" />
                    <span className="truncate font-mono text-xs">{table.table_name}</span>
                    {table.relation_kind !== "table" && (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {table.relation_kind}
                      </Badge>
                    )}
                  </button>
                </div>
                {tableExpanded && (
                  <ColumnList
                    sessionId={sessionId}
                    datasourceId={datasourceId}
                    schemaName={schemaName}
                    tableName={table.table_name}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ColumnList({
  sessionId,
  datasourceId,
  schemaName,
  tableName,
}: {
  sessionId: string;
  datasourceId: string;
  schemaName: string;
  tableName: string;
}) {
  const { t } = useTranslation();
  const columnsQuery = useSessionColumns(sessionId, datasourceId, schemaName, tableName, true);
  const columns = columnsQuery.data ?? [];
  return (
    <div className="ml-6 border-l pl-2" data-testid={`query-tree-columns-${schemaName}-${tableName}`}>
      {columnsQuery.isPending && <p className="text-muted-foreground py-1 text-xs">{t("common.loading")}</p>}
      {columns.map((column) => (
        <div key={column.column_name} className="flex items-center gap-1 py-0.5">
          <span className="text-muted-foreground truncate font-mono text-[11px]">{column.column_name}</span>
          <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px]">{column.data_type}</span>
          {column.masked && (
            <Badge variant="secondary" className="ml-auto shrink-0 gap-0.5 text-[10px]">
              <EyeOff className="size-2.5" />
              {t("query.tree.masked")}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
