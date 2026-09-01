import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EyeOff } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import type { QueryResultPage } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/** JSON cell renderer — never "[object Object]". Exported for the coverage
 * suite (jsdom gives the virtualizer no layout, so cell rendering itself
 * cannot be asserted through the DOM). */
export function stringifyCell(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Virtualized result grid (UI spec §7.5): rows arrive through the server
 * cursor and render in a fixed-height virtualized window — never all at
 * once. There is no total-row display anywhere (Q005): the footer states
 * the rows ALREADY READ and offers cursor continuation, honestly reporting
 * interruption or exhaustion instead of a fabricated total.
 */

export interface ResultTabState {
  executionId: string;
  columns: QueryResultPage["columns"];
  rows: unknown[][];
  nextCursor: string | null;
  elapsedMs: number | null;
  exhausted: boolean;
  /** Live metadata masked flags by column name (from the columns endpoint). */
  maskedByName: Map<string, boolean>;
}

interface ResultGridProps {
  tab: ResultTabState;
  loadingMore: boolean;
  onLoadMore: () => void;
  continuationError: string | null;
}

export function ResultGrid({ tab, loadingMore, onLoadMore, continuationError }: ResultGridProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tab.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid={`query-result-${tab.executionId}`}>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span data-testid={`query-result-elapsed-${tab.executionId}`}>
          {tab.elapsedMs === null ? "" : t("query.result.elapsed", { ms: tab.elapsedMs })}
        </span>
        <span data-testid={`query-result-loaded-${tab.executionId}`}>
          {t("query.result.rowsLoaded", { count: tab.rows.length })}
        </span>
        {[...tab.maskedByName.entries()].filter(([, masked]) => masked).length > 0 && (
          <Badge variant="secondary" className="gap-0.5">
            <EyeOff className="size-2.5" />
            {t("query.result.maskedColumns")}
          </Badge>
        )}
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border"
        style={{ maxHeight: "100%" }}
      >
        <table className="w-max text-xs">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              <th className="text-muted-foreground sticky left-0 z-20 w-12 border-r bg-muted/50 px-2 py-1 text-right font-normal">
                #
              </th>
              {tab.columns.map((column) => (
                <th
                  key={column.name}
                  className="border-r px-3 py-1 text-left font-medium whitespace-nowrap"
                  title={column.type}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.name}
                    {tab.maskedByName.get(column.name) === true && (
                      <EyeOff className="size-2.5 text-muted-foreground" aria-label={t("query.result.maskedColumns")} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = tab.rows[virtualRow.index];
              if (row === undefined) return null;
              return (
                <tr
                  key={virtualRow.key}
                  className="border-b hover:bg-accent/40"
                  style={{ height: `${String(virtualRow.size)}px` }}
                  data-row={virtualRow.index}
                >
                  <td className="text-muted-foreground sticky left-0 z-10 w-12 border-r bg-background px-2 text-right">
                    {virtualRow.index + 1}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="max-w-[320px] truncate border-r px-3">
                      {cell === null || cell === undefined ? "" : stringifyCell(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        {tab.nextCursor !== null && !tab.exhausted && (
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loadingMore} data-testid="query-result-load-more">
            {loadingMore ? t("common.loading") : t("query.result.loadMore")}
          </Button>
        )}
        {tab.exhausted && (
          <span className="text-muted-foreground text-xs" data-testid={`query-result-exhausted-${tab.executionId}`}>
            {t("query.result.exhausted")}
          </span>
        )}
        {continuationError !== null && (
          <span className="text-destructive text-xs" data-testid={`query-result-continuation-error-${tab.executionId}`}>
            {continuationError}
          </span>
        )}
      </div>
    </div>
  );
}

/** Column-name → masked map from the live metadata endpoint response. */
export function maskedMapFrom(columns: { column_name: string; masked: boolean }[] | undefined): Map<string, boolean> {
  return new Map((columns ?? []).map((column) => [column.column_name, column.masked]));
}
