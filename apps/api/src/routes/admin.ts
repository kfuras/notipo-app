import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";

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
        users: {
          where: { role: "OWNER" },
          select: { email: true },
          take: 1,
        },
        _count: { select: { users: true, posts: true } },
      },
    });
    return {
      data: tenants.map((t) => ({
        ...t,
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

  /** DELETE /api/admin/tenants/:id — delete a tenant and all its data */
  app.delete<{ Params: { id: string } }>("/api/admin/tenants/:id", async (request, reply) => {
    await app.prisma.tenant.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });
}
