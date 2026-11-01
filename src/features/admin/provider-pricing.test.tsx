import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import {
  ADMIN_FIXTURE_PROVIDER_PRIMARY_ID,
  resetAdminFixture,
} from "@/shared/mock/admin-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import {
  ProviderPricingPanel,
  ProviderUsagePanel,
} from "@/features/admin/provider-pricing";

/**
 * S008 参考计价面板（FE包 2026-10-31，分支覆盖补齐 2026-11-02）：费率
 * 版本表的开放/收口呈现、创建表单的空值剔除与守卫、参考模板「只填空
 * 值不覆盖」、窗口增删与 24:00 边界，以及费用统计/调用明细的每个
 * rate_source 与缺报形态。数据面走共享 MSW 夹具（append-only 列表 +
 * 创建收口旧开放版），会话探针按 admin-pages 先例钉死 admin。
 */

const SESSION_USER_ID = "e2e-admin";

function stubSession(admin: boolean): void {
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
          is_builtin_admin: admin,
          version: 1,
          created_at: "2026-08-28T08:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
          can_access_admin: admin,
        },
        request_id: SESSION_USER_ID,
      }),
    ),
  );
}

function renderPanel(ui: React.ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider>{ui}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function unmountAll(): void {
  cleanup();
}

beforeAll(() => {
  // Base UI Select pointer-capture stubs (admin-pages precedent).
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

beforeEach(() => {
  window.localStorage.setItem("yearning-mock-auth", "admin");
  stubSession(true);
  resetAdminFixture();
});

afterEach(() => {
  server.resetHandlers();
  resetAdminFixture();
  window.localStorage.removeItem("yearning-mock-auth");
});

async function openRateForm(): Promise<void> {
  await userEvent.click(await screen.findByTestId("rate-new-version"));
  expect(screen.getByTestId("provider-rate-form")).toBeVisible();
}

describe("ProviderPricingPanel", () => {
  it("renders the empty state, guards an empty effective-from, then creates an open-ended version", async () => {
    const created: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/admin/ai-providers/:providerId/rate-versions", async ({ request }) => {
        created.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ err_code: 1002, message: "not used", data: null, request_id: "x" });
      }),
    );
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    // Fresh fixture world: no versions yet → empty copy, no table.
    expect(await screen.findByTestId("provider-pricing-panel")).toBeVisible();
    expect(screen.queryByTestId("provider-rate-table")).not.toBeInTheDocument();

    await openRateForm();
    // Guard: empty effective_from surfaces the near-field error, no request.
    await userEvent.click(screen.getByTestId("rate-submit"));
    expect(await screen.findByTestId("rate-form-error")).toBeVisible();
    expect(created).toHaveLength(0);

    // Fill the form; empty cached prices must be omitted from the body.
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByTestId("rate-input-price-0"), { target: { value: "2.34" } });
    fireEvent.change(screen.getByTestId("rate-output-price-0"), { target: { value: "5.67" } });
    fireEvent.change(screen.getByTestId("rate-cached-read-0"), { target: { value: "0.10" } });
    server.use(
      http.post("*/admin/ai-providers/:providerId/rate-versions", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { id: "rv-new", provider_id: ADMIN_FIXTURE_PROVIDER_PRIMARY_ID, ...body, version: 1, created_at: "2026-12-01T00:00:00Z" },
          request_id: "x",
        });
      }),
    );
    await userEvent.click(screen.getByTestId("rate-submit"));
    await waitFor(() => expect(screen.queryByTestId("provider-rate-form")).not.toBeInTheDocument());
    expect(created).toHaveLength(1);
    const body = created[0] as { currency: string; effective_until?: string; windows: Array<Record<string, unknown>> };
    expect(body.currency).toBe("CNY");
    expect(body.effective_until).toBeUndefined();
    expect(body.windows[0]).toMatchObject({ start_minute: 0, end_minute: 1440, input_price: "2.34", output_price: "5.67", cached_read_price: "0.10" });
    expect(body.windows[0]).not.toHaveProperty("cached_write_price");
  });

  it("closes the previous open version when a second one lands, and renders both window shapes", async () => {
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByTestId("rate-submit"));
    await waitFor(() => expect(screen.queryByTestId("provider-rate-form")).not.toBeInTheDocument());

    // Second version with an explicit until + a bounded window; the fixture
    // closes v1 at v2's effective_from (append-only 收口).
    await openRateForm();
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByTestId("rate-until"), { target: { value: "2027-06-30" } });
    fireEvent.change(screen.getByTestId("rate-window-start-0"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByTestId("rate-window-end-0"), { target: { value: "18:00" } });
    await userEvent.click(screen.getByTestId("rate-submit"));
    await waitFor(() => expect(screen.queryByTestId("provider-rate-form")).not.toBeInTheDocument());

    // Third version without an until stays open — it is the 当前生效 one and
    // closes nothing (both prior versions already carry an until).
    await openRateForm();
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2027-07-01" } });
    await userEvent.click(screen.getByTestId("rate-submit"));
    await waitFor(() => expect(screen.queryByTestId("provider-rate-form")).not.toBeInTheDocument());

    const table = await screen.findByTestId("provider-rate-table");
    // v1: closed by v2's from-date and keeps the full-day window text;
    // v2: bounded window with its explicit until.
    await waitFor(() => {
      const rows = within(table).getAllByTestId(/provider-rate-row-/);
      expect(rows).toHaveLength(3);
      expect(rows.some((row) => within(row).queryAllByText("00:00–24:00").length === 1)).toBe(true);
      expect(rows.some((row) => within(row).queryAllByText("09:30–18:00").length === 1)).toBe(true);
    });
    // v1 was auto-closed at v2's from-date; v2 carries its explicit until.
    expect(table.textContent).toContain("2027-01-01 → 2027-06-30");
    expect(table.textContent).toContain("2026-12-01 → 2027-01-01");
    // The open version renders the open-ended marker and the 当前生效 badge
    // (absent effective_until on the wire, not null).
    expect(table.textContent).toContain("2027-07-01 → 开放");
    expect(within(table).getAllByText("当前生效").length).toBe(1);
  });

  it("applies the global reference template only to empty fields, and only when prices are positive", async () => {
    // Zero prices (the default world): applying must leave everything
    // untouched — the >0 guard refuses to fabricate a reference price.
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    await userEvent.click(screen.getByTestId("rate-apply-template"));
    expect(screen.getByTestId("rate-input-price-0")).toHaveValue("");
    expect(screen.getByTestId("rate-output-price-0")).toHaveValue("");

    // A fresh panel with real reference prices fills empty fields only — a
    // manual value wins (query must see the override from its first fetch).
    unmountAll();
    const overrideFetches: number[] = [];
    server.use(
      http.get("*/admin/settings/ai-budget", () => {
        overrideFetches.push(1);
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            namespace: "ai-budget",
            schema_version: 1,
            settings: {
              enforced: false,
              currency: "CNY",
              daily_budget_minor: 10000,
              alert_threshold_percent: 80,
              input_price_per_million_minor: 234,
              output_price_per_million_minor: 567,
            },
            version: 1,
            updated_by: SESSION_USER_ID,
            updated_at: "2026-08-28T08:00:00Z",
          },
          request_id: SESSION_USER_ID,
        });
      }),
    );
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    await waitFor(() => { expect(overrideFetches.length).toBeGreaterThan(0); });
    fireEvent.change(screen.getByTestId("rate-input-price-0"), { target: { value: "9.99" } });
    await userEvent.click(screen.getByTestId("rate-apply-template"));
    expect(screen.getByTestId("rate-input-price-0")).toHaveValue("9.99");
    expect(screen.getByTestId("rate-output-price-0")).toHaveValue("5.67");
    // Second application now fills the still-empty input too.
    fireEvent.change(screen.getByTestId("rate-input-price-0"), { target: { value: "" } });
    await userEvent.click(screen.getByTestId("rate-apply-template"));
    expect(screen.getByTestId("rate-input-price-0")).toHaveValue("2.34");
  });

  it("ignores the template when the settings namespace carries no reference prices", async () => {
    const settingsFetches: number[] = [];
    server.use(
      http.get("*/admin/settings/ai-budget", () => {
        settingsFetches.push(1);
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            namespace: "ai-budget",
            schema_version: 1,
            // Wrong shape on purpose: no *_price_per_million_minor keys.
            settings: { enforced: true, currency: "USD" },
            version: 1,
            updated_by: SESSION_USER_ID,
            updated_at: "2026-08-28T08:00:00Z",
          },
          request_id: SESSION_USER_ID,
        });
      }),
    );
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    // The no-op verdict only counts once the query has actually resolved —
    // clicking before the fetch lands would pass vacuously.
    await waitFor(() => { expect(settingsFetches.length).toBeGreaterThan(0); });
    await userEvent.click(screen.getByTestId("rate-apply-template"));
    expect(screen.getByTestId("rate-input-price-0")).toHaveValue("");
    expect(screen.getByTestId("rate-output-price-0")).toHaveValue("");
  });

  it("adds and removes windows with the 24:00 boundary and clamps past-midnight ends", async () => {
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    // Second window starts where the previous one ended (1440 % 1440 = 0);
    // the full-day end stays at the day bound — jsdom normalizes the
    // invalid "24:00" value away, so that shape is asserted through the
    // created body (end_minute 1440) in the first test above.
    await userEvent.click(screen.getByTestId("rate-add-window"));
    expect(screen.getByTestId("rate-window-start-1")).toHaveValue("00:00");
    fireEvent.change(screen.getByTestId("rate-window-end-1"), { target: { value: "23:59" } });
    expect(screen.getByTestId("rate-window-end-1")).toHaveValue("23:59");
    // A blank time input is ignored (no NaN minute lands in the draft).
    fireEvent.change(screen.getByTestId("rate-window-start-1"), { target: { value: "" } });
    expect(screen.getByTestId("rate-window-start-1")).toHaveValue("00:00");
    // Two windows: each row carries a remove affordance; dropping one
    // leaves a single window with no affordance left.
    await userEvent.click(screen.getAllByRole("button", { name: "删除" })[0] as HTMLElement);
    expect(screen.queryByTestId("rate-window-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("switches the currency to USD through the real Select", async () => {
    const created: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/admin/ai-providers/:providerId/rate-versions", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { id: "rv-usd", provider_id: ADMIN_FIXTURE_PROVIDER_PRIMARY_ID, ...body, version: 1, created_at: "2026-12-01T00:00:00Z" },
          request_id: "x",
        });
      }),
    );
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    await userEvent.click(screen.getByTestId("rate-currency"));
    const listbox = await screen.findByRole("listbox");
    await userEvent.click(within(listbox).getByText("USD"));
    expect(screen.getByTestId("rate-currency")).toHaveTextContent("USD");
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByTestId("rate-submit"));
    await waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0]).toMatchObject({ currency: "USD" });
  });

  it("surfaces the backend rejection inside the form without closing it", async () => {
    server.use(
      http.post("*/admin/ai-providers/:providerId/rate-versions", () =>
        HttpResponse.json({ err_code: 1001, message: "RATE_CURRENCY_MISMATCH", data: null, request_id: "req-77" }),
      ),
    );
    renderPanel(<ProviderPricingPanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await openRateForm();
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByTestId("rate-submit"));
    const alert = await screen.findByTestId("rate-form-error");
    expect(alert).toBeVisible();
    expect(alert.textContent).toContain("稍后重试");
    expect(screen.getByTestId("provider-rate-form")).toBeInTheDocument();
  });
});

describe("ProviderUsagePanel", () => {
  it("renders the fixture summary and every call shape the world serves", async () => {
    renderPanel(<ProviderUsagePanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    // Summary: USD 3671000000 nano → 3.671 reference cost.
    const summary = await screen.findByTestId("provider-usage-summary");
    expect(within(summary).getAllByText("USD").length).toBe(1);
    expect(summary.textContent).toContain("3.671000");
    const calls = await screen.findByTestId("provider-usage-calls");
    // global_settings row: tokens reported, reasoning suffix, CNY currency.
    const rowA = within(calls).getByTestId("provider-usage-row-0b1e2f3a-0000-4000-8000-00000000d001");
    expect(rowA.textContent).toContain("1200 / 380");
    expect(rowA.textContent).toContain("(R 210)");
    // Nano-unit string "0.00632100" divides down below the 8-decimal view.
    expect(rowA.textContent).toContain("0.00000000");
    // none row: everything unreported → dashes and 不可计算 amount.
    const rowB = within(calls).getByTestId("provider-usage-row-0b1e2f3a-0000-4000-8000-00000000d002");
    // Null and absent are the same honest shape: every unset field renders
    // its not-reported mark — never a literal "null", never a zero cost.
    expect(rowB.textContent).toContain("— / — / —");
    expect(rowB.textContent).toContain("未返回 / 未返回");
    expect(rowB.textContent).toContain("未计算");
    expect(rowB.textContent).not.toContain("null");
    expect(rowB.textContent).not.toContain("0.00000000");
  });

  it("renders rate-version sourced rows and the not-reported token forms", async () => {
    const row = {
      id: "0b1e2f3a-0000-4000-8000-00000000d003",
      review_run_id: "0b1e2f3a-0000-4000-8000-000000000001",
      stage_position: 2, model_turn: 1, call_index: 2,
      provider_id: ADMIN_FIXTURE_PROVIDER_PRIMARY_ID,
      model_name: "glm-4.6", sent_at: "2026-11-01T08:00:00Z",
      reasoning_effort: "high", max_tokens: 8192, temperature: "0",
      rate_version_id: "rv-1", rate_window_id: null, rate_source: "rate_version",
      currency: undefined, input_tokens: 10, output_tokens: undefined,
      cached_tokens: 4, cache_write_tokens: undefined, reasoning_tokens: undefined,
      usage_reported: true, reference_amount: undefined,
      calc_basis: "full_detail",
    };
    const rowBase = {
      id: "0b1e2f3a-0000-4000-8000-00000000d004",
      review_run_id: "0b1e2f3a-0000-4000-8000-000000000001",
      stage_position: 2, model_turn: 1, call_index: 3,
      provider_id: ADMIN_FIXTURE_PROVIDER_PRIMARY_ID,
      model_name: "glm-4.6", sent_at: "2026-11-01T08:00:00Z",
      reasoning_effort: null, max_tokens: null, temperature: null,
      rate_version_id: null, rate_window_id: null, rate_source: "global_settings",
      currency: "CNY", input_tokens: 1, output_tokens: 1,
      cached_tokens: null, cache_write_tokens: null, reasoning_tokens: null,
      usage_reported: true, reference_amount: "100000000",
      calc_basis: "base_only",
    };
    server.use(
      http.get("*/admin/ai-usage/calls", () =>
        HttpResponse.json({
          err_code: 0, message: "ok", request_id: "x",
          data: { items: [row, rowBase], page: { next_cursor: null, has_more: false } },
        }),
      ),
    );
    renderPanel(<ProviderUsagePanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    const calls = await screen.findByTestId("provider-usage-calls");
    const rowV = within(calls).getByTestId("provider-usage-row-0b1e2f3a-0000-4000-8000-00000000d003");
    // No currency suffix when the call carries none; output token unreported.
    expect(rowV.textContent).toContain("10 / 未返回");
    expect(rowV.textContent).toContain("4 / 未返回");
    expect(rowV.textContent).toContain("未计算");
    expect(rowV.textContent).not.toContain("(CNY)");
  });

  it("shows the empty forms when no usage exists for the provider", async () => {
    server.use(
      http.get("*/admin/ai-usage/summary", () =>
        HttpResponse.json({ err_code: 0, message: "ok", data: [], request_id: "x" }),
      ),
      http.get("*/admin/ai-usage/calls", () =>
        HttpResponse.json({
          err_code: 0, message: "ok", request_id: "x",
          data: { items: [], page: { next_cursor: null, has_more: false } },
        }),
      ),
    );
    renderPanel(<ProviderUsagePanel providerId={ADMIN_FIXTURE_PROVIDER_PRIMARY_ID} />);
    await waitFor(() => {
      expect(screen.queryByTestId("provider-usage-summary")).not.toBeInTheDocument();
      expect(screen.queryByTestId("provider-usage-calls")).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId("provider-usage-panel")).toBeVisible();
  });
});
