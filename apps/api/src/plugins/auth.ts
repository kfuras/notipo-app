import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { auth } from "../lib/auth.js";

interface TenantContext {
  id: string;
  slug: string;
}

interface UserContext {
  id: string;
  email: string;
  role: string;
}

type AuthMethod = "session" | "apiKey" | "admin" | null;

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
    user: UserContext;
    isAdmin: boolean;
    authMethod: AuthMethod;
  }
}

/** Convert Fastify's header object to a Web `Headers` for better-auth. */
function toHeaders(raw: FastifyRequest["headers"]): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else if (v != null) h.set(k, String(v));
  }
  return h;
}

/**
 * Guard for routes that must be a browser session (e.g. billing, API-key
 * management) and must NOT be reachable with a programmatic API key.
 * Call at the top of the route handler.
 */
export function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authMethod !== "session" && request.authMethod !== "admin") {
    reply.forbidden("This action requires a logged-in session");
    return false;
  }
  return true;
}

async function authHook(app: FastifyInstance) {
  app.decorateRequest("tenant", null as unknown as TenantContext);
  app.decorateRequest("user", null as unknown as UserContext);
  app.decorateRequest("isAdmin", false);
  app.decorateRequest("authMethod", null as AuthMethod);

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Exempt: health, webhooks (HMAC/Stripe-signed), OAuth callback, better-auth
    // routes (handled by the better-auth plugin), public assets, MCP (own auth).
    if (
      request.url === "/health" ||
      request.url === "/favicon.ico" ||
      request.url === "/api/notion/webhook" ||
      request.url === "/api/billing/webhook" ||
      request.url.startsWith("/api/notion/oauth/callback") ||
      request.url.startsWith("/api/auth/") ||
      request.url.startsWith("/api/default-category-images/") ||
      request.url === "/api/mcp"
    )
      return;

    const apiKey =
      (request.headers["x-api-key"] as string | undefined) ||
      (request.query as Record<string, string>)["token"];

    // ── 1. Admin key ──────────────────────────────────────────────────────────
    if (
      apiKey &&
      apiKey.length === config.API_KEY.length &&
      timingSafeEqual(Buffer.from(apiKey), Buffer.from(config.API_KEY))
    ) {
      request.isAdmin = true;
      request.authMethod = "admin";
      if (request.url.startsWith("/api/admin")) return;

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
      if (!tenant) return reply.notFound("Tenant not found");
      request.tenant = tenant;
      request.user = { id: "admin", email: "admin", role: "ADMIN" };
      return;
    }

    // Non-admin admin routes — reject before any DB/session work.
    if (request.url.startsWith("/api/admin")) {
      return reply.unauthorized("Invalid admin API key");
    }

    // ── 2. Session (web/human) ────────────────────────────────────────────────
    // Cookie-based; only present for browser requests. Errors (e.g. better-auth
    // not configured) fall through to the API-key path.
    const session = await auth.api
      .getSession({ headers: toHeaders(request.headers) })
      .catch(() => null);
    if (session?.user) {
      const activeOrgId = (session.session as { activeOrganizationId?: string | null })
        .activeOrganizationId;
      let member = activeOrgId
        ? await app.prisma.member.findFirst({
            where: { userId: session.user.id, organizationId: activeOrgId },
            select: { role: true, tenant: { select: { id: true, slug: true } } },
          })
        : null;
      if (!member) {
        member = await app.prisma.member.findFirst({
          where: { userId: session.user.id },
          orderBy: { createdAt: "asc" },
          select: { role: true, tenant: { select: { id: true, slug: true } } },
        });
      }
      if (!member) return reply.unauthorized("No blog is set up for this account");
      request.tenant = member.tenant;
      request.user = { id: session.user.id, email: session.user.email, role: member.role };
      request.authMethod = "session";
      return;
    }

    // ── 3. API key (CLI / MCP / programmatic) ─────────────────────────────────
    if (!apiKey) {
      return reply.unauthorized("Missing session cookie or x-api-key");
    }

    // New per-blog ApiKey table.
    const ak = await app.prisma.apiKey.findUnique({
      where: { key: apiKey },
      select: { userId: true, tenant: { select: { id: true, slug: true } } },
    });
    if (ak) {
      request.tenant = ak.tenant;
      request.user = { id: ak.userId, email: "", role: "OWNER" };
      request.authMethod = "apiKey";
      // fire-and-forget usage stamp
      app.prisma.apiKey.update({ where: { key: apiKey }, data: { lastUsedAt: new Date() } }).catch(() => {});
      return;
    }

    // Legacy fallback: keys still on the old per-tenant users table (pre-migration).
    const user = await app.prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, email: true, role: true, tenant: { select: { id: true, slug: true } } },
    });
    if (user) {
      request.tenant = user.tenant;
      request.user = { id: user.id, email: user.email, role: user.role };
      request.authMethod = "apiKey";
      return;
    }

    return reply.unauthorized("Invalid API key");
  });
}

export const authPlugin = fp(authHook, {
  name: "auth",
  dependencies: ["prisma", "better-auth"],
});
