import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import { OrderSqlCard } from "./order-sql-card";

// jsdom cannot host the lazy Monaco chunk (approval-workspace precedent);
// the revealed SQL renders through the read-only viewer stub.
vi.mock("@/features/review/sql-editor-panel", () => ({
  SqlReadOnlyViewer: ({
    value,
    "data-testid": testId,
  }: {
    value: string;
    "data-testid"?: string;
  }) => <pre data-testid={testId ?? "sql-readonly-stub"}>{value}</pre>,
}));

/**
 * SEC-0035 copy-audit regression: the clipboard write is issued inside the
 * click's user-activation window, the audit request fires only after the
 * plaintext actually reached the clipboard, and both failure paths surface
 * through the inline error alert — no silent swallowing.
 */

const ORDER_ID = "0d6f1a2b-0000-4000-8000-000000000701";
const REVEAL_ID = "0d6f1a2b-0000-4000-8000-00000000a701";
const REQUEST_ID = "0d6f1a2b-0000-4000-8000-000000000702";

function envelope(data: unknown) {
  return { err_code: 0, message: "ok", data, request_id: REQUEST_ID };
}

function revealResponse() {
  return envelope({
    reveal_id: REVEAL_ID,
    sql: "UPDATE orders SET status = 1;",
    watermark: "Yearning SQL Viewer: henry @ 2026-10-21T00:00:00Z",
    valid_until: "2026-10-21T00:05:00Z",
  });
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrderSqlCard orderId={ORDER_ID} />
    </QueryClientProvider>,
  );
}

async function reveal(user: ReturnType<typeof userEvent.setup>) {
  server.use(
    http.post("*/change-orders/:orderId/sql-reveals", () =>
      HttpResponse.json(revealResponse()),
    ),
  );
  renderCard();
  await user.click(await screen.findByTestId("reveal-order-sql"));
  await screen.findByTestId("order-sql-view");
}

beforeEach(() => {
  server.resetHandlers();
});

describe("OrderSqlCard copy audit (SEC-0035)", () => {
  it("writes the clipboard first and audits only after the write resolved", async () => {
    const user = userEvent.setup();
    let copyAuditCalls = 0;
    const seenBodies: string[] = [];
    // A deferred clipboard write proves the ordering: while the write is in
    // flight the audit endpoint must stay untouched; resolving it releases
    // the audit request.
    let resolveWrite: () => void = () => {};
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const clipboardWrite = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(() => writeGate.then(() => undefined));
    server.use(
      http.post("*/change-orders/:orderId/sql-copy-events", async ({ request }) => {
        copyAuditCalls += 1;
        seenBodies.push(await request.text());
        return HttpResponse.json(envelope(null));
      }),
    );

    await reveal(user);
    await user.click(screen.getByTestId("copy-order-sql"));
    // Clipboard write happened immediately; the audit waits for it.
    expect(clipboardWrite).toHaveBeenCalledWith("UPDATE orders SET status = 1;");
    expect(copyAuditCalls).toBe(0);
    resolveWrite();
    await waitFor(() => {
      expect(copyAuditCalls).toBe(1);
    });
    // The audit references the reveal it came from — never the SQL content.
    expect(seenBodies[0]).toContain(REVEAL_ID);
    expect(seenBodies[0]).not.toContain("UPDATE orders");
    // Nothing failed: no error alert.
    expect(screen.queryByTestId("order-sql-error")).toBeNull();
  });

  it("surfaces an audit failure after the copy instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    server.use(
      http.post("*/change-orders/:orderId/sql-copy-events", () =>
        HttpResponse.json({
          err_code: 1002,
          message: "order not found",
          data: null,
          request_id: REQUEST_ID,
          retryable: false,
        }),
      ),
    );

    await reveal(user);
    await user.click(screen.getByTestId("copy-order-sql"));
    const alert = await screen.findByTestId("order-sql-error");
    expect(alert.textContent).toContain("复制审计上报失败");
    expect(alert.textContent).toContain(REQUEST_ID);
  });

  it("surfaces a clipboard failure and sends no audit for a copy that never happened", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    let copyAuditCalls = 0;
    server.use(
      http.post("*/change-orders/:orderId/sql-copy-events", () => {
        copyAuditCalls += 1;
        return HttpResponse.json(envelope(null));
      }),
    );

    await reveal(user);
    await user.click(screen.getByTestId("copy-order-sql"));
    const alert = await screen.findByTestId("order-sql-error");
    expect(alert.textContent).toContain("复制失败");
    // The plaintext never reached the clipboard — there is nothing to audit.
    await waitFor(() => {
      expect(copyAuditCalls).toBe(0);
    });
  });
});
