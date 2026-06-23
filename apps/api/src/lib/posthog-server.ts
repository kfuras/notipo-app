import { PostHog } from "posthog-node";

/**
 * Singleton PostHog client for server-side event capture from API routes,
 * webhooks, and background jobs. Mirrors Klarbud's pattern.
 *
 * Key conventions for callers:
 * - distinctId should be the stable internal user.id (NOT email), so events
 *   correlate across login sessions and email changes.
 * - For tenant-level events with no specific user (Stripe webhook, MCP),
 *   use the tenant.id as distinctId and add `is_tenant_event: true`.
 * - Always include `$set` or property properties — server events without
 *   identifying context are hard to query later.
 */

let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_API_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com",
      // flushAt:1 = fire each event immediately. flushInterval:0 = no batching.
      // For high-volume endpoints, raise flushAt to 20 and flushInterval to 10000ms.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

/** Fire-and-forget server-side capture. No-ops if PostHog is not configured.
 *  Pass `isImpersonated: request.isAdmin` from authenticated routes so
 *  admin-impersonation traffic (Kjetil testing a tenant's account) does
 *  not pollute the real tenant's funnel. */
export function captureServer(args: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  isImpersonated?: boolean;
}) {
  if (args.isImpersonated) return;
  const ph = getPostHogServer();
  if (!ph) return;
  ph.capture({
    distinctId: args.distinctId,
    event: args.event,
    properties: args.properties,
  });
}

/** Identify a user from the server (login, register, webhook upgrades). */
export function identifyServer(args: {
  distinctId: string;
  properties?: Record<string, unknown>;
}) {
  const ph = getPostHogServer();
  if (!ph) return;
  ph.identify({
    distinctId: args.distinctId,
    properties: args.properties,
  });
}

/**
 * Call on graceful shutdown (signal handlers in plugins/queue.ts) to flush
 * pending events. Without this, the last few server events can be lost on
 * Cloud Run scale-to-zero.
 */
export async function shutdownPostHogServer(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
