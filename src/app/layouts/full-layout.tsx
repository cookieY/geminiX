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
      <SidebarInset className="m-2 overflow-hidden rounded-none! outline outline-border">
        <AppHeader />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="container mx-auto w-full">
            <div className="min-h-[calc(100vh-140px)]">
              <Outlet />
            </div>
            <AppFooter />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
