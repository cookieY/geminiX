import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/shared/components/ui/sidebar";
import { filterNavGroups, NAV_GROUPS, type NavGroup } from "./nav-model";
import { sessionRoleFromCurrentUser } from "@/shared/session/session";
import { useSession } from "@/features/auth/session-provider";
import { useLatestReleaseQuery } from "@/routes/workspace/workspace-release-banner";
import { BrandLogo } from "./brand-logo";

function SidebarGroupSection({ group }: { group: NavGroup }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                render={<Link to={item.to} />}
                isActive={pathname === item.to}
                tooltip={t(item.labelKey)}
              >
                <item.icon />
                {/* hide-menu lets the icon-mode hover expansion re-show the label */}
                <span className="hide-menu">{t(item.labelKey)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Reference-image "V.1.0" badge (owner ruling 2026-09-02): the currently
 * tracked release tag beside the logo, visible only in the expanded state.
 * Shares the release banner's query (10-minute stale time) — hidden until
 * the tag resolves. */
function ReleaseVersionBadge() {
  const release = useLatestReleaseQuery(true);
  if (release.data === undefined) return null;
  return (
    <span
      data-testid="sidebar-version-badge"
      className="group-data-[state=collapsed]:hidden rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-foreground"
    >
      {release.data.tag_name}
    </span>
  );
}

/**
 * Hover expansion for the collapsed icon rail (owner ruling 2026-09-02,
 * matching the frozen template's behavior): entering the collapsed rail
 * REALLY expands the sidebar — a CSS-only width fight against the collapsed
 * size utilities' !important inside Tailwind's layer is unwinnable — and
 * leaving the expanded menu collapses it back, but only when the expansion
 * was hover-initiated.
 */
function SidebarHoverEffects() {
  const { setOpen } = useSidebar();
  const hoverOpenedRef = useRef(false);
  useEffect(() => {
    const container = document.querySelector("[data-slot='sidebar-container']");
    if (!container) return undefined;
    const enter = () => {
      if (container.closest("[data-collapsible='icon']")) {
        hoverOpenedRef.current = true;
        setOpen(true);
      }
    };
    const leave = () => {
      if (hoverOpenedRef.current) {
        hoverOpenedRef.current = false;
        setOpen(false);
      }
    };
    container.addEventListener("mouseenter", enter);
    container.addEventListener("mouseleave", leave);
    return () => {
      container.removeEventListener("mouseenter", enter);
      container.removeEventListener("mouseleave", leave);
    };
  }, [setOpen]);
  return null;
}

/**
 * Yearning sidebar, independently written against the frozen template's
 * vertical sidebar (variant="inset", collapsible="icon", hover expansion via
 * the data-sidebar-type mechanism in global.css). Groups and entries follow
 * the §5.1 navigation baseline; the "AI" group is deliberately absent — v4
 * has no chat shell.
 */
export function YearningSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { user } = useSession();
  const groups = filterNavGroups(NAV_GROUPS, sessionRoleFromCurrentUser(user));
  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      side="left"
      className="sidebar-box **:data-[slot=sidebar-inner]:bg-background **:data-[slot=sidebar-inner]:border **:data-[slot=sidebar-inner]:border-border group-data-[state=collapsed]:hover:shadow-xl"
      {...props}
    >
      <SidebarHeader className="flex flex-row items-center justify-between border-b border-border p-3 group-data-[state=collapsed]:px-2.5">
        <BrandLogo />
        <ReleaseVersionBadge />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroupSection key={group.labelKey} group={group} />
        ))}
      </SidebarContent>
      <SidebarHoverEffects />
    </Sidebar>
  );
}
