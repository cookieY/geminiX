import { useTranslation } from "react-i18next";
import { SidebarTrigger } from "@/shared/components/ui/sidebar";
import { Separator } from "@/shared/components/ui/separator";
import { BrandLogo } from "./brand-logo";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

/**
 * Shell header following the frozen template's vertical header: sticky bar,
 * sidebar toggle on the left, global actions on the right. Template demo
 * widgets (menu search, notifications dropdown) are excluded — the header
 * carries only global context and global actions (spec §5).
 */
export function AppHeader() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <nav aria-label={t("shell.headerNav")} className="mx-auto flex flex-wrap items-center justify-between p-2">
        <div className="flex items-center gap-2">
          <div className="block lg:hidden">
            <BrandLogo />
          </div>
          <SidebarTrigger
            className="btn-circle-hover"
            aria-label={t("shell.toggleSidebar")}
          />
          <Separator
            orientation="vertical"
            className="mr-4 ml-2 h-4 w-px self-center bg-border max-lg:hidden"
          />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      </nav>
    </header>
  );
}
