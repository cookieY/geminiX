// S008 FE（AI Provider 生成参数与参考计价）acceptance over the mock world:
//   1. 三分组导航 — 连接配置/生成参数/参考计价 tab 切换（界面-01）；
//   2. 参数回填 — 已存值优先（medium/0.7），未配置=服务商默认占位；
//   3. 固定参考声明常驻 — 参考计价组渲染成本声明文本（界面-02）。
// 渲染文本级断言（键存在性不算数）。
import { expect, test } from "@playwright/test";
import { mockSession } from "./helpers/auth";

test.describe("provider genparams & pricing (@provider-genparams)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("yearning-locale", "zh-CN");
    });
    await mockSession(page, "admin");
    await page.goto("/admin/review-engine/providers");
    await expect(page.getByTestId(/^provider-row-/).first()).toBeVisible();
    await page.getByTestId(/^provider-actions-/).first().click();
    await page.getByTestId(/^provider-edit-/).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("three-group navigation and stored-params backfill @provider-genparams", async ({ page }) => {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // 三分组导航。
    for (const tab of ["provider-tab-connection", "provider-tab-generation", "provider-tab-pricing"]) {
      await expect(dialog.getByTestId(tab)).toBeVisible();
    }
    // 生成参数回填：已存值优先（fixture primary: medium / 0.7），未配置=默认占位。
    await dialog.getByTestId("provider-tab-generation").click();
    await expect(dialog.getByTestId("provider-gen-reasoning")).toContainText("medium");
    await expect(dialog.getByTestId("provider-gen-max-tokens")).toHaveValue("");
    await expect(dialog.getByTestId("provider-gen-max-tokens")).toHaveAttribute(
      "placeholder",
      "服务商默认",
    );
    await expect(dialog.getByTestId("provider-gen-temperature")).toHaveValue("0.7");
    // 常驻提示（含 temperature=0 显式零语义）。
    await expect(dialog.getByText(/temperature 填 0 是显式取值/)).toBeVisible();
  });

  test("pricing tab keeps the standing reference declaration @provider-genparams", async ({ page }) => {
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("provider-tab-pricing").click();
    // 界面-02：声明常驻且为渲染文本（非键存在性）。
    await expect(dialog.getByText(/均为参考成本估算/)).toBeVisible();
    await expect(dialog.getByText(/不构成账单或实际扣款/)).toBeVisible();
    // 用量面声明 + 明细表（fixture两行：一行完整、一行未返回）。
    await expect(dialog.getByText(/缺失字段显示「未返回\/未计算」/)).toBeVisible();
    await expect(dialog.getByText(/运行AI预审后每次HTTP调用|调用明细/).first()).toBeVisible();
    await expect(dialog.getByTestId("provider-usage-panel")).toBeVisible();
  });
});
