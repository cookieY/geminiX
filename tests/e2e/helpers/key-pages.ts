import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * FE-F11 six key page types (yearning-ui-design-spec.md §7.1–§7.6): the
 * canonical definition shared by the screenshot baseline and the WCAG audit.
 * Each entry drives the real page into its informative state — the precheck
 * workspace waits for a terminal review, the query workspace has actually
 * executed a SELECT — never a skeleton or an empty shell, so both quality
 * gates judge the pages users actually work in.
 */
export interface KeyPageType {
  /** Short name used in file names and test titles. */
  name: string;
  /** Mock scenario; null keeps the default world. */
  scenario: string | null;
  /** Session identity the page requires. */
  session: "default" | "admin";
  /** Navigates and drives the page into its informative state. */
  prepare: (page: Page) => Promise<void>;
}

const FIXTURE_FLOW_ID = "4f6f1a2b-0000-4000-8000-000000000001";
export const SEEDED_EXECUTION_ORDER = "/changes/orders/7e6f1a2b-0000-4000-8000-00000000f801";

/** Types SQL through the real Monaco surface (precheck.spec precedent). */
async function typeSql(page: Page, testid: string, sql: string): Promise<void> {
  await page.getByTestId(testid).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(sql);
}

export const KEY_PAGE_TYPES: KeyPageType[] = [
  {
    name: "dashboard",
    scenario: "query-session",
    session: "default",
    prepare: async (page) => {
      await page.goto("/workspace");
      await expect(page.getByTestId("workspace-dashboard-cards")).toBeVisible();
      await expect(page.getByTestId("workspace-announcement")).toBeVisible();
    },
  },
  {
    // The seeded execution order (submitter = the default session user)
    // only exists in the execution-domain scenarios.
    name: "list",
    scenario: "execution-partial",
    session: "default",
    prepare: async (page) => {
      await page.goto("/changes/mine");
      await expect(page.getByTestId("mine-order-row").first()).toBeVisible();
    },
  },
  {
    name: "detail",
    scenario: "execution-partial",
    session: "default",
    prepare: async (page) => {
      await page.goto(SEEDED_EXECUTION_ORDER);
      await expect(page.getByTestId("order-detail-page")).toBeVisible();
      // The seeded order waits in execution_pending: the executor action
      // card with the approved SQL hash is its informative state (the
      // attempt card only exists once an execution has been started).
      await expect(page.getByTestId("execution-action-card")).toBeVisible({
        timeout: 8_000,
      });
    },
  },
  {
    name: "precheck",
    scenario: "review-ready",
    session: "admin",
    prepare: async (page) => {
      await page.goto("/changes/new");
      await expect(page.getByTestId("changes-new-page")).toBeVisible();
      await page.getByTestId(`use-flow-${FIXTURE_FLOW_ID}`).click();
      await page.getByTestId("create-draft-dialog").getByRole("textbox").first().fill("视觉基线草稿");
      await page.getByTestId("create-draft-confirm").click();
      await expect(page).toHaveURL(/\/changes\/drafts\//);
      await typeSql(page, "sql-editor", "UPDATE orders SET status = 1 WHERE user_id = 42;");
      await page.getByTestId("save-sql").click();
      await expect(page.getByTestId("save-sql")).toBeDisabled();
      await page.getByTestId("run-review").click();
      // The submit dock unlocks exactly when the terminal Ready state lands —
      // a locale-neutral terminal signal (fixture timeline ≈1.3s).
      await expect(page.getByTestId("submit-draft")).toBeEnabled({ timeout: 10_000 });
    },
  },
  {
    name: "query",
    scenario: "query-session",
    session: "default",
    prepare: async (page) => {
      await page.goto("/query/sessions/qs-fixture-active");
      await expect(page.getByTestId("query-workspace")).toBeVisible();
      await page.getByTestId("query-schema-input").fill("app");
      await typeSql(page, "query-sql-editor", "select id, email from app.users");
      await page.getByTestId("query-run").click();
      await expect(page.locator("[data-testid^='query-result-loaded-']").first()).toBeVisible({
        timeout: 10_000,
      });
    },
  },
  {
    name: "admin",
    scenario: null,
    session: "admin",
    prepare: async (page) => {
      await page.goto("/admin/datasources");
      await expect(page.getByTestId(/ds-row-/).first()).toBeVisible();
    },
  },
];
