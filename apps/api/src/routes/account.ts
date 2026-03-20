import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { logger } from "../lib/logger.js";
import { deleteTenantFiles } from "../lib/storage.js";
import { getStripe, isStripeConfigured } from "../lib/stripe.js";

const log = logger.child({ route: "account" });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

const authRateLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: "15 minutes" },
  },
};

export async function accountRoutes(app: FastifyInstance) {
  /** GET /api/account — current user + tenant info */
  app.get("/api/account", async (request) => {
    // Admin impersonation uses a synthetic user — return tenant owner instead
    if (request.user.id === "admin") {
      const owner = await app.prisma.user.findFirst({
        where: { tenantId: request.tenant.id, role: "OWNER" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          tenant: {
            select: { name: true, slug: true, plan: true, createdAt: true },
          },
        },
      });
      return { data: owner };
    }

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        apiKey: true,
        createdAt: true,
        tenant: {
          select: { name: true, slug: true, plan: true, createdAt: true },
        },
      },
    });

    return { data: user };
  });

  /** PATCH /api/account/password — change password */
  app.patch("/api/account/password", authRateLimit, async (request, reply) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.id },
      select: { passwordHash: true },
    });

    if (!user.passwordHash) {
      return reply.badRequest("Account does not use password authentication");
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.unauthorized("Current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await app.prisma.user.update({
      where: { id: request.user.id },
      data: { passwordHash },
    });

    log.info({ userId: request.user.id }, "Password changed");
    return { message: "Password updated successfully." };
  });

  /** DELETE /api/account — delete account */
  app.delete("/api/account", authRateLimit, async (request, reply) => {
    const { password } = deleteAccountSchema.parse(request.body);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.id },
      select: { passwordHash: true, role: true },
    });

    if (!user.passwordHash) {
      return reply.badRequest("Account does not use password authentication");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.unauthorized("Incorrect password");
    }

    if (user.role === "OWNER") {
      // Cancel Stripe subscription if exists
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

      // Clean up uploaded category images from GCS
      await deleteTenantFiles(request.tenant.id);

      // Delete tenant — cascades to all related records
      await app.prisma.tenant.delete({ where: { id: request.tenant.id } });
      log.info({ tenantId: request.tenant.id, userId: request.user.id }, "Tenant and account deleted");
    } else {
      // Non-owner: delete just the user
      await app.prisma.user.delete({ where: { id: request.user.id } });
      log.info({ userId: request.user.id, tenantId: request.tenant.id }, "User account deleted");
    }

    return reply.code(204).send();
  });
}
