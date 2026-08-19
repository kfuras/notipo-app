import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { deleteTenantFiles } from "../lib/storage.js";
import { getStripe, isStripeConfigured } from "../lib/stripe.js";
import { requireSession } from "../plugins/auth.js";

const log = logger.child({ route: "account" });

const authRateLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: "15 minutes" },
  },
};

export async function accountRoutes(app: FastifyInstance) {
  /**
   * GET /api/account — the logged-in user (global better-auth account) plus the
   * active blog. Password changes now go through better-auth (`/api/auth/*`);
   * the CLI/MCP key is read from `/api/settings/api-key`.
   */
  app.get("/api/account", async (request) => {
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { name: true, slug: true, plan: true, createdAt: true },
    });

    // Prefer the global better-auth user; fall back to the legacy per-tenant
    // user (a CLI key that hasn't been migrated off the old `users` table yet).
    const authUser = await app.prisma.authUser.findUnique({
      where: { id: request.user.id },
      select: { id: true, email: true, name: true, emailVerified: true, createdAt: true },
    });
    if (authUser) {
      return {
        data: {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name,
          role: request.user.role,
          isAdmin: request.isAdmin,
          emailVerified: authUser.emailVerified,
          createdAt: authUser.createdAt,
          tenant,
        },
      };
    }

    const legacy = await app.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return { data: legacy ? { ...legacy, isAdmin: request.isAdmin, tenant } : null };
  });

  /**
   * DELETE /api/account — delete the active blog and the owner's account.
   * Session-only (an API key cannot self-destruct the account). No password
   * re-check: the session is the proof of identity, and Google-only accounts
   * have no password to check.
   */
  app.delete("/api/account", authRateLimit, async (request, reply) => {
    if (!requireSession(request, reply)) return;
    // Never delete through an impersonated context, and only let a user delete a
    // blog they actually belong to — otherwise an admin impersonating a customer
    // (x-impersonate-tenant) would wipe the CUSTOMER's blog, and could even
    // cascade-delete their own authUser. request.tenant is the impersonated
    // tenant, so verify membership against the real session user.
    if (request.isAdmin || request.headers["x-impersonate-tenant"]) {
      return reply.badRequest("Cannot delete an account while impersonating");
    }
    const membership = await app.prisma.member.findFirst({
      where: { userId: request.user.id, organizationId: request.tenant.id },
      select: { id: true },
    });
    if (!membership) {
      return reply.forbidden("You are not a member of this blog");
    }

    // Cancel Stripe subscription if any (billing stays per-tenant in Phase 1).
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { stripeSubscriptionId: true },
    });
    if (tenant.stripeSubscriptionId && isStripeConfigured()) {
      try {
        await getStripe().subscriptions.cancel(tenant.stripeSubscriptionId);
        log.info({ tenantId: request.tenant.id }, "Stripe subscription cancelled");
      } catch (err) {
        log.warn({ err, tenantId: request.tenant.id }, "Failed to cancel Stripe subscription");
      }
    }

    // Clean up uploaded category images from GCS.
    await deleteTenantFiles(request.tenant.id);

    // Delete the blog — cascades members, api_keys, posts, etc.
    await app.prisma.tenant.delete({ where: { id: request.tenant.id } });

    // Delete the global user (cascades sessions + accounts). Only if this user
    // has no other blog left.
    const remaining = await app.prisma.member.count({ where: { userId: request.user.id } });
    if (remaining === 0) {
      await app.prisma.authUser.delete({ where: { id: request.user.id } }).catch(() => {});
    }

    log.info({ tenantId: request.tenant.id, userId: request.user.id }, "Blog and account deleted");
    return reply.code(204).send();
  });
}
