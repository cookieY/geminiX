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
          alignment.
          Owner ruling 2026-10-23: the shell is flush with the viewport — the
          floating canvas (8px margin, rounded corners, hairline outline) is
          gone, so the header bar and the sidebar meet the page edges. */}
      <SidebarInset className="bg-background h-svh overflow-hidden md:peer-data-[variant=inset]:m-0!">
        <AppHeader />
        {/* Fill chain (owner ruling 2026-10-20): the column below the nav is
            a definite-height scroll container, so min-h-full resolves exactly
            and every page can stretch its content to the footer — the old
            min-h-[calc(100vh-140px)] approximation left dead space on tall
            windows and floated the footer up on short ones. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* One measure for the whole shell (owner report 2026-10-23: the
              banner used to be wider than every row below it on wide screens).
              The header card uses the same 1536px measure, so both edges line
              up from 1440 through ultrawide instead of the body being capped
              while the bar kept spanning the full inset. */}
          <div className="mx-auto flex min-h-full w-full max-w-[1536px] flex-col">
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
