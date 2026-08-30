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
} from "@/shared/components/ui/sidebar";
import { filterNavGroups, NAV_GROUPS, type NavGroup } from "./nav-model";
import { PLACEHOLDER_SESSION_USER } from "@/shared/session/session";
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

/**
 * Yearning sidebar, independently written against the frozen template's
 * vertical sidebar (variant="inset", collapsible="icon", hover expansion via
 * the data-sidebar-type mechanism in global.css). Groups and entries follow
 * the §5.1 navigation baseline; the "AI" group is deliberately absent — v4
 * has no chat shell.
 */
export function YearningSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const groups = filterNavGroups(NAV_GROUPS, PLACEHOLDER_SESSION_USER.role);
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
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroupSection key={group.labelKey} group={group} />
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
