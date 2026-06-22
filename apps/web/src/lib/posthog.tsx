"use client";

import posthog from "posthog-js";

/**
 * Initialization lives in `apps/web/src/instrumentation-client.ts` (the
 * canonical Next.js App Router pattern). This file only exposes helpers
 * used by event-capture sites across the app, plus a no-op
 * PostHogProvider for backwards compatibility with existing imports.
 */

/** Fire-and-forget event capture. No-ops if PostHog is not initialized. */
export function capture(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== "undefined" && posthog.__loaded) {
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
