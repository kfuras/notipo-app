"use client";

import {
  LayoutDashboard,
  FileText,
  FolderTree,
  Activity,
  Settings,
  CreditCard,
  UserCog,
  Users,
  LogOut,
  Download,
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { LogoIcon } from "@/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const tenantNavItems = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { title: "Posts", href: "/admin/posts", icon: FileText },
  { title: "Categories", href: "/admin/categories", icon: FolderTree },
  { title: "Jobs", href: "/admin/jobs", icon: Activity },
  { title: "Import", href: "/admin/import", icon: Download },
  { title: "Settings", href: "/admin/settings", icon: Settings },
  { title: "Billing", href: "/admin/billing", icon: CreditCard },
  { title: "Account", href: "/admin/account", icon: UserCog },
];

const adminItems = [
  { title: "Tenants", href: "/admin/tenants", icon: Users },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { email, isAdmin, impersonating, logout } = useAuth();

  // Admin without impersonation: only show admin items
  const showTenantNav = !isAdmin || impersonating;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href={isAdmin && !impersonating ? "/admin/tenants" : "/admin"} className="flex items-center gap-2">
          <LogoIcon className="w-7 h-7" id="sidebar" />
          <span className="font-semibold text-lg">Notipo</span>
        </Link>
        {impersonating && (
          <p className="text-xs text-amber-400 mt-1 truncate">
            Viewing: {impersonating.tenantName}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        {showTenantNav && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {tenantNavItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.href === "/admin"
                          ? pathname === "/admin"
                          : pathname.startsWith(item.href)
                      }
                    >
                      <Link href={item.href}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4">
        {email && (
          <p className="text-xs text-muted-foreground truncate mb-2">
            {email}
          </p>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout}>
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
