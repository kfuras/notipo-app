import type { FastifyInstance } from "fastify";
import { z } from "zod";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function templateRoutes(app: FastifyInstance) {
  // List templates
  app.get("/api/templates", async (request) => {
    const templates = await app.prisma.postTemplate.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: { name: "asc" },
    });
    return { data: templates };
  });

  // Create template
  app.post("/api/templates", async (request, reply) => {
    const body = templateSchema.parse(request.body);
    const template = await app.prisma.postTemplate.create({
      data: {
        tenantId: request.tenant.id,
        name: body.name,
        body: body.body,
        category: body.category ?? null,
        tags: body.tags ?? [],
      },
    });
    return reply.code(201).send({ data: template });
  });

  // Update template
  app.patch<{ Params: { id: string } }>("/api/templates/:id", async (request, reply) => {
    const body = templateSchema.partial().parse(request.body);
    const template = await app.prisma.postTemplate.findFirst({
      where: { id: request.params.id, tenantId: request.tenant.id },
    });
    if (!template) return reply.notFound("Template not found");

    const updated = await app.prisma.postTemplate.update({
      where: { id: template.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.category !== undefined && { category: body.category ?? null }),
        ...(body.tags !== undefined && { tags: body.tags ?? [] }),
      },
    });
    return { data: updated };
  });

  // Delete template
  app.delete<{ Params: { id: string } }>("/api/templates/:id", async (request, reply) => {
    const template = await app.prisma.postTemplate.findFirst({
      where: { id: request.params.id, tenantId: request.tenant.id },
    });
    if (!template) return reply.notFound("Template not found");

    await app.prisma.postTemplate.delete({ where: { id: template.id } });
    return { data: { message: "Template deleted" } };
  });
}
