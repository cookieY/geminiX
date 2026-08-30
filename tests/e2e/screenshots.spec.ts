import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// FE-F2 screenshot baseline (yearning-ui-design-spec.md §13): the real React
// shell captured at 1440px, 1280px, 1024px and narrow width, in zh-CN and
// en-US, light and dark. Files land in tests/screenshots/ and are committed
// as the stable visual baseline for owner review.
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
] as const;
const LOCALES = ["zh-CN", "en-US"] as const;
const THEMES = ["light", "dark"] as const;

async function prepare(page: Page, locale: string, theme: string) {
  await page.addInitScript(
    `window.localStorage.setItem('yearning-locale', '${locale}');` +
      `window.localStorage.setItem('vite-ui-theme', '${theme}');`,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
}

const READY_TEXT: Record<(typeof LOCALES)[number], string> = {
  "zh-CN": "工作台内容尚未交付",
  "en-US": "Workspace content is not delivered yet",
};

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`shell baseline ${viewport.name} ${locale} ${theme}`, async ({ page }) => {
        await prepare(page, locale, theme);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/workspace");
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByText(READY_TEXT[locale])).toBeVisible();
        await page.waitForTimeout(150);
        await page.screenshot({
          path: `tests/screenshots/shell-${viewport.name}-${locale}-${theme}.png`,
          fullPage: true,
        });
      });

      test(`login baseline ${viewport.name === "1440" ? "desktop" : viewport.name} ${locale} ${theme}`, async ({
        page,
      }) => {
        test.skip(viewport.name !== "1440", "login captures use the desktop viewport");
        await prepare(page, locale, theme);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/login");
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByText(/登录 Yearning|Sign in to Yearning/)).toBeVisible();
        await page.waitForTimeout(150);
        await page.screenshot({
          path: `tests/screenshots/login-${locale}-${theme}.png`,
          fullPage: true,
        });
      });
    }
  }
}
