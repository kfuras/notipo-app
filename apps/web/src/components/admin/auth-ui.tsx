"use client";

import { type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Shared shell for the auth pages (login / signup) — a centered dark card with
 * a wordmark above and a small footer below. The surrounding
 * page already applies the `dark` theme + background.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <span className="mb-8 text-2xl font-semibold tracking-tight text-foreground">
        Notipo<span className="text-accent-purple">.</span>
      </span>

      <main className="w-full max-w-sm rounded-xl border bg-card p-8">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </header>
          {children}
        </div>
      </main>

      <p className="mt-8 text-xs text-muted-foreground">{footer}</p>
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className="flex-1 h-px bg-border" />
      or
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

/** Google sign-in button — full-page redirect handled by better-auth. */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const { loginWithGoogle } = useAuth();

  return (
    <button
      type="button"
      onClick={() => loginWithGoogle()}
      className="w-full inline-flex items-center justify-center gap-2.5 rounded-md border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.568 2.684-3.875 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
        <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
      </svg>
      {label}
    </button>
  );
}
