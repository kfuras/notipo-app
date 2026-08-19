import { createAuthClient } from "better-auth/react";
import { organizationClient, inferAdditionalFields } from "better-auth/client/plugins";

/**
 * better-auth client for human/web access. Programmatic access (CLI/MCP) keeps
 * the x-api-key model — see api-client.ts.
 *
 * baseURL: in prod the web is served same-origin as the API (app.notipo.com,
 * nginx proxies /api → Fastify), so we let better-auth default to
 * `window.location.origin` + `/api/auth`. In dev, NEXT_PUBLIC_API_URL points at
 * the API on another port, so we pass it explicitly.
 *
 * `inferAdditionalFields` is given the field config directly (not `<typeof auth>`)
 * to avoid importing the API package's server type into the web bundle.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export const authClient = createAuthClient({
  ...(API_BASE ? { baseURL: `${API_BASE}/api/auth` } : {}),
  plugins: [
    inferAdditionalFields({ user: { blogName: { type: "string" } } }),
    organizationClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
