import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { resetAdminFixture } from "@/shared/mock/admin-fixture";
import {
  ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
  ADMIN_FIXTURE_DATASOURCE_PG_ID,
  ADMIN_FIXTURE_PROVIDER_PRIMARY_ID,
  ADMIN_FIXTURE_TOOL_BUILTIN_ID,
} from "@/shared/mock/admin-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import { RequireAdminCapability } from "@/app/router/guards";
import "@/shared/i18n";
import AdminDatasourcesPage from "@/routes/admin/admin-datasources-page";
import AdminProvidersPage from "@/routes/admin/admin-providers-page";
import AdminAiBudgetPage from "@/routes/admin/admin-ai-budget-page";
import AdminRuleSetsPage from "@/routes/admin/admin-rule-sets-page";
import AdminReviewSkillsPage from "@/routes/admin/admin-review-skills-page";
import AdminReviewKnowledgePage from "@/routes/admin/admin-review-knowledge-page";

/**
 * FE-F9-REVIEW-ADMIN acceptance-gate component tests. The five package
 * gates are exercised on the real page components against the stateful
 * admin fixture: Secret fields never carry a stored value (and edits are
 * replace-or-reuse), the review-input editor exposes no executable-code /
 * HTTP / database-write surface, config hashes and the review-invalidation
 * note are visible, internal experience offers no auto-learning entry, and
 * the admin capability guard keeps every surface behind can_access_admin.
 */

const SESSION_USER_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

/** jsdom cannot carry document cookies on a cross-origin fetch, so the
 * session probe is pinned per behavior — the same override the approval
 * and execution component tests use. */
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

function setAuthBehavior(behavior: "admin" | "default"): void {
  window.localStorage.setItem("yearning-mock-auth", behavior);
}

// Base UI Select needs pointer-capture APIs jsdom does not implement; the
  // stubs let userEvent open the option popups in component tests.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

function renderPage(ui: React.ReactElement): void {
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

beforeEach(() => {
  setAuthBehavior("admin");
  stubSession(true);
  resetAdminFixture();
});

afterEach(() => {
  server.resetHandlers();
  resetAdminFixture();
  window.localStorage.removeItem("yearning-mock-auth");
});

describe("gate: Secret永不回填", () => {
  it("leaves every datasource credential field empty when editing a configured row", async () => {
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    await screen.findByTestId("ds-form-error", {}, { timeout: 100 }).catch(() => undefined);
    await screen.findByTestId("credential-row-review");
    for (const purpose of ["review", "query", "execution"]) {
      const username = screen.queryByTestId(`credential-username-${purpose}`);
      if (username !== null) expect(username).toHaveValue("");
      const password = screen.queryByTestId(`credential-password-${purpose}`);
      if (password !== null) expect(password).toHaveValue("");
    }
    const dialogTexts = screen.getAllByText(/已配置/);
    expect(dialogTexts.length).toBeGreaterThan(0);
  });

  it("never prefills the provider API key and shows the configured state instead", async () => {
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-edit-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    const apiKey = await screen.findByTestId("provider-api-key");
    expect(apiKey).toHaveValue("");
    expect(screen.getByText(/API Key：已配置/)).toBeInTheDocument();
    expect(screen.queryByText(/pkey-a1/)).not.toBeInTheDocument();
  });
});

describe("gate: 无外部代码HTTP或写库Custom Tool UI", () => {
  it("renders only the four-field definition editor — no executable affordances", async () => {
    renderPage(<AdminReviewSkillsPage />);
    await screen.findByTestId("review-input-create");
    await userEvent.click(screen.getByTestId("review-input-create"));
    await screen.findByTestId("review-input-knowledge-text");
    // The definition fields exist…
    expect(screen.getByTestId("review-input-finding-key")).toBeInTheDocument();
    expect(screen.getByTestId("review-input-title")).toBeInTheDocument();
    expect(screen.getByTestId("review-input-message")).toBeInTheDocument();
    // …and every interactive affordance stays inside the governed surface:
    // no button or label offers code, HTTP or database writes.
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent).not.toMatch(/HTTP|执行代码|写库|Webhook/);
    }
    const labels = screen.queryAllByLabelText(/代码|HTTP|写库|端点/);
    expect(labels).toHaveLength(0);
  });
});

describe("gate: 配置Hash与Review失效影响明确", () => {
  it("shows config hashes and the outdated-impact note on both registries", async () => {
    renderPage(<AdminReviewSkillsPage />);
    await screen.findByTestId("review-input-outdated-note");
    const hashes = await screen.findAllByTestId("review-input-hash");
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) expect(hash.textContent).toMatch(/^[0-9a-f]{16}$/);
  });

  it("previews rule-set impact: bound flows and the hash-change warning", async () => {
    renderPage(<AdminRuleSetsPage />);
    const row = await screen.findByTestId(/rule-set-row-/);
    expect(within(row).getByTestId("rule-set-hash")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(/rule-set-edit-/));
    const preview = await screen.findByTestId("rule-set-impact-preview");
    expect(within(preview).getByText(/1 个流程/)).toBeInTheDocument();
    expect(within(preview).getByText(/生产变更默认流程/)).toBeInTheDocument();
    expect(within(preview).getByText(/引用旧 Hash 的未提交预审将失效/)).toBeInTheDocument();
  });
});

describe("gate: 内部经验无自动学习入口且仅admin可管理", () => {
  it("offers no auto-learning entry and lists only governed provenances", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    await screen.findByTestId("review-input-create");
    await screen.findAllByTestId(/review-input-row-/);
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent).not.toMatch(/自动学习|自动沉淀|auto-learn/i);
    }
    expect(screen.getAllByText("人工沉淀").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finding 转化").length).toBeGreaterThan(0);
  });
});

describe("gate: 仅admin可访问", () => {
  it("redirects a non-admin session to /403 on every admin route", async () => {
    setAuthBehavior("default");
    stubSession(false);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/admin/review-engine/skills"]}>
          <SessionProvider>
            <Routes>
              <Route
                path="/admin/review-engine/skills"
                element={
                  <RequireAdminCapability>
                    <AdminReviewSkillsPage />
                  </RequireAdminCapability>
                }
              />
              <Route path="/403" element={<div data-testid="forbidden">403</div>} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("forbidden")).toBeInTheDocument());
  });
});

describe("admin page flows", () => {
  it("creates a datasource through the form", async () => {
    renderPage(<AdminDatasourcesPage />);
    await userEvent.click(await screen.findByTestId("ds-create"));
    await userEvent.type(screen.getByTestId("ds-name"), "new-warehouse");
    await userEvent.type(screen.getByTestId("ds-host"), "10.0.0.77");
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.type(screen.getByTestId("credential-username-review"), "ro_user");
    await userEvent.type(screen.getByTestId("credential-password-review"), "secret-pw-1");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => {
      expect(screen.getByText("new-warehouse")).toBeInTheDocument();
    });
  });

  it("runs the knowledge eval and shows the governed result", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    const rows = await screen.findAllByTestId(/review-input-evaluate-/);
    const firstEval = rows.at(0);
    if (firstEval === undefined) throw new Error("no evaluate buttons rendered");
    await userEvent.click(firstEval);
    const result = await screen.findByTestId("knowledge-eval-result");
    expect(within(result).getByText("通过")).toBeInTheDocument();
  });

  it("saves a high-impact budget change through the two-step confirmation", async () => {
    renderPage(<AdminAiBudgetPage />);
    const enforced = await screen.findByTestId("ai-budget-enforced");
    await waitFor(() => expect(enforced).not.toBeDisabled());
    await userEvent.click(enforced);
    await userEvent.click(await screen.findByTestId("ai-budget-assess"));
    expect(await screen.findByTestId("ai-budget-impact-level")).toHaveTextContent("高影响");
    await userEvent.click(screen.getByTestId("ai-budget-confirm"));
    await screen.findByTestId("ai-budget-saved");
  });

  it("confirms a provider delete before executing it", async () => {
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-delete-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("删除 Provider")).toBeInTheDocument();
    expect(within(dialog).getByText(/确认删除 Provider primary-glm/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("marks the primary provider by selection order", async () => {
    renderPage(<AdminProvidersPage />);
    const primaryRole = await screen.findByTestId(`provider-role-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    expect(primaryRole).toHaveTextContent("主");
  });

  it("marks draft skills as not bindable in the rule-set editor", async () => {
    renderPage(<AdminRuleSetsPage />);
    await userEvent.click(await screen.findByTestId(/rule-set-edit-/));
    await screen.findByTestId("rule-set-tools");
    expect(screen.getByText("Draft 不可绑定")).toBeInTheDocument();
  });
});

// ---- dialog flows: create/replace/delete on both registries ----

describe("review-input dialog flows", () => {
  it("creates an enabled skill through the four-field editor", async () => {
    renderPage(<AdminReviewSkillsPage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    await userEvent.type(screen.getByTestId("review-input-name"), "column-null-check");
    await userEvent.type(screen.getByTestId("review-input-knowledge-text"), "Columns must be NOT NULL unless justified.");
    await userEvent.type(screen.getByTestId("review-input-finding-key"), "ddl.null.check");
    await userEvent.type(screen.getByTestId("review-input-title"), "Nullable column");
    await userEvent.type(screen.getByTestId("review-input-message"), "The column allows NULL.");
    // severity chips toggle: turn high off, then on again (minItems guard keeps medium)
    // severity chips toggle: turn medium off, then on again (minItems 1 guard)
    await userEvent.click(screen.getByTestId("review-input-severity-medium"));
    await userEvent.click(screen.getByTestId("review-input-severity-medium"));
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.getByText("column-null-check")).toBeInTheDocument());
    expect(screen.getByTestId("review-input-outdated-note")).toBeInTheDocument();
  });

  it("replaces an existing skill and bumps its version", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    const secondRow = rows.at(1);
    if (secondRow === undefined) throw new Error("expected two seeded skills");
    const editButton = within(secondRow).getByTestId(/review-input-edit-/);
    await userEvent.click(editButton);
    await screen.findByTestId("review-input-knowledge-text");
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes a skill and surfaces the referenced error on a bound one", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    // draft tool is unreferenced → delete succeeds
    const secondRow = rows.at(1);
    if (secondRow === undefined) throw new Error("expected seeded skills");
    await userEvent.click(within(secondRow).getByTestId(/review-input-delete-/));
    await userEvent.click(screen.getByTestId("review-input-delete-confirm"));
    await waitFor(() => {
      // two rows remain: the bound enabled tool and the undeletable built-in
      expect(screen.queryAllByTestId(/review-input-row-/)).toHaveLength(2);
    });
    // enabled tool is referenced by the seeded rule set → 1006 error
    const boundRow = (await screen.findAllByTestId(/review-input-row-/))
      .map((row) => ({ row, button: within(row).queryByTestId(/review-input-delete-/) }))
      .find(({ row }) => row.textContent.includes("dml-where-guard"))?.button;
    if (boundRow === undefined || boundRow === null) throw new Error("bound row not rendered");
    await userEvent.click(boundRow);
    await userEvent.click(screen.getByTestId("review-input-delete-confirm"));
    await screen.findByTestId("review-input-delete-error");
  });

  it("renders scope, purpose and provenance facts for the seeded entries", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    await screen.findAllByTestId(/review-input-row-/);
    // Table-scoped entry shows the database.table tuple.
    expect(screen.getByText("orderdb.orders")).toBeInTheDocument();
    // Datasource-scoped entry shows the scope label; converted rows keep
    // their provenance badge and purpose line.
    expect(screen.getByText("数据源级")).toBeInTheDocument();
    expect(screen.getByText("Finding 转化")).toBeInTheDocument();
    expect(screen.getAllByText("Converted from a historical review finding.").length).toBeGreaterThan(0);
  });

  it("shows the disabled state badge for a disabled entry", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    await screen.findAllByTestId(/review-input-row-/);
    const badges = screen.getAllByTestId("review-input-state");
    expect(badges.some((badge) => badge.textContent === "停用")).toBe(true);
    expect(badges.some((badge) => badge.textContent === "草稿")).toBe(true);
  });
});

describe("connection test flow", () => {
  it("runs the test on the pg datasource and renders the capability matrix with unavailable badges", async () => {
    renderPage(<AdminDatasourcesPage />);
    const pgRow = await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    // Expanding the matrix is a user-event side effect; the capabilities
    // query polls until the async probe task materializes the facts.
    await userEvent.click(within(pgRow).getByTestId(`ds-test-button-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`));
    const capabilities = await screen.findByTestId("ds-capabilities", {}, { timeout: 4000 });
    await waitFor(() => expect(capabilities).toHaveTextContent("16.3"), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId("ds-capability-execution")).toHaveTextContent("不可用"), { timeout: 4000 });
    expect(screen.getByText("部分能力不可用")).toBeInTheDocument();
  });
});

// ---- dialog submit paths, edit prefill, eval fail, list states ----

describe("review-input dialog coverage", () => {
  it("surfaces the validation error inside the dialog and closes on success", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    // Empty name → 1001 → the dialog stays open with the localized error.
    await userEvent.click(screen.getByTestId("review-input-submit"));
    const error = await screen.findByTestId("review-input-error");
    expect(error).toBeInTheDocument();
    // Then a valid create closes the dialog and adds the row.
    await userEvent.type(screen.getByTestId("review-input-name"), "global-manual-entry");
    await userEvent.type(screen.getByTestId("review-input-knowledge-text"), "Keep default charset.");
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.getByText("global-manual-entry")).toBeInTheDocument());
  });

  it("prefills the table-scoped edit form and submits the replace", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    const tableRow = rows.find((row) => row.textContent.includes("orderdb.orders"));
    if (tableRow === undefined) throw new Error("table-scoped row not rendered");
    await userEvent.click(within(tableRow).getByTestId(/review-input-edit-/));
    // Scoped form prefills: datasource select, database and table inputs.
    expect(screen.getByTestId("knowledge-datasource")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-table")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes a draft entry successfully and surfaces the referenced error on a converted one", async () => {
    renderPage(<AdminReviewKnowledgePage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    const draftRow = rows.find((row) => row.textContent.includes("orders-huge-table"));
    if (draftRow === undefined) throw new Error("draft row not rendered");
    await userEvent.click(within(draftRow).getByTestId(/review-input-delete-/));
    await userEvent.click(screen.getByTestId("review-input-delete-confirm"));
    await waitFor(() => {
      expect(screen.getAllByTestId(/review-input-row-/)).toHaveLength(2);
    });
    // The converted entry is review-referenced → 1006 → error alert.
    const convertedRow = (await screen.findAllByTestId(/review-input-row-/))
      .map((row) => ({ row, button: within(row).queryByTestId(/review-input-delete-/) }))
      .find(({ row }) => row.textContent.includes("charset-uniformity"))?.button;
    if (convertedRow === undefined || convertedRow === null) throw new Error("converted row not rendered");
    await userEvent.click(convertedRow);
    await userEvent.click(screen.getByTestId("review-input-delete-confirm"));
    await screen.findByTestId("review-input-delete-error");
  });

  it("renders a failing evaluation with its findings list", async () => {
    server.use(
      http.post("*/admin/knowledge-entries/:id/evaluations", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            pass: false,
            schema_subset_ok: false,
            privacy_ok: false,
            injection_ok: false,
            severity_ok: false,
            findings: ["finding template must define finding_key, title and message"],
            checked_at: "2026-08-31T00:00:00Z",
          },
          request_id: "eval-fail",
        }),
      ),
    );
    renderPage(<AdminReviewKnowledgePage />);
    const evalButtons = await screen.findAllByTestId(/review-input-evaluate-/);
    const firstEval = evalButtons.at(0);
    if (firstEval === undefined) throw new Error("no evaluate buttons rendered");
    await userEvent.click(firstEval);
    const result = await screen.findByTestId("knowledge-eval-result");
    expect(within(result).getByText("未通过")).toBeInTheDocument();
    expect(within(result).getByText(/finding template must define/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByTestId("knowledge-eval-result")).not.toBeInTheDocument());
  });

  it("renders the error state and the empty state of the registries", async () => {
    server.use(
      http.get("*/admin/prompt-tools", () =>
        HttpResponse.json({ err_code: 1002, message: "boom", data: null, request_id: "r1", retryable: false }),
      ),
    );
    renderPage(<AdminReviewSkillsPage />);
    await screen.findByText(/请求未能完成|操作未能完成|资源不存在/);
  });

  it("renders the empty registry state", async () => {
    server.use(
      http.get("*/admin/prompt-tools", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: { items: [], page: { next_cursor: null, has_more: false } },
          request_id: "r2",
        }),
      ),
    );
    renderPage(<AdminReviewSkillsPage />);
    await screen.findByText("暂无技能包");
  });
});

// ---- FE-F9-REVIEW-ADMIN-ALIGNMENT gates -----------------------------------

/** Captures the request body an MSW-overridden write actually sent. */
function captureDatasourcePut(): { body: Record<string, unknown> | null } {
  const captured: { body: Record<string, unknown> | null } = { body: null };
  server.use(
    http.put("*/admin/datasources/:datasourceId", async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        err_code: 0,
        message: "ok",
        data: {
          id: ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
          name: "prod-order-mysql",
          engine: "mysql",
          compatibility_mode: "mysql",
          deployment_kind: "native",
          host: "10.0.0.11",
          port: 3306,
          database_name: null,
          enabled: true,
          credential_status: { review: true, query: true, execution: true },
          tls_verified: false,
          referenced_by_flow_count: 1,
          version: 99,
          created_at: "2026-08-31T00:00:00Z",
          updated_at: "2026-08-31T00:00:00Z",
        },
        request_id: "capture",
      });
    }),
  );
  return captured;
}

describe("gate: 内置技能锁徽章与定义面锁定", () => {
  it("renders the lock badge with a visible explanation and disables delete", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    expect(within(row).getByTestId(`review-input-builtin-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`)).toHaveTextContent(
      "内置",
    );
    // The row itself explains the lock — a tooltip is never the only carrier.
    expect(within(row).getByText(/仅状态可切换/)).toBeInTheDocument();
    expect(within(row).getByTestId(/review-input-delete-/)).toBeDisabled();
    // Hash column stays (builtin rows are ordinary registry rows otherwise).
    expect(within(row).getByTestId("review-input-hash")).toBeInTheDocument();
  });

  it("locks the definition face in the editor and keeps the state select active", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    await userEvent.click(within(row).getByTestId(/review-input-edit-/));
    expect(await screen.findByTestId("review-input-builtin-notice")).toBeInTheDocument();
    expect(screen.getByTestId("review-input-name")).toBeDisabled();
    expect(screen.getByTestId("review-input-engine")).toBeDisabled();
    expect(screen.getByTestId("review-input-knowledge-text")).toBeDisabled();
    expect(screen.getByTestId("review-input-finding-key")).toBeDisabled();
    expect(screen.getByTestId("review-input-title")).toBeDisabled();
    expect(screen.getByTestId("review-input-severity-medium")).toBeDisabled();
    expect(screen.getByTestId("review-input-state-select")).toBeEnabled();
  });

  // The state TOGGLE itself lives in admin-pages-popups.test.tsx: Base UI
  // 1.7 select popups leak their layer stack across tests under jsdom, so
  // every popup interaction is consolidated into one isolated file.
});

describe("gate: 凭据表单三模式（keep仅已配置行可选）", () => {
  it("submits keep for configured rows with no username and no password in the payload", async () => {
    const captured = captureDatasourcePut();
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    await screen.findByTestId("credential-row-review");
    // Configured rows open in keep mode: neither input is even rendered.
    expect(screen.queryByTestId("credential-username-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("credential-password-review")).not.toBeInTheDocument();
    expect(screen.getByTestId("credential-keep-note-review")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    const credentials = captured.body?.credentials as Array<Record<string, unknown>>;
    expect(credentials).toHaveLength(3);
    for (const credential of credentials) {
      expect(credential.reuse_credential_purpose).toBe(credential.purpose);
      expect("username" in credential).toBe(false);
      expect("password" in credential).toBe(false);
    }
    // Full-replacement TLS write is explicit: null, never absent.
    expect(captured.body?.tls).toBeNull();
  });

  // Option-availability and mode-switch assertions (which need an open
  // select popup) live in admin-pages-popups.test.tsx — see the isolation
  // note there. Popup-free coverage below proves the payload semantics.
  it("blocks the submit while base fields are missing or no purpose is included", async () => {
    renderPage(<AdminDatasourcesPage />);
    await userEvent.click(await screen.findByTestId("ds-create"));
    await screen.findByTestId("credential-row-review");
    // Empty name/host/version-constraint → disabled with the visible hint.
    await userEvent.type(screen.getByTestId("ds-name"), "guard-check");
    await userEvent.type(screen.getByTestId("ds-host"), "10.0.0.95");
    expect(screen.getByTestId("ds-submit")).toBeDisabled();
    expect(screen.getByTestId("ds-form-invalid-hint")).toBeInTheDocument();
    // Editing never echoes version_constraint — the empty value keeps the
    // submit disabled until it is re-typed.
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.type(screen.getByTestId("credential-username-review"), "ro");
    await userEvent.type(screen.getByTestId("credential-password-review"), "pw-guard-1");
    expect(screen.getByTestId("ds-submit")).toBeEnabled();
    // Unchecking the last purpose violates credentials minItems 1.
    await userEvent.click(screen.getByTestId("credential-include-review"));
    expect(screen.getByTestId("ds-submit")).toBeDisabled();
    expect(screen.getByTestId("ds-form-invalid-hint")).toBeInTheDocument();
  });
  it("drops purposes that are unchecked from the full-replacement payload", async () => {
    const captured = captureDatasourcePut();
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    await screen.findByTestId("credential-row-review");
    // Unchecking execution removes it: the write is a full replacement.
    await userEvent.click(screen.getByTestId("credential-include-execution"));
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    const credentials = captured.body?.credentials as Array<Record<string, unknown>>;
    expect(credentials.map((credential) => credential.purpose)).toEqual(["review", "query"]);
  });
});

describe("gate: TLS材料永不回显且tls_verified可见", () => {
  it("shows both TLS states in the list", async () => {
    renderPage(<AdminDatasourcesPage />);
    expect(
      await screen.findByTestId(`ds-tls-verified-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`),
    ).toHaveTextContent("强制校验TLS");
    expect(
      screen.getByTestId(`ds-tls-plaintext-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`),
    ).toHaveTextContent("明文");
  });

  it("never prefills material on a verified row and re-submits the full block", async () => {
    const captured = captureDatasourcePut();
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`));
    expect(screen.getByTestId("ds-tls-enabled")).toBeChecked();
    // Write-only: opening a verified row leaves every textarea empty.
    expect(screen.getByTestId("ds-tls-ca")).toHaveValue("");
    expect(screen.getByTestId("ds-tls-cert")).toHaveValue("");
    expect(screen.getByTestId("ds-tls-key")).toHaveValue("");
    await userEvent.type(screen.getByTestId("ds-tls-ca"), "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n");
    await userEvent.type(screen.getByTestId("ds-tls-cert"), "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n");
    await userEvent.type(screen.getByTestId("ds-tls-key"), "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n");
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=16");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    expect(captured.body?.tls).toEqual({
      ca_pem: { value: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n" },
      client_cert_pem: { value: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n" },
      client_key_pem: { value: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n" },
    });
  });

  it("warns before the declared removal path and submits tls null", async () => {
    const captured = captureDatasourcePut();
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`));
    await screen.findByTestId("ds-tls-enabled");
    await userEvent.click(screen.getByTestId("ds-tls-enabled"));
    expect(await screen.findByTestId("ds-tls-removal-warning")).toHaveTextContent("恢复明文连接");
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=16");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    expect(captured.body?.tls).toBeNull();
  });

  it("blocks unpaired and empty TLS blocks client-side", async () => {
    renderPage(<AdminDatasourcesPage />);
    await userEvent.click(await screen.findByTestId("ds-create"));
    await userEvent.type(screen.getByTestId("ds-name"), "tls-check");
    await userEvent.type(screen.getByTestId("ds-host"), "10.0.0.90");
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.type(screen.getByTestId("credential-username-review"), "ro");
    await userEvent.type(screen.getByTestId("credential-password-review"), "pw-tls-1");
    // Enabled with no material at all.
    await userEvent.click(screen.getByTestId("ds-tls-enabled"));
    expect(await screen.findByTestId("ds-tls-empty-error")).toBeInTheDocument();
    expect(screen.getByTestId("ds-submit")).toBeDisabled();
    // Cert without key.
    await userEvent.type(
      screen.getByTestId("ds-tls-cert"),
      "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n",
    );
    expect(screen.queryByTestId("ds-tls-empty-error")).not.toBeInTheDocument();
    expect(await screen.findByTestId("ds-tls-pair-error")).toBeInTheDocument();
    expect(screen.getByTestId("ds-submit")).toBeDisabled();
    // Completing the pair unlocks the submit.
    await userEvent.type(
      screen.getByTestId("ds-tls-key"),
      "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
    );
    expect(screen.queryByTestId("ds-tls-pair-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("ds-submit")).toBeEnabled();
  });
});

describe("gate: Eval门禁措辞与就地渲染", () => {
  it("explains the save-time eval gate on the skills dialog", async () => {
    renderPage(<AdminReviewSkillsPage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    expect(await screen.findByTestId("skills-eval-gate-hint")).toHaveTextContent(/保存时执行Eval门禁/);
    // No separate Eval entry exists anywhere on the skills surface; the
    // knowledge page keeps its declared evaluations endpoint.
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent).not.toMatch(/运行 ?Eval|执行评估/);
    }
    expect(screen.queryByTestId("knowledge-eval-dialog")).not.toBeInTheDocument();
  });

  // The inline failure rendering (enabled save blocked with the business
  // error inside the dialog) is exercised in admin-pages-popups.test.tsx —
  // it needs the state select popup.
});
