import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { canImportFromWordPress } from "../lib/plan-limits.js";

const importSingleSchema = z.object({
  wpPostId: z.number().int().positive(),
  overwrite: z.boolean().optional().default(false),
});

const importBulkSchema = z.object({
  wpPostIds: z.array(z.number().int().positive()).min(1).max(200),
  overwrite: z.boolean().optional().default(false),
});

export async function importRoutes(app: FastifyInstance) {
  /** GET /api/import/wp-posts — List importable WordPress posts */
  app.get<{ Querystring: { page?: string; perPage?: string; status?: string } }>(
    "/api/import/wp-posts",
    async (request, reply) => {
      const tenantId = request.tenant.id;

      // Plan gate
      const tenant = await app.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { plan: true, trialEndsAt: true },
      });
      if (!canImportFromWordPress(tenant.plan, tenant.trialEndsAt)) {
        return reply.code(403).send({ error: "Import from WordPress requires a Pro plan" });
      }

      const credService = new CredentialService(app.prisma);
      const wpCreds = await credService.getWordPressCredentials(tenantId);
      if (!wpCreds) {
        return reply.code(400).send({ error: "WordPress not connected" });
      }

      const wp = new WordPressService(wpCreds);
      const page = Number(request.query.page) || 1;
      const perPage = Math.min(Number(request.query.perPage) || 20, 100);
      const status = request.query.status || "any";

      const result = await wp.listPosts({ status, page, perPage });

      // Find which posts are already imported
      const wpPostIds = result.posts.map((p) => p.id);
      const existing = await app.prisma.post.findMany({
        where: { tenantId, wpPostId: { in: wpPostIds } },
        select: { wpPostId: true },
      });
      const importedIds = existing.map((p) => p.wpPostId).filter(Boolean) as number[];

      return {
        data: result.posts.map((p) => ({
          id: p.id,
          title: p.title.rendered,
          status: p.status,
          slug: p.slug,
          date: p.date,
          link: p.link,
          categories: p.categories,
          tags: p.tags,
          imported: importedIds.includes(p.id),
        })),
        total: result.total,
        totalPages: result.totalPages,
        page,
        perPage,
      };
    },
  );

  /** POST /api/import/posts — Import a single WordPress post */
  app.post("/api/import/posts", async (request, reply) => {
    const tenantId = request.tenant.id;
    const body = importSingleSchema.parse(request.body);

    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true, trialEndsAt: true },
    });
    if (!canImportFromWordPress(tenant.plan, tenant.trialEndsAt)) {
      return reply.code(403).send({ error: "Import from WordPress requires a Pro plan" });
    }

    const jobId = await app.boss.send("import-post", {
      tenantId,
      wpPostId: body.wpPostId,
      overwrite: body.overwrite,
    }, { singletonKey: `import:${tenantId}:${body.wpPostId}` });

    return reply.code(202).send({
      data: { jobId, wpPostId: body.wpPostId, message: "Import job queued" },
    });
  });

  /** POST /api/import/posts/bulk — Import multiple WordPress posts */
  app.post("/api/import/posts/bulk", async (request, reply) => {
    const tenantId = request.tenant.id;
    const body = importBulkSchema.parse(request.body);

    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true, trialEndsAt: true },
    });
    if (!canImportFromWordPress(tenant.plan, tenant.trialEndsAt)) {
      return reply.code(403).send({ error: "Import from WordPress requires a Pro plan" });
    }

    // Pre-resolve WP categories/tags once for efficiency
    const credService = new CredentialService(app.prisma);
    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) {
      return reply.code(400).send({ error: "WordPress not connected" });
    }

    const wp = new WordPressService(wpCreds);
    const [cats, tags] = await Promise.all([wp.listCategories(), wp.listTags()]);
    const wpCategoryMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    const wpTagMap = Object.fromEntries(tags.map((t) => [t.id, t.name]));

    const jobIds: (string | null)[] = [];
    for (const wpPostId of body.wpPostIds) {
      const jobId = await app.boss.send("import-post", {
        tenantId,
        wpPostId,
        overwrite: body.overwrite,
        wpCategoryMap,
        wpTagMap,
      }, { singletonKey: `import:${tenantId}:${wpPostId}` });
      jobIds.push(jobId);
    }

    return reply.code(202).send({
      data: { jobIds, count: body.wpPostIds.length, message: "Import jobs queued" },
    });
  });
}
