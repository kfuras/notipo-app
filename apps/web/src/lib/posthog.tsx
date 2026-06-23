"use client";

import posthog from "posthog-js";

/**
 * Initialization lives in `apps/web/src/instrumentation-client.ts` (the
 * canonical Next.js App Router pattern). This file only exposes helpers
 * used by event-capture sites across the app, plus a no-op
 * PostHogProvider for backwards compatibility with existing imports.
 */

const IMPERSONATION_KEY = "notipo_impersonating";

/** True if the current admin session is impersonating another tenant.
 *  Reads sessionStorage directly so the check works in any capture site
 *  without needing the React auth-context hook. */
function isImpersonating(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(sessionStorage.getItem(IMPERSONATION_KEY));
  } catch {
    return false;
  }
}

/** Called by auth-context when an admin starts impersonating a tenant.
 *  Opts the browser out of capture so the admin's testing activity does
 *  not pollute the impersonated tenant's funnel data. */
export function pausePostHogForImpersonation() {
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.opt_out_capturing();
  }
}

/** Called by auth-context when impersonation ends. */
export function resumePostHogAfterImpersonation() {
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.opt_in_capturing();
  }
}

/** Fire-and-forget event capture. No-ops if PostHog is not initialized,
 *  or if the admin is currently impersonating another tenant. */
export function capture(event: string, properties?: Record<string, unknown>) {
  if (
    typeof window !== "undefined" &&
    posthog.__loaded &&
    !isImpersonating()
  ) {
    posthog.capture(event, properties);
  }
}

/** Identify a user (call after login/register). */
export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
) {
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.identify(distinctId, properties);
  }
}

/** Reset identity on logout. */
export function resetUser() {
  if (typeof window !== "undefined" && posthog.__loaded) {
    posthog.reset();
  }
}

/**
 * Backwards-compatible no-op wrapper. The real init now happens in
 * instrumentation-client.ts. layout.tsx still imports this name, so we keep
 * it as a pass-through to avoid a wide refactor.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
