import { Outlet } from "react-router";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { YearningSidebar } from "@/app/shell/yearning-sidebar";
import { AppHeader } from "@/app/shell/app-header";
import { AppFooter } from "@/app/shell/app-footer";

/**
 * Logged-in shell, independently written against the frozen template's
 * FullLayout structure: inset sidebar, sticky header, centered content
 * container with the page outlet, and the single global footer. The template
 * marketing widgets (upgrade card, external help links, demo banner content)
 * are excluded; the announcement banner joins when a real announcements
 * source is wired.
 */
export function FullLayout() {
  return (
    <SidebarProvider
      defaultOpen={true}
      style={{ "--sidebar-width-icon": "52px" } as React.CSSProperties}
    >
      <YearningSidebar />
      {/* Owner ruling 2026-09-02: the nav stays put and only the body scrolls —
          the inset is capped to the viewport and the content column scrolls
          internally, so the sidebar and the nav can never drift out of
          alignment. */}
      <SidebarInset className="m-2 h-[calc(100svh-1rem)] overflow-hidden rounded-xl! outline outline-border">
        <AppHeader />
        {/* Fill chain (owner ruling 2026-10-20): the column below the nav is
            a definite-height scroll container, so min-h-full resolves exactly
            and every page can stretch its content to the footer — the old
            min-h-[calc(100vh-140px)] approximation left dead space on tall
            windows and floated the footer up on short ones. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="container mx-auto flex min-h-full w-full flex-col">
            <div className="flex flex-1 flex-col">
              <Outlet />
            </div>
            <AppFooter />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
