import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/features/auth/session-provider";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import { getReviewEventClient } from "@/shared/events/review-event-client";
import "@/shared/i18n";
import {
  FIXTURE_OWNER_ID,
  resetReviewFixture,
  seedFixtureOrder,
} from "@/shared/mock/review-fixture";
import MinePage from "./mine-page";
import OrderDetailPage from "./order-detail-page";

/**
 * 我的工单 list gates (work package FE-F6-ORDER-SUBMIT): drafts and submitted
 * orders render in separated sections, rows navigate to their detail routes,
 * and domain events never duplicate list rows — events trigger a full HTTP
 * re-read (api/events/README.md), so redelivery is invisible.
 */

afterEach(() => {
  resetReviewFixture();
});

function seedOrder(overrides: Record<string, unknown> = {}): void {
  seedFixtureOrder({
    id: "9b6f1a2b-0000-4000-8000-00000000cd01",
    display_number: "YR-20260830-000011",
    submitter_user_id: FIXTURE_OWNER_ID,
    title: "列表页夹具工单",
    state: "submitted",
    current_stage_position: 1,
    stages: [],
    has_sql: true,
    sql_hash: "hash-1",
    snapshot_hash: "snap-1",
    manually_verified: false,
    version: 1,
    submitted_at: "2026-08-30T10:00:00Z",
    terminal_at: null,
    review_run_id: null,
    sql_text: "SELECT 1;",
    ...overrides,
  });
}

function renderMine() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
      <MemoryRouter initialEntries={["/changes/mine"]}>
        <Routes>
          <Route path="/changes/mine" element={<MinePage />} />
          <Route path="/changes/drafts/:draftId" element={<p data-testid="draft-target" />} />
          <Route path="/changes/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.resetHandlers();
  resetReviewFixture();
  grantSession();
});


/** The order pages gate lifecycle buttons on the session identity; plant an
 * authenticated /users/me whose id matches the fixture submitter (guards
 * test precedent). */
function grantSession(): void {
  server.use(
    http.get("*/users/me", () =>
      HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: FIXTURE_OWNER_ID,
          username: "henry",
          display_name: "henry",
          email: null,
          is_builtin_admin: true,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: true,
        },
        request_id: FIXTURE_OWNER_ID,
      }),
    ),
  );
}

describe("MinePage", () => {
  it("renders draft and order sections separated, orders newest first", async () => {
    seedOrder();
    seedOrder({
      id: "9b6f1a2b-0000-4000-8000-00000000cd02",
      display_number: "YR-20260830-000012",
      submitted_at: "2026-08-30T11:00:00Z",
    });
    renderMine();
    expect(await screen.findByTestId("mine-orders-table")).toBeVisible();
    const rows = screen.getAllByTestId("mine-order-row");
    expect(rows).toHaveLength(2);
    // Newest submission first.
    expect(rows[0]?.textContent).toContain("YR-20260830-000012");
    expect(rows[1]?.textContent).toContain("YR-20260830-000011");
    expect(screen.getByTestId("tab-audit-orders")).toBeVisible();
  });

  it("renders the unified query-orders tab with its empty state", async () => {
    const user = userEvent.setup();
    renderMine();
    // FE-F10 replaces the placeholder with the unified query view (UI spec
    // §5.2): no server query objects exist for the default session, so the
    // honest empty state renders.
    await user.click(await screen.findByTestId("tab-query-orders"));
    expect(await screen.findByTestId("orders-query-empty")).toBeVisible();
    expect(screen.getByTestId("orders-query-empty")).toHaveTextContent("暂无查询工单记录。");
  });

  it("navigates a row click to the order detail route", async () => {
    const user = userEvent.setup();
    seedOrder();
    renderMine();
    const row = await screen.findByTestId("mine-order-row");
    await user.click(row);
    await waitFor(() => {
      expect(screen.getByTestId("order-detail-page")).toBeVisible();
    });
  });

  it("keeps exactly one row per order across event redelivery (列表事件无重复)", async () => {
    seedOrder();
    renderMine();
    expect(await screen.findByTestId("mine-orders-table")).toBeVisible();
    expect(screen.getAllByTestId("mine-order-row")).toHaveLength(1);

    // The server applies the withdrawal; the event is only a notification.
    // The consumer re-reads the resource, so the list reflects the new state
    // in place instead of duplicating rows.
    server.use(
      http.get("*/change-orders", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            items: [
              {
                id: "9b6f1a2b-0000-4000-8000-00000000cd01",
                display_number: "YR-20260830-000011",
                submitter_user_id: FIXTURE_OWNER_ID,
                title: "列表页夹具工单",
                state: "withdrawn",
                current_stage_position: null,
                stages: [],
                has_sql: true,
                sql_hash: "hash-1",
                snapshot_hash: "snap-1",
                manually_verified: false,
                version: 2,
                submitted_at: "2026-08-30T10:00:00Z",
                terminal_at: "2026-08-30T10:05:00Z",
              },
            ],
            page: { next_cursor: null, has_more: false },
          },
          request_id: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    );
    getReviewEventClient().ingest({
      specversion: "1.0",
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f9f01",
      type: "io.yearning.v4.change_order.state_changed",
      source: "yearning://control-plane",
      subject: "change-orders/9b6f1a2b-0000-4000-8000-00000000cd01",
      time: "2026-08-30T10:05:00Z",
      datacontenttype: "application/json",
      sequence: 2,
      causation_id: null,
      actor: { kind: "user", user_id: FIXTURE_OWNER_ID },
      data: {
        aggregate_id: "9b6f1a2b-0000-4000-8000-00000000cd01",
        from: "submitted",
        to: "withdrawn",
        reason_code: "submitter_withdrawn",
        aggregate_version: 2,
      },
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("mine-order-row")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("mine-orders-table").textContent).toContain("已撤回");
    });
    // The exact same event redelivered (at-least-once) must be a no-op:
    // the client dedups by event.id and reports it undelivered.
    const duplicateEvent = {
      specversion: "1.0",
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f9f01",
      type: "io.yearning.v4.change_order.state_changed",
      source: "yearning://control-plane",
      subject: "change-orders/9b6f1a2b-0000-4000-8000-00000000cd01",
      time: "2026-08-30T10:05:00Z",
      datacontenttype: "application/json",
      sequence: 2,
      causation_id: null,
      actor: { kind: "user", user_id: FIXTURE_OWNER_ID },
      data: {
        aggregate_id: "9b6f1a2b-0000-4000-8000-00000000cd01",
        from: "submitted",
        to: "withdrawn",
        reason_code: "submitter_withdrawn",
        aggregate_version: 2,
      },
    };
    expect(getReviewEventClient().ingest(duplicateEvent)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByTestId("mine-order-row")).toHaveLength(1);
  });

  it("filters server-side via the keyword and distinguishes the empty state", async () => {
    const user = userEvent.setup();
    seedOrder();
    renderMine();
    expect(await screen.findByTestId("mine-orders-table")).toBeVisible();

    // A keyword that matches nothing yields the filtered-empty copy after
    // the debounce window; the row disappears (server-side filter).
    await user.type(screen.getByTestId("filter-keyword"), "不存在的关键字");
    await waitFor(() => {
      expect(screen.getByTestId("orders-empty").textContent).toContain("没有符合筛选条件的工单");
    }, { timeout: 3000 });
    expect(screen.queryByTestId("mine-orders-table")).toBeNull();

    // Clearing the keyword restores the row.
    await user.clear(screen.getByTestId("filter-keyword"));
    await waitFor(() => {
      expect(screen.getByTestId("mine-orders-table")).toBeVisible();
    }, { timeout: 3000 });
  });

  it("offers the reset affordance only while filters are active", async () => {
    const user = userEvent.setup();
    seedOrder();
    renderMine();
    expect(await screen.findByTestId("mine-orders-table")).toBeVisible();
    expect(screen.queryByTestId("filter-reset")).toBeNull();

    await user.type(screen.getByTestId("filter-keyword"), "YR");
    await waitFor(() => {
      expect(screen.getByTestId("filter-reset")).toBeVisible();
    }, { timeout: 3000 });
    await user.click(screen.getByTestId("filter-reset"));
    await waitFor(() => {
      expect(screen.queryByTestId("filter-reset")).toBeNull();
    });
    expect(screen.getByTestId("filter-keyword")).toHaveValue("");
  });
});
