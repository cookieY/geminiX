import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/shared/i18n";

import { TablePagination } from "./table-pagination";

// Immediate acknowledgement of a page change.
//
// Cursor paging keeps the previous page on screen while the next one loads
// (`keepPreviousData`), so the rows never flash empty and the footer control is
// the immediate acknowledgement of the click. These assertions pin that the
// busy state is rendered on the same commit as the click: the Next control is
// disabled, the footer reports aria-busy, and a busy dot is present. The
// browser timing budget for the general "feedback within 100ms" criterion lives
// in tests/e2e/motion-feedback.spec.ts.

function renderFooter(busy: boolean, hasMore = true) {
  return render(
    <TablePagination
      page={2}
      hasMore={hasMore}
      isFirst={false}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      pageSize={20}
      onPageSizeChange={vi.fn()}
      testIdPrefix="probe"
      busy={busy}
    />,
  );
}

describe("TablePagination busy feedback", () => {
  it("marks the footer busy and shows the dot while a page is loading", () => {
    renderFooter(true);

    expect(screen.getByTestId("probe-pagination")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("probe-busy")).toBeInTheDocument();
    expect(screen.getByTestId("probe-next")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(i18n.t("table.pagination.loading"));
  });

  it("renders no busy affordance once the page has settled", () => {
    renderFooter(false);

    expect(screen.getByTestId("probe-pagination")).not.toHaveAttribute("aria-busy");
    expect(screen.queryByTestId("probe-busy")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-next")).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps a last page disabled for a reason the user can see", () => {
    renderFooter(false, false);

    expect(screen.getByTestId("probe-next")).toBeDisabled();
    expect(screen.queryByTestId("probe-busy")).not.toBeInTheDocument();
  });
});

// The component test above only proves TablePagination renders busy correctly.
// This guard proves every call site actually passes it — a page can otherwise
// lose the acknowledgement while the component suite stays green.
const SOURCES = import.meta.glob("/src/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

// Client-side slicing never leaves the page, so there is no fetch to signal.
const CLIENT_ONLY_PAGERS = new Set(["src/features/query/result-grid.tsx"]);

describe("TablePagination call sites", () => {
  it("wire busy on every paginated table", () => {
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) => {
      const relative = file.replace(/^\//, "");
      if (relative.endsWith(".test.tsx") || CLIENT_ONLY_PAGERS.has(relative)) return [];
      const tags = [
        ...source.matchAll(/<TablePagination\b[\s\S]*?\/>/g),
        ...source.matchAll(/<TablePagination\b[\s\S]*?<\/TablePagination>/g),
      ].map((match) => match[0]);
      return tags
        .filter((tag) => !/busy=\{(?!\s*false\s*\})[^}]*\}/.test(tag))
        .map(() => relative);
    });
    expect(offenders).toEqual([]);
  });
});
