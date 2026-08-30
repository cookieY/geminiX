/**
 * The single global footer of the logged-in shell. The exact string is fixed
 * by docs/contracts/frontend-ui-migration-contract.md §1 and is license text,
 * so it is intentionally not translated.
 */
export const FOOTER_TEXT = "AGPL-3.0 Licensed | Copyright © 2017-present Henry Yee";

export function AppFooter() {
  return (
    <footer className="pt-6">
      <div className="flex flex-col items-center justify-between gap-3 text-center md:flex-row">
        <p className="text-sm text-muted-foreground">{FOOTER_TEXT}</p>
      </div>
    </footer>
  );
}
