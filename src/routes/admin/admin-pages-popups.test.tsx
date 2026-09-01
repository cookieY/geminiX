import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { HttpResponse, http } from "msw";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { resetAdminFixture } from "@/shared/mock/admin-fixture";
import {
  ADMIN_FIXTURE_DATASOURCE_MYSQL_ID,
  ADMIN_FIXTURE_DATASOURCE_PG_ID,
  ADMIN_FIXTURE_TOOL_BUILTIN_ID,
} from "@/shared/mock/admin-fixture";
import { SessionProvider } from "@/features/auth/session-provider";
import "@/shared/i18n";
import AdminDatasourcesPage from "@/routes/admin/admin-datasources-page";
import AdminReviewSkillsPage from "@/routes/admin/admin-review-skills-page";

/**
 * FE-F9-REVIEW-ADMIN-ALIGNMENT select-popup interactions.
 *
 * Isolation contract: opening a Base UI 1.7 select popup inside these admin
 * dialogs leaves later popup triggers in the SAME FILE inert (verified
 * empirically in both jsdom and Chromium; the dialog close path, Escape vs
 * cancel button, and the prior test's outcome make no difference, while
 * consecutive popup cycles inside ONE test are stable when options are
 * awaited with findByRole). Other suites (e.g. finding-list.test.tsx) open
 * popups across tests without trouble, so the leak is scoped to these admin
 * dialog conditions — until it is root-caused, every admin-surface popup
 * assertion is consolidated into exactly one test in this dedicated file;
 * vitest isolates files, so the leak never reaches other suites. Add new
 * admin popup assertions HERE, inside the single test.
 */

const SESSION_USER_ID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

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

beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { value: () => false, configurable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => undefined, configurable: true });
});

function renderPage(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider>{ui}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Captures the request body an MSW-overridden datasource write sent. */
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

describe("admin select-popup interactions (single isolated test)", () => {
  // CI runners are slower than local machines; this single test packs
  // every popup cycle of the admin surface, so it gets an explicit,
  // generous timeout instead of the default 5s.
  it("covers builtin state toggle, eval-gate inline failure and credential mode switching", { timeout: 30_000 }, async () => {
    // ---- skills: toggle the builtin state through the locked editor ----
    const skills = renderPage(<AdminReviewSkillsPage />);
    const row = await screen.findByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
    await userEvent.click(within(row).getByTestId(/review-input-edit-/));
    await screen.findByTestId("review-input-builtin-notice");
    await userEvent.click(screen.getByTestId("review-input-state-select"));
    await userEvent.click(await screen.findByRole("option", { name: "停用" }));
    await userEvent.click(screen.getByTestId("review-input-submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => {
      const updated = screen.getByTestId(`review-input-row-${ADMIN_FIXTURE_TOOL_BUILTIN_ID}`);
      expect(within(updated).getByTestId("review-input-state")).toHaveTextContent("停用");
    });
    skills.unmount();

    // ---- skills: a failing eval gate renders inline on an enabled save ----
    const skillsEval = renderPage(<AdminReviewSkillsPage />);
    await userEvent.click(await screen.findByTestId("review-input-create"));
    await userEvent.type(screen.getByTestId("review-input-name"), "eval-fail-skill");
    await userEvent.type(screen.getByTestId("review-input-knowledge-text"), "Columns must be NOT NULL.");
    await userEvent.type(screen.getByTestId("review-input-finding-key"), "ddl.null.missing");
    await userEvent.type(screen.getByTestId("review-input-title"), "Nullable column");
    await userEvent.type(screen.getByTestId("review-input-message"), "The column allows NULL.");
    // Template severity high outside the default [medium] whitelist →
    // severity gate fails on the enabled save.
    await userEvent.click(screen.getByTestId("review-input-template-severity-high"));
    await userEvent.click(screen.getByTestId("review-input-state-select"));
    await userEvent.click(await screen.findByRole("option", { name: "启用" }));
    await userEvent.click(screen.getByTestId("review-input-submit"));
    // The failure renders in place: the dialog stays open with the error.
    const inlineError = await screen.findByTestId("review-input-error");
    expect(inlineError).toHaveTextContent("输入内容未通过校验");
    expect(screen.queryByTestId("knowledge-eval-dialog")).not.toBeInTheDocument();
    skillsEval.unmount();

    // ---- datasources (pg edit): keep is offered only on configured rows ----
    const pg = renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_PG_ID}`));
    await screen.findByTestId("credential-row-review");
    // review is configured on pg → keep is offered there.
    await userEvent.click(screen.getByTestId("credential-mode-review"));
    let optionTexts = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(optionTexts).toContain("保持已存凭据");
    expect(optionTexts).toContain("复用其他用途凭据");
    // execution is NOT configured on pg → its mode list has no keep option.
    await userEvent.click(screen.getByTestId("credential-include-execution"));
    await userEvent.click(screen.getByTestId("credential-mode-execution"));
    optionTexts = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(optionTexts).toContain("替换（新用户名＋密码）");
    expect(optionTexts).toContain("复用其他用途凭据");
    expect(optionTexts).not.toContain("保持已存凭据");
    pg.unmount();

    // ---- datasources (create): neither keep nor reuse without stored rows ----
    const create = renderPage(<AdminDatasourcesPage />);
    await userEvent.click(await screen.findByTestId("ds-create"));
    await userEvent.click(screen.getByTestId("credential-mode-review"));
    optionTexts = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(optionTexts).toEqual(["替换（新用户名＋密码）"]);
    create.unmount();

    // ---- datasources (mysql edit): switch to replace, submit the payload ----
    const captured = captureDatasourcePut();
    const mysql = renderPage(<AdminDatasourcesPage />);
    await screen.findByTestId(`ds-row-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`);
    await userEvent.click(screen.getByTestId(`ds-edit-${ADMIN_FIXTURE_DATASOURCE_MYSQL_ID}`));
    await screen.findByTestId("credential-row-review");
    await userEvent.click(screen.getByTestId("credential-mode-review"));
    await userEvent.click(await screen.findByRole("option", { name: "替换（新用户名＋密码）" }));
    await userEvent.type(screen.getByTestId("credential-username-review"), "review_ro");
    await userEvent.type(screen.getByTestId("credential-password-review"), "fresh-secret-1");
    // execution stays in keep mode; switch query to reuse review's stored
    // secret under a new username.
    await userEvent.click(screen.getByTestId("credential-mode-query"));
    await userEvent.click(await screen.findByRole("option", { name: "复用其他用途凭据" }));
    await userEvent.click(screen.getByTestId("credential-reuse-query"));
    await userEvent.click(await screen.findByRole("option", { name: "复用Review的已存凭据" }));
    await userEvent.type(screen.getByTestId("credential-username-query"), "query_ro");
    // The reuse-mode risk copy is visible on the row now in reuse mode.
    expect(screen.getByText(/最小权限风险/)).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("ds-version-constraint"), ">=8.0");
    await userEvent.click(screen.getByTestId("ds-submit"));
    await waitFor(() => { expect(captured.body).not.toBeNull(); });
    const credentials = captured.body?.credentials as Array<Record<string, unknown>>;
    const review = credentials.find((credential) => credential.purpose === "review");
    expect(review).toMatchObject({ username: "review_ro", password: { value: "fresh-secret-1" } });
    expect("reuse_credential_purpose" in (review ?? {})).toBe(false);
    const query = credentials.find((credential) => credential.purpose === "query");
    expect(query).toMatchObject({ username: "query_ro", reuse_credential_purpose: "review" });
    expect("password" in (query ?? {})).toBe(false);
    const execution = credentials.find((credential) => credential.purpose === "execution");
    expect(execution).toMatchObject({ reuse_credential_purpose: "execution" });
    expect("username" in (execution ?? {})).toBe(false);
    mysql.unmount();
  });
});
