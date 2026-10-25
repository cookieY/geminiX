import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openRowActions, openRowActionsAt } from "@/test/row-actions";
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
  ADMIN_FIXTURE_TOOL_DRAFT_ID,
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
import { renderSkillDescription } from "@/features/admin/skill-description";
import { convertParamDrafts, paramTypeKey, stringifyParamDrafts } from "@/features/admin/review-input-page";

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
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
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
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-edit-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    const apiKey = await screen.findByTestId("provider-api-key");
    expect(apiKey).toHaveValue("");
    expect(screen.getByText(/API Key：已配置/)).toBeInTheDocument();
    expect(screen.queryByText(/pkey-a1/)).not.toBeInTheDocument();
  });

  it("offers no contract-hash inputs — both fingerprints are platform-derived", async () => {
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-edit-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    await screen.findByTestId("provider-api-key");
    // §18.67：隐私契约/输出Schema指纹由系统派生（provider contract_hash.go），
    // 不得以任何用户输入面回归。
    expect(screen.queryByTestId("provider-privacy-hash")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-schema-hash")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/隐私契约/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Schema Hash/)).not.toBeInTheDocument();
    // §18.68：类型是受控下拉（唯一合法项 openai_compatible），不再是自由文本。
    const kind = screen.getByTestId("provider-kind");
    expect(kind).toHaveAttribute("role", "combobox");
    expect(kind).toHaveTextContent(/OpenAI Compatible/);
    expect(screen.queryAllByTestId("provider-kind").filter((el) => el.tagName === "INPUT")).toHaveLength(0);
  });
});

describe("gate: 无外部代码HTTP或写库Custom Tool UI", () => {
  it("renders only the governed rule definition editor — no executable affordances", async () => {
    renderPage(<AdminReviewSkillsPage />);
    await screen.findByTestId("review-input-create");
    await userEvent.click(screen.getByTestId("review-input-create"));
    await screen.findByTestId("review-input-knowledge-text");
    // 强制规则的实际违规等级固定为 Critical；legacy max_severity 不再是可编辑选项。
    expect(screen.getByTestId("review-input-critical-severity")).toHaveTextContent("严重");
    expect(screen.queryByTestId(/^review-input-max-severity/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-input-finding-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-input-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-input-message")).not.toBeInTheDocument();
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

describe("gate: 配置Hash与Review失效影响明确（owner裁定：列表不展示，挪入编辑对话框）", () => {
  it("keeps hashes and the outdated-impact note out of the list and inside the edit dialog", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    // 列表零hash、零常驻说明（owner：对用户没有意义）。
    expect(screen.queryByTestId("review-input-hash")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-input-outdated-note")).not.toBeInTheDocument();
    // 编辑对话框承载两者：说明常驻、hash仅编辑态（存量行必有值）。
    const row = rows[0];
    if (row === undefined) throw new Error("expected a seeded skill row");
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-edit-/));
    expect(await screen.findByTestId("review-input-outdated-note")).toBeInTheDocument();
    expect(screen.getByTestId("review-input-hash").textContent).toMatch(/^[0-9a-f]{16}$/);
  });

  it("previews rule-set impact: bound flows and the hash-change warning", async () => {
    renderPage(<AdminRuleSetsPage />);
    const row = await screen.findByTestId(/rule-set-row-/);
    expect(within(row).getByTestId("rule-set-hash")).toBeInTheDocument();
    await openRowActions(/rule-set-actions-/);
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
    // The owner test catalog pushed the table past one page; the created row
    // (newest created_at) sits on page 2 under the backend's asc ordering —
    // widen the page to see it.
    await userEvent.click(await screen.findByTestId("datasources-page-size-50"));
    await waitFor(() => {
      expect(screen.getByText("new-warehouse")).toBeInTheDocument();
    }, { timeout: 4000 });
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
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
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
    await openRowActionsAt(await screen.findByTestId(/rule-set-actions-/));
    await userEvent.click(await screen.findByTestId(/rule-set-edit-/));
    await screen.findByTestId("rule-set-tools");
    expect(screen.getByText("Draft 不可绑定")).toBeInTheDocument();
  });

  it("composes skills by description with search and select-all (§18.80)", async () => {
    renderPage(<AdminRuleSetsPage />);
    await openRowActionsAt(await screen.findByTestId(/rule-set-actions-/));
    await userEvent.click(await screen.findByTestId(/rule-set-edit-/));
    await screen.findByTestId("rule-set-tools");
    // hash展示换成技能说明：对话框内不再渲染64位hash，改渲染说明文案。
    expect(screen.getByText(/内置词法守卫/)).toBeInTheDocument();
    expect(screen.queryByText(/^[0-9a-f]{64}$/)).not.toBeInTheDocument();
    // 全选：可绑定2个、已选1个（半选），点一次全选后2/2。
    expect(screen.getByTestId("rule-set-tools-select-all-count")).toHaveTextContent("1/2");
    expect(screen.getByTestId("rule-set-tools-select-all")).not.toBeChecked();
    await userEvent.click(screen.getByTestId("rule-set-tools-select-all"));
    expect(screen.getByTestId("rule-set-tools-select-all-count")).toHaveTextContent("2/2");
    expect(screen.getByTestId("rule-set-tools-select-all")).toBeChecked();
    // 搜索过滤到唯一草稿行：无可绑定项时全选禁用（Base UI走aria-disabled），count归零。
    await userEvent.type(screen.getByTestId("rule-set-tools-search"), "table-comment");
    expect(screen.getByTestId("rule-set-tools-select-all")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("rule-set-tools-select-all-count")).toHaveTextContent("0/0");
    expect(screen.getByTestId(/rule-set-tool-option-/)).toBeInTheDocument();
    // 清空搜索恢复全表。
    await userEvent.click(screen.getByTestId("rule-set-tools-search-clear"));
    expect(screen.getByTestId("rule-set-tools-select-all-count")).toHaveTextContent("2/2");
  });

  it("shows the skill description under the table name (§18.80)", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    expect(
      within(row).getByTestId(`review-input-description-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`),
    ).toHaveTextContent("内置词法守卫");
  });

  it("tunes builtin parameter values without touching the system-owned rule text (§18.81)", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-edit-/));
    const section = await screen.findByTestId("review-input-params");
    // 规则正文锁定不动（owner裁定：提示词不可改），参数控件可用。
    const ruleText = screen.getByTestId("review-input-knowledge-text");
    expect(ruleText).toBeDisabled();
    expect(section).toHaveTextContent("max_in_items");
    const valueInput = within(section).getByTestId("review-input-param-max_in_items");
    // 非法值（清空）：就地拦截，不发请求，弹窗不关。
    await userEvent.clear(valueInput);
    await userEvent.click(screen.getByTestId("review-input-submit"));
    expect(screen.getByTestId("review-input-param-error")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // 合法值：1000 → 2000，保存成功弹窗关闭。
    await userEvent.type(valueInput, "2000");
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // 重开回显新值；规则正文仍是系统原文。
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-edit-/));
    const reopened = await screen.findByTestId("review-input-params");
    expect(within(reopened).getByTestId("review-input-param-max_in_items")).toHaveValue(2000);
    expect(screen.getByTestId("review-input-knowledge-text")).toBeDisabled();
  });

  it("renders skill-description placeholders with current parameter values (§18.80补记1)", () => {
    expect(
      renderSkillDescription("行数不得超过{{max_affect_rows}}", { max_affect_rows: 100000 }),
    ).toBe("行数不得超过100000");
    // 缺失参数保留占位原样（用户自写说明引用不存在键的兜底）。
    expect(renderSkillDescription("不得超过{{missing_key}}", {})).toBe("不得超过{{missing_key}}");
    expect(renderSkillDescription("纯文本说明", {})).toBe("纯文本说明");
    expect(
      renderSkillDescription("禁用引擎：{{forbidden_engines}}", { forbidden_engines: ["myisam", "memory"] }),
    ).toBe("禁用引擎：myisam, memory");
  });
});

// ---- dialog flows: create/replace/delete on both registries ----

describe("review-input dialog flows", () => {
  it("submits a new skill with Critical as the effective severity", async () => {
    const writes: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/admin/prompt-tools", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        writes.push(body);
      }),
    );
    renderPage(<AdminReviewSkillsPage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    await userEvent.type(screen.getByTestId("review-input-name"), "column-null-check");
    await userEvent.type(screen.getByTestId("review-input-knowledge-text"), "Columns must be NOT NULL unless justified.");
    expect(screen.getByTestId("review-input-critical-severity")).toBeInTheDocument();
    expect(screen.queryByTestId(/^review-input-max-severity/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.definition).toMatchObject({ max_severity: "critical" });
  });

  it("preserves legacy draft max_severity while showing Critical as the effective severity", async () => {
    const writes: Array<Record<string, unknown>> = [];
    server.use(
      http.put("*/admin/prompt-tools/:promptToolId", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        writes.push(body);
      }),
    );
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_DRAFT_ID}`);
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-edit-/));
    await screen.findByTestId("review-input-critical-severity");
    expect(screen.queryByTestId(/^review-input-max-severity/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.definition).toMatchObject({ max_severity: "low" });
  });

  it("submits an internal-experience rule with Critical as the effective severity", async () => {
    const writes: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/admin/knowledge-entries", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        writes.push(body);
      }),
    );
    renderPage(<AdminReviewKnowledgePage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    await userEvent.type(screen.getByTestId("review-input-name"), "charset-policy");
    await userEvent.type(screen.getByTestId("review-input-knowledge-text"), "Keep the default charset.");
    expect(screen.getByTestId("review-input-critical-severity")).toBeInTheDocument();
    expect(screen.queryByTestId(/^review-input-max-severity/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.definition).toMatchObject({ max_severity: "critical" });
  });

  it("replaces an existing skill and bumps its version", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const rows = await screen.findAllByTestId(/review-input-row-/);
    const secondRow = rows.at(1);
    if (secondRow === undefined) throw new Error("expected two seeded skills");
    await openRowActionsAt(within(secondRow).getByTestId(/review-input-actions-/));
    const editButton = screen.getByTestId(/review-input-edit-/);
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
    await openRowActionsAt(within(secondRow).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-delete-/));
    await userEvent.click(screen.getByTestId("review-input-delete-confirm"));
    await waitFor(() => {
      // two rows remain: the bound enabled tool and the undeletable built-in
      expect(screen.queryAllByTestId(/review-input-row-/)).toHaveLength(2);
    });
    // enabled tool is referenced by the seeded rule set → 1006 error; the
    // delete affordance lives in the row's ⋯ menu (portal, screen-scoped)
    const boundRow = (await screen.findAllByTestId(/review-input-row-/))
      .find((row) => row.textContent.includes("dml-where-guard"));
    if (boundRow === undefined) throw new Error("bound row not rendered");
    await openRowActionsAt(within(boundRow).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-delete-/));
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
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    // Expanding the matrix is a user-event side effect; the capabilities
    // query polls until the async probe task materializes the facts.
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    await userEvent.click(screen.getByTestId(`ds-test-button-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`));
    const capabilities = await screen.findByTestId("ds-capabilities", {}, { timeout: 4000 });
    await waitFor(() => expect(capabilities).toHaveTextContent("16.3"), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId("ds-capability-execution")).toHaveTextContent("不可用"), { timeout: 4000 });
    expect(screen.getByText("部分能力不可用")).toBeInTheDocument();
  });

  // §18.61：连接测试用途是数据源持久化属性——表格不出现用途选择器，
  // 变更入口只在编辑弹窗（弹窗内切换与载荷断言见 admin-pages-popups）。
  // §18.62：表单以只读/读写两态呈现（与表格凭据徽章同词汇）。
  it("keeps the purpose select out of the table and prefills the credential class in the edit dialog", async () => {
    renderPage(<AdminDatasourcesPage />);
    const row = await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    expect(within(row).queryAllByTestId(/ds-test-purpose-/)).toHaveLength(0);
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    // 预填=存储值（review）呈现为只读类别。
    expect(await screen.findByTestId("ds-test-purpose")).toHaveTextContent("只读");
    expect(screen.getByText(/只读用审核（或查询）凭据，读写用执行凭据/)).toBeInTheDocument();
  });

  // §18.62：只读在载荷不再保留审核凭据时回落查询凭据。
  it("resolves a read-only test purpose onto query when the payload drops the review credential", async () => {
    const captured = captureDatasourcePut();
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    await screen.findByTestId("credential-row-review");
    await userEvent.click(screen.getByTestId("credential-include-review"));
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    expect(captured.body?.test_purpose).toBe("query");
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
            findings: ["definition must carry non-empty knowledge_text and a valid max_severity"],
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
    expect(within(result).getByText(/definition must carry non-empty knowledge_text/)).toBeInTheDocument();
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
          test_purpose: "review",
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
    // 行内不再有说明文字（挪入编辑对话框的builtin notice承担解释）。
    expect(within(row).queryByText(/仅状态可切换/)).not.toBeInTheDocument();
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    // Base UI menu items disable via aria-disabled (divs carry no native disabled attr)
    expect(screen.getByTestId(/review-input-delete-/)).toHaveAttribute("aria-disabled", "true");
  });

  it("locks the definition face in the editor and keeps the state select active", async () => {
    renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    await openRowActionsAt(within(row).getByTestId(/review-input-actions-/));
    await userEvent.click(screen.getByTestId(/review-input-edit-/));
    expect(await screen.findByTestId("review-input-builtin-notice")).toBeInTheDocument();
    expect(screen.getByTestId("review-input-name")).toBeDisabled();
    expect(screen.getByTestId("review-input-engine")).toBeDisabled();
    expect(screen.getByTestId("review-input-knowledge-text")).toBeDisabled();
    expect(screen.getByTestId("review-input-knowledge-text")).toBeDisabled();
    expect(screen.getByTestId("review-input-critical-severity")).toHaveTextContent("严重");
    expect(screen.queryByTestId(/^review-input-max-severity/)).not.toBeInTheDocument();
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
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
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
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
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
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
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
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
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

describe("gate: §18.76-B 模型目录联想", () => {
  it("orders API key above the model field and fills the model from catalog suggestions", async () => {
    renderPage(<AdminProvidersPage />);
    await userEvent.click(await screen.findByTestId("provider-create"));
    await screen.findByTestId("provider-api-key");
    await screen.findByTestId("provider-model");
    // owner裁定②：API Key在模型上方（DOM序断言，jsdom无几何）。
    const apiKey = screen.getByTestId("provider-api-key");
    const model = screen.getByTestId("provider-model");
    expect(apiKey.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.type(screen.getByTestId("provider-base-url"), "https://api.deepseek.test");
    await userEvent.type(apiKey, "sk-catalog");
    // 面板跟输入框focus开合：点进模型输入框后目录项到达即弹出。
    await userEvent.click(screen.getByTestId("provider-model"));
    const panel = await screen.findByTestId("provider-model-options", {}, { timeout: 2500 });
    await userEvent.click(within(panel).getByTestId("provider-model-option-mock-chat-pro"));
    expect(screen.getByTestId("provider-model")).toHaveValue("mock-chat-pro");
    // 真机修正：选中后面板收起（不残留）。
    expect(screen.queryByTestId("provider-model-options")).not.toBeInTheDocument();
  });

  it("keeps manual entry and shows the failure hint when the catalog fetch is rejected", async () => {
    renderPage(<AdminProvidersPage />);
    await userEvent.click(await screen.findByTestId("provider-create"));
    await userEvent.type(screen.getByTestId("provider-base-url"), "https://api.deepseek.test");
    await userEvent.type(screen.getByTestId("provider-api-key"), "mock-invalid-key");
    expect(await screen.findByTestId("provider-model-catalog-failed", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.queryByTestId("provider-model-options")).not.toBeInTheDocument();
    // 手填不受影响。
    await userEvent.type(screen.getByTestId("provider-model"), "deepseek-chat");
    expect(screen.getByTestId("provider-model")).toHaveValue("deepseek-chat");
  });

  it("reuses the stored credential via provider_id when editing without retyping the key", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/admin/ai-providers/models", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          err_code: 0, message: "ok", data: { items: ["spy-model-a"] }, request_id: "spy",
        });
      }),
    );
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-edit-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    await screen.findByTestId("provider-model");
    await waitFor(() => {
      expect(bodies.length).toBeGreaterThan(0);
    }, { timeout: 2500 });
    const lastBody = bodies.at(-1);
    expect(lastBody?.provider_id).toBe(ADMIN_FIXTURE_PROVIDER_PRIMARY_ID);
    expect(lastBody?.api_key).toBeUndefined();
  });
});

describe("gate: 连接测试同步结果反馈（RCP-20261017 #019对齐）", () => {
  it("shows the ok line after a synchronous successful connection test", async () => {
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-test-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    expect(await screen.findByTestId(`provider-test-ok-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`)).toBeInTheDocument();
  });

  it("surfaces the upstream reason when the connection test fails", async () => {
    server.use(
      http.post("*/admin/ai-providers/:providerId/connection-tests", () =>
        HttpResponse.json({
          err_code: 2011,
          message: "provider failed",
          data: null,
          request_id: "conn-detail-req",
          retryable: false,
          meta: { detail: 'provider: request rejected: status 401: {"error":{"message":"Authentication Fails"}}' },
        }),
      ),
    );
    renderPage(<AdminProvidersPage />);
    await screen.findByTestId(`provider-row-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await openRowActions(`provider-actions-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`);
    await userEvent.click(screen.getByTestId(`provider-test-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`));
    expect(
      await screen.findByTestId(`provider-test-error-detail-${ADMIN_FIXTURE_PROVIDER_PRIMARY_ID}`),
    ).toHaveTextContent(/Authentication Fails/);
  });
});

describe("gate: 数据源连接测试拒因透出（§18.76补）", () => {
  it("surfaces the upstream reason when the connection test fails", async () => {
    server.use(
      http.post("*/admin/datasources/:dsId/connection-tests", () =>
        HttpResponse.json({
          err_code: 3010,
          message: "数据源连接测试失败",
          data: null,
          request_id: "ds-detail-req",
          retryable: false,
          meta: {
            detail: "datasource: connection failed: database: mysql dial failed: dial tcp 127.0.0.1:54334: connect: connection refused",
          },
        }),
      ),
    );
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-test-button-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    expect(
      await screen.findByTestId(`ds-test-error-detail-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`),
    ).toHaveTextContent(/connection refused/);
  });
});

describe("gate: 数据源连接测试成功反馈", () => {
  it("shows the ok line when the connection test task succeeds", async () => {
    server.use(
      http.post("*/admin/datasources/:dsId/connection-tests", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: "0198d9cc-0000-7000-8000-000000000001",
            kind: "admin_connection_test",
            state: "succeeded",
            progress: { completed: 1, total: 1, unit: "steps" },
            result_ref: null,
            error: null,
            created_at: "2026-10-19T00:00:00Z",
            updated_at: "2026-10-19T00:00:00Z",
          },
          request_id: "ds-ok-req",
        }),
      ),
    );
    // 轮询GET也钉在同一succeeded任务上（真夹具无此任务）。
    server.use(
      http.get("*/tasks/:taskId", () =>
        HttpResponse.json({
          err_code: 0,
          message: "ok",
          data: {
            id: "0198d9cc-0000-7000-8000-000000000001",
            kind: "admin_connection_test",
            state: "succeeded",
            progress: { completed: 1, total: 1, unit: "steps" },
            result_ref: null,
            error: null,
            created_at: "2026-10-19T00:00:00Z",
            updated_at: "2026-10-19T00:00:00Z",
          },
          request_id: "ds-ok-req",
        }),
      ),
    );
    renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await openRowActions(`ds-actions-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-test-button-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    expect(
      await screen.findByTestId(`ds-test-ok-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`),
    ).toBeInTheDocument();
  });
});

describe("parameter draft helpers (§18.81)", () => {
  it("stringifies every supported parameter type", () => {
    expect(
      stringifyParamDrafts({ n: 1000, b: false, s: "text", list: ["a", "b"] }),
    ).toEqual({ n: "1000", b: "false", s: "text", list: "a, b" });
    expect(stringifyParamDrafts({ b: true })).toEqual({ b: "true" });
  });

  it("restores typed values from drafts by the row's parameter types", () => {
    expect(
      convertParamDrafts({ n: "2000", b: "true", s: "hello", list: "x, y" }, {
        n: 1000, b: false, s: "old", list: ["x"],
      }),
    ).toEqual({ n: 2000, b: true, s: "hello", list: ["x", "y"] });
  });

  it("rejects number drafts that are empty, fractional or out of range", () => {
    const template = { n: 1000 };
    expect(convertParamDrafts({ n: "" }, template)).toBeNull();
    expect(convertParamDrafts({ n: "12.5" }, template)).toBeNull();
    expect(convertParamDrafts({ n: "0" }, template)).toBeNull();
    expect(convertParamDrafts({ n: "1e16" }, template)).toBeNull();
    expect(convertParamDrafts({ n: "1000" }, template)).toEqual({ n: 1000 });
  });

  it("rejects string drafts that are empty or over 128 characters", () => {
    expect(convertParamDrafts({ s: "" }, { s: "old" })).toBeNull();
    expect(convertParamDrafts({ s: "x".repeat(129) }, { s: "old" })).toBeNull();
    expect(convertParamDrafts({ s: "ok" }, { s: "old" })).toEqual({ s: "ok" });
  });

  it("rejects list drafts over 16 items or with items over 64 characters", () => {
    expect(convertParamDrafts({ list: Array.from({ length: 17 }, (_, i) => `i${String(i)}`).join(", ") }, { list: ["x"] })).toBeNull();
    expect(convertParamDrafts({ list: "x".repeat(65) }, { list: ["x"] })).toBeNull();
    expect(convertParamDrafts({ list: "a, b" }, { list: ["x"] })).toEqual({ list: ["a", "b"] });
    // 过滤逗号产生的空项。
    expect(convertParamDrafts({ list: "a, , b" }, { list: ["x"] })).toEqual({ list: ["a", "b"] });
  });

  it("maps parameter value types to their i18n label keys", () => {
    expect(paramTypeKey(1)).toBe("paramTypeNumber");
    expect(paramTypeKey("s")).toBe("paramTypeString");
    expect(paramTypeKey(true)).toBe("paramTypeBoolean");
    expect(paramTypeKey(["l"])).toBe("paramTypeStringList");
  });
});
