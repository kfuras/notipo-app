import type { PrismaClient } from "@prisma/client";

export interface OwnerContact {
  email: string;
  name: string | null;
}

/**
 * Resolve a tenant's owner contact.
 *
 * Prefers the better-auth membership (member → authUser; the oldest member is
 * the creator/owner). Falls back to the legacy per-tenant `users` OWNER row for
 * tenants that predate the better-auth migration.
 *
 * Needed because the legacy `users` table is empty for tenants created via
 * better-auth signup, so anything that emails the owner or creates a Stripe
 * customer must resolve the address this way.
 */
export async function resolveOwnerContact(
  prisma: PrismaClient,
  tenantId: string,
): Promise<OwnerContact | null> {
  const member = await prisma.member.findFirst({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "asc" },
    select: { authuser: { select: { email: true, name: true } } },
  });
  if (member?.authuser?.email) {
    return { email: member.authuser.email, name: member.authuser.name };
  }

  const legacy = await prisma.user.findFirst({
    where: { tenantId, role: "OWNER" },
    select: { email: true, name: true },
  });
  return legacy ? { email: legacy.email, name: legacy.name } : null;
}
