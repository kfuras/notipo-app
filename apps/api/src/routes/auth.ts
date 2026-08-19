import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/**
 * Human/web auth — register, login, email verification, password reset, and
 * Google sign-in — is served by better-auth under `/api/auth/*`
 * (see plugins/better-auth.ts). This file keeps only the small capability
 * endpoint the web reads before rendering the login form.
 *
 * The static route `/api/auth/providers` takes routing precedence over
 * better-auth's `/api/auth/*` wildcard in find-my-way (static > wildcard), so
 * it resolves here and not through the better-auth handler.
 */
export async function authRoutes(app: FastifyInstance) {
  /** GET /api/auth/providers — which auth methods the UI should offer */
  app.get("/api/auth/providers", async () => {
    let signup = config.ALLOW_SIGNUP;
    // Always allow signup if no blogs exist yet (first-run setup).
    if (!signup) {
      const tenantCount = await app.prisma.tenant.count();
      if (tenantCount === 0) signup = true;
    }
    return {
      data: {
        password: true,
        google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
        signup,
      },
    };
  });
}
