import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

interface TenantContext {
  id: string;
  slug: string;
}

interface UserContext {
  id: string;
  email: string;
  role: string;
}

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
    user: UserContext;
    isAdmin: boolean;
  }
}

async function auth(app: FastifyInstance) {
  app.decorateRequest("tenant", null as unknown as TenantContext);
  app.decorateRequest("user", null as unknown as UserContext);
  app.decorateRequest("isAdmin", false);

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Skip auth for health check, Notion webhook (uses HMAC signature), OAuth callback, auth routes, and static uploads
    if (request.url === "/health" || request.url === "/favicon.ico" || request.url === "/api/notion/webhook" || request.url === "/api/billing/webhook" || request.url.startsWith("/api/notion/oauth/callback") || request.url.startsWith("/api/auth/") || request.url.startsWith("/api/uploads/") || request.url.startsWith("/api/default-category-images/")) return;

    // Accept x-api-key header or ?token= query param (needed for EventSource SSE)
    const apiKey =
      (request.headers["x-api-key"] as string | undefined) ||
      (request.query as Record<string, string>)["token"];
    if (!apiKey) {
      return reply.unauthorized("Missing x-api-key header");
    }

    // Admin API key — supports both /api/admin/* and tenant impersonation
    const isAdminKey =
      apiKey.length === config.API_KEY.length &&
      timingSafeEqual(Buffer.from(apiKey), Buffer.from(config.API_KEY));
    if (isAdminKey) {
      request.isAdmin = true;

      // Pure admin routes — no tenant context needed
      if (request.url.startsWith("/api/admin")) {
        return;
      }

      // Impersonation: admin can access tenant routes via X-Impersonate-Tenant header or query param
      const impersonateTenantId =
        (request.headers["x-impersonate-tenant"] as string | undefined) ||
        (request.query as Record<string, string>)["impersonateTenant"];

      if (!impersonateTenantId) {
        return reply.unauthorized("Admin key requires X-Impersonate-Tenant header for tenant routes");
      }

      const tenant = await app.prisma.tenant.findUnique({
        where: { id: impersonateTenantId },
        select: { id: true, slug: true },
      });

      if (!tenant) {
        return reply.notFound("Tenant not found");
      }

      request.tenant = tenant;
      request.user = { id: "admin", email: "admin", role: "ADMIN" };
      return;
    }

    // Non-admin admin routes — reject
    if (request.url.startsWith("/api/admin")) {
      return reply.unauthorized("Invalid admin API key");
    }

    // All other routes: look up user by API key in the DB
    const user = await app.prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, email: true, role: true, tenant: { select: { id: true, slug: true } } },
    });

    if (!user) {
      return reply.unauthorized("Invalid API key");
    }

    request.tenant = user.tenant;
    request.user = { id: user.id, email: user.email, role: user.role };
  });
}

export const authPlugin = fp(auth, {
  name: "auth",
  dependencies: ["prisma"],
});
