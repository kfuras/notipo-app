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

const tenantNavItems = [
  { title: "Home", href: "/admin", icon: LayoutDashboard },
  { title: "Posts", href: "/admin/posts", icon: FileText },
  { title: "Categories", href: "/admin/categories", icon: FolderTree },
  { title: "Jobs", href: "/admin/jobs", icon: Activity },
  { title: "Import", href: "/admin/import", icon: Download },
  { title: "Settings", href: "/admin/settings", icon: Settings },
  { title: "Billing", href: "/admin/billing", icon: CreditCard },
  { title: "Account", href: "/admin/account", icon: UserCog },
];

const adminItem = { title: "Tenants", href: "/admin/tenants", icon: Users };

export function BottomNav() {
  const pathname = usePathname();
  const { isAdmin, impersonating, logout } = useAuth();

  // Admin without impersonation: only show Tenants
  const items = isAdmin && !impersonating
    ? [adminItem]
    : isAdmin && impersonating
      ? [...tenantNavItems, adminItem]
      : tenantNavItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] ${
                active
                  ? "text-primary font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.title}</span>
            </Link>
          );
        })}
        <button
          onClick={logout}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] text-muted-foreground"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
}
