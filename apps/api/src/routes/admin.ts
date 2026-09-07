import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import { CredentialService } from "../services/credential.service.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ route: "admin" });

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  ownerEmail: z.string().email(),
  ownerName: z.string().optional(),
  codeHighlighter: z.enum(["PRISMATIC", "WP_CODE", "HIGHLIGHT_JS", "PRISM_JS"]).optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  /** GET /api/admin/tenants — list all tenants */
  app.get("/api/admin/tenants", async () => {
    const tenants = await app.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        wpSiteUrl: true,
        notionCredentials: true,
        notionDatabaseId: true,
        codeHighlighter: true,
        plan: true,
        createdAt: true,
        // Owners live in `member` -> `authUser` since the move to better-auth.
        // The legacy `users` relation still exists but is empty, which is why
        // every row showed an owner of "—" while the accounts were real.
        members: {
          where: { role: "owner" },
          select: { authuser: { select: { email: true } } },
          take: 1,
        },
        _count: { select: { members: true, posts: true } },
      },
    });
    return {
      data: tenants.map(({ members, _count, ...t }) => ({
        ...t,
        // Keep the shape the admin UI already reads.
        users: members.map((m) => ({ email: m.authuser.email })),
        _count: { users: _count.members, posts: _count.posts },
        notionConnected: t.notionCredentials !== null,
        notionCredentials: undefined,
      })),
    };
  });

  /** POST /api/admin/tenants — create a new tenant with an initial owner user */
  app.post("/api/admin/tenants", async (request, reply) => {
    const body = createTenantSchema.parse(request.body);

    const apiKey = randomBytes(32).toString("hex");

    const tenant = await app.prisma.tenant.create({
      data: {
        name: body.name,
        slug: body.slug,
        ...(body.codeHighlighter && { codeHighlighter: body.codeHighlighter }),
        users: {
          create: {
            email: body.ownerEmail,
            name: body.ownerName,
            role: "OWNER",
            apiKey,
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        codeHighlighter: true,
        createdAt: true,
        users: {
          select: { id: true, email: true, name: true, role: true, apiKey: true },
        },
      },
    });

    // Return 201 with the API key — this is the only time it's returned in plaintext
    return reply.code(201).send({ data: tenant });
  });

  /** GET /api/admin/tenants/:id/wordpress-credentials — return decrypted WP credentials */
  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id/wordpress-credentials", async (request, reply) => {
    const credentialService = new CredentialService(app.prisma);
    const creds = await credentialService.getWordPressCredentials(request.params.id);
    if (!creds) {
      return reply.code(404).send({ error: "WordPress not connected for this tenant" });
    }
    return { data: creds };
  });

  /** DELETE /api/admin/tenants/:id — delete a tenant and all its data */
  app.delete<{ Params: { id: string } }>("/api/admin/tenants/:id", async (request, reply) => {
    // Who belongs to this blog, before the cascade removes the member rows.
    const members = await app.prisma.member.findMany({
      where: { organizationId: request.params.id },
      select: { userId: true },
    });

    await app.prisma.tenant.delete({ where: { id: request.params.id } });

    // Delete every owner this left without a blog. Without it the authUser and
    // its session survive with no member row, and that account is locked out
    // for good: every tenant route 401s "No blog is set up for this account",
    // and signing up again fails because the e-mail is taken.
    for (const { userId } of members) {
      const remaining = await app.prisma.member.count({ where: { userId } });
      if (remaining > 0) continue;
      await app.prisma.authUser.delete({ where: { id: userId } }).catch((err) => {
        log.error({ err, userId }, "Could not delete the owner left without a blog — account is now locked out");
      });
    }

    return reply.code(204).send();
  });
}
