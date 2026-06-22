import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    // NOTE: this is a static export (output: "export" in next.config.ts) so
    // Next.js rewrites do not run in production. Use the direct EU host.
    // If you later add a Cloudflare Worker reverse proxy at /ingest, switch
    // api_host to "/ingest" and configure the Worker accordingly.
    api_host: "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}

// IMPORTANT: Never combine this approach with other client-side PostHog
// initialization. instrumentation-client.ts is the canonical entry point
// for Next.js 15.3+. The old PostHogProvider + useEffect init in
// src/lib/posthog.tsx has been removed; helpers (capture, identifyUser,
// resetUser) remain there.
