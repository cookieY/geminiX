import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { resetQueryFixture, seedQueryScenario, QUERY_FIXTURE_DS_MYSQL_ID } from "@/shared/mock/query-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import "@/shared/i18n";
import { MetadataTree } from "@/features/query/metadata-tree";
import { ResultGrid, stringifyCell, type ResultTabState } from "@/features/query/result-grid";

/**
 * Query workspace domain components: the frozen-scope metadata tree (lazy
 * schema → table → column levels with live masked flags and the SELECT
 * template insertion) and the cursor-driven result grid (virtualized rows,
 * rows-loaded footer, continuation and exhaustion states — never a total).
 */

const SESSION_USER_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

function stubSession(): void {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: SESSION_USER_ID,
          username: "henry",
          display_name: "henry",
          email: null,
          is_builtin_admin: false,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: false,
        },
        request_id: SESSION_USER_ID,
      }),
    ),
  );
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

beforeEach(() => {
  window.localStorage.setItem("yearning-mock-auth", "default");
  resetQueryFixture();
});

describe("MetadataTree", () => {
  async function renderTree(onTableSelected: (schema: string, table: string) => void = vi.fn()) {
    seedQueryScenario("query-session");
    stubSession();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = {
      id: "qs-fixture-active",
      user_id: SESSION_USER_ID,
      state: "active" as const,
      capabilities: [
        {
          datasource_id: QUERY_FIXTURE_DS_MYSQL_ID,
          datasource_name: "analytics-mysql",
          state: "active" as const,
          can_query: true as const,
          can_export: true,
        },
      ],
      created_at: "2026-08-31T00:00:00Z",
    };
    render(
      <QueryClientProvider client={client}>
        <SessionProvider>
          <MetadataTree session={session} activeDatasourceId={QUERY_FIXTURE_DS_MYSQL_ID} onTableSelected={onTableSelected} />
        </SessionProvider>
      </QueryClientProvider>,
    );
    await screen.findByTestId("query-metadata-tree");
    await screen.findByTestId("query-tree-schema-app");
    return onTableSelected;
  }

  it("expands schema → table → columns with the live masked flag", async () => {
    await renderTree();
    await userEvent.click(screen.getByTestId("query-tree-schema-app"));
    await screen.findByTestId("query-tree-table-app-users");
    await userEvent.click(screen.getByTestId("query-tree-expand-app-users"));
    const columns = await screen.findByTestId("query-tree-columns-app-users");
    expect(columns.textContent).toContain("email");
    expect(columns.textContent).toContain("脱敏");
  });

  it("inserts a SELECT template when a table is clicked", async () => {
    const onTableSelected = await renderTree();
    await userEvent.click(screen.getByTestId("query-tree-schema-app"));
    await userEvent.click(await screen.findByTestId("query-tree-table-app-users"));
    expect(onTableSelected).toHaveBeenCalledWith("app", "users");
  });

  it("filters tables by the search box", async () => {
    await renderTree();
    await userEvent.click(screen.getByTestId("query-tree-schema-app"));
    await screen.findByTestId("query-tree-table-app-users");
    await userEvent.type(screen.getByTestId("query-tree-filter"), "order");
    await waitFor(() => {
      expect(screen.queryByTestId("query-tree-table-app-users")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("query-tree-table-app-orders")).toBeVisible();
  });
});

describe("ResultGrid", () => {
  function tabOf(overrides: Partial<ResultTabState> = {}): ResultTabState {
    return {
      executionId: "exec-grid",
      columns: [
        { name: "id", type: "int" },
        { name: "email", type: "varchar" },
      ],
      rows: [
        [1, "***"],
        [2, "***"],
      ],
      nextCursor: "next",
      elapsedMs: 12,
      exhausted: false,
      maskedByName: new Map([["email", true]]),
      ...overrides,
    };
  }

  it("renders virtualized rows with the masked header badge and loaded count", async () => {
    const onLoadMore = vi.fn();
    render(
      <ResultGrid
        tab={tabOf()}
        loadingMore={false}
        onLoadMore={onLoadMore}
        continuationError={null}
      />,
    );
    expect(screen.getByTestId("query-result-exec-grid")).toBeVisible();
    expect(screen.getByTestId("query-result-elapsed-exec-grid")).toHaveTextContent("12 ms");
    expect(screen.getByTestId("query-result-loaded-exec-grid")).toHaveTextContent("已读取 2 行");
    expect(screen.getByText("已按敏感字段策略脱敏")).toBeVisible();
    await userEvent.click(screen.getByTestId("query-result-load-more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("reports exhaustion instead of a fabricated total", () => {
    render(
      <ResultGrid
        tab={tabOf({ rows: [[1]], nextCursor: null, exhausted: true })}
        loadingMore={false}
        onLoadMore={() => {}}
        continuationError={null}
      />,
    );
    expect(screen.getByTestId("query-result-exhausted-exec-grid")).toHaveTextContent("已读取全部结果");
    expect(screen.queryByTestId("query-result-load-more")).not.toBeInTheDocument();
    expect(screen.getByTestId("query-result-exec-grid").textContent).not.toContain("共 ");
  });

  it("stringifies non-string cells losslessly (never [object Object])", () => {
    // jsdom gives the virtualizer no layout, so the renderer is asserted
    // directly instead of through the DOM.
    expect(stringifyCell("text")).toBe("text");
    expect(stringifyCell(true)).toBe("true");
    expect(stringifyCell({ nested: 1 })).toBe('{"nested":1}');
    expect(stringifyCell(null)).toBe("null");
  });

  it("shows the continuation error inline for CURSOR_EXPIRED paths", () => {
    render(
      <ResultGrid
        tab={tabOf({ rows: [[1]] })}
        loadingMore={false}
        onLoadMore={() => {}}
        continuationError="游标已过期，请重新执行查询"
      />,
    );
    expect(screen.getByTestId("query-result-continuation-error-exec-grid")).toHaveTextContent("游标已过期");
  });
});
