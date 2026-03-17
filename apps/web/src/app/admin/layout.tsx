"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import posthog from "posthog-js";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { useApi } from "@/hooks/use-api";
import { AppSidebar } from "@/components/admin/app-sidebar";
import { BottomNav } from "@/components/admin/bottom-nav";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "sonner";
import { X } from "lucide-react";

function ImpersonationBanner() {
  const { impersonating, stopImpersonating } = useAuth();
  const router = useRouter();

  if (!impersonating) return null;

  function exit() {
    stopImpersonating();
    router.push("/admin/tenants");
  }

  return (
    <div className="bg-amber-600 text-white text-sm px-4 py-2 flex items-center justify-between">
      <span>
        Viewing as <strong>{impersonating.tenantName}</strong>
      </span>
      <button
        onClick={exit}
        className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-amber-700 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
        Exit
      </button>
    </div>
  );
}

/** Enrich PostHog person properties once per session */
function PostHogEnrich() {
  const enriched = useRef(false);
  const { impersonating } = useAuth();
  const { data } = useApi<{
    data: { email: string; role: string; tenant: { name: string; plan: string } };
  }>("/api/account");

  useEffect(() => {
    if (!data?.data || enriched.current || !posthog.__loaded || impersonating) return;
    enriched.current = true;
    const a = data.data;
    posthog.identify(a.email, {
      email: a.email,
      role: a.role,
      tenant: a.tenant.name,
      plan: a.tenant.plan,
    });
  }, [data, impersonating]);

  return null;
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const { apiKey, isLoading, isAdmin, impersonating } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !apiKey) {
      router.replace("/auth/login");
    }
  }, [apiKey, isLoading, router]);

  // Admin without impersonation: redirect to tenants page (tenant routes won't work)
  useEffect(() => {
    if (!isLoading && isAdmin && !impersonating && !pathname.startsWith("/admin/tenants")) {
      router.replace("/admin/tenants");
    }
  }, [isLoading, isAdmin, impersonating, pathname, router]);

  if (isLoading || !apiKey) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <ImpersonationBanner />
        <header className="hidden md:flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</main>
      </SidebarInset>
      <BottomNav />
      <Toaster theme="dark" position="top-center" />
    </SidebarProvider>
  );
}

/** Sets html/body background + theme-color so phone safe areas match the dark theme */
function SetDarkMeta() {
  useEffect(() => {
    const bg = "#0a0a0a"; // oklch(0.145 0 0) ≈ dark --background
    document.documentElement.classList.add("dark");
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;

    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = bg;

    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      if (meta) meta.content = "";
    };
  }, []);
  return null;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark bg-background text-foreground min-h-screen">
      <meta name="robots" content="noindex, nofollow" />
      <SetDarkMeta />
      <AuthProvider>
        <PostHogEnrich />
        <AdminShell>{children}</AdminShell>
      </AuthProvider>
    </div>
  );
}
