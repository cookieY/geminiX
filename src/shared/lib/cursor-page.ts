import { useState } from "react";

/**
 * Cursor-paging state for backend-paginated tables (contract Page shape:
 * { items, page: { next_cursor, has_more } }). The hook tracks the rows-per-
 * page size and a stack of visited cursors so Previous pops back through the
 * exact pages seen; Next is driven by the consumer handing back the last
 * response's next_cursor.
 */
export interface CursorPageState {
  /** Rows per page (the list request's limit). */
  pageSize: number;
  /** The after-cursor for the current page ("" = first page). */
  after: string;
  /** 1-based page number of the page currently displayed. */
  pageNo: number;
  /** True while on the first page (Previous disabled). */
  isFirst: boolean;
  /** Changing the size restarts the page walk. */
  setPageSize: (size: number) => void;
  /** Hand back the last response's page.next_cursor to move forward. */
  pushCursor: (nextCursor: string | null | undefined) => void;
  goPrev: () => void;
  reset: () => void;
}

export function useCursorPage(initialSize = 50): CursorPageState {
  const [pageSize, setPageSizeState] = useState(initialSize);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const after = cursorStack[cursorStack.length - 1] ?? "";
  return {
    pageSize,
    after,
    pageNo: cursorStack.length + 1,
    isFirst: cursorStack.length === 0,
    setPageSize: (size) => {
      setPageSizeState(size);
      setCursorStack([]);
    },
    pushCursor: (next) => {
      if (next) setCursorStack((stack) => [...stack, next]);
    },
    goPrev: () => {
      setCursorStack((stack) => stack.slice(0, -1));
    },
    reset: () => {
      setCursorStack([]);
    },
  };
}
