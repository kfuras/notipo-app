import type { FastifyInstance } from "fastify";
import { z } from "zod";
import axios from "axios";
import { WordPressService } from "../services/wordpress.service.js";
import { CredentialService } from "../services/credential.service.js";
import { NotionService } from "../services/notion.service.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { canGenerateFeaturedImage } from "../lib/plan-limits.js";

const syncBodySchema = z.object({
  notionPageId: z.string().min(1),
});

const imageSchema = z.object({
  query: z.string().min(1),
  afterHeading: z.string().min(1),
});

const createPostSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  seoKeyword: z.string().optional(),
  seoDescription: z.string().max(160).optional(),
  imageTitle: z.string().optional(),
  slug: z.string().optional(),
  publish: z.boolean().optional().default(false),
  images: z.array(imageSchema).optional(),
});

const updatePostSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  seoKeyword: z.string().optional(),
  seoDescription: z.string().max(160).optional(),
  slug: z.string().optional(),
  publish: z.boolean().optional(),
});

const directPublishSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  seoKeyword: z.string().optional(),
  seoDescription: z.string().max(160).optional(),
  imageTitle: z.string().optional(),
  slug: z.string().optional(),
  publish: z.boolean().optional().default(false),
});

const publishParamsSchema = z.object({
  id: z.string().min(1),
});

export async function postRoutes(app: FastifyInstance) {
  // List posts for tenant
  app.get("/api/posts", async (request) => {
    const posts = await app.prisma.post.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: { updatedAt: "desc" },
      include: { category: true },
    });
    return { data: posts };
  });

  // Get single post
  app.get<{ Params: { id: string } }>("/api/posts/:id", async (request, reply) => {
    const post = await app.prisma.post.findFirst({
      where: { id: request.params.id, tenantId: request.tenant.id },
      include: { category: true, imageMappings: true },
    });
    if (!post) return reply.notFound("Post not found");
    return { data: post };
  });

  // Update post: update Notion page, then trigger re-sync to WordPress
  app.patch<{ Params: { id: string } }>("/api/posts/:id", async (request, reply) => {
    const body = updatePostSchema.parse(request.body);
    const tenantId = request.tenant.id;

    const post = await app.prisma.post.findFirst({
      where: { id: request.params.id, tenantId },
    });
    if (!post) return reply.notFound("Post not found");

    // Direct-publish posts: re-run direct pipeline
    if (!post.notionPageId) {
      const markdown = body.body ?? post.markdownContent;
      if (!markdown) return reply.code(400).send({ error: "Body is required when updating a direct-publish post" });

      const jobId = await app.boss.send("direct-publish", {
        tenantId,
        title: body.title ?? post.title,
        markdown,
        category: body.category,
        tags: body.tags,
        seoKeyword: body.seoKeyword ?? post.seoKeyword,
        seoDescription: body.seoDescription ?? post.seoDescription,
        slug: body.slug ?? post.slug,
        publish: body.publish,
      });

      // Delete old post record so direct-publish creates a fresh one
      // (keeps the same WP post via slug matching)
      return reply.code(202).send({
        data: { jobId, postId: post.id, message: "Post update queued (direct publish)." },
      });
    }

    const credService = new CredentialService(app.prisma);
    const notionCreds = await credService.getNotionCredentials(tenantId);
    if (!notionCreds) return reply.code(400).send({ error: "Notion is not configured" });

    const notion = new NotionService(notionCreds.accessToken);

    // Update Notion page content if body provided
    if (body.body !== undefined) {
      await notion.replacePageContent(post.notionPageId, body.body);
    }

    // Update Notion page properties if any provided
    if (body.title || body.category || body.tags || body.seoKeyword || body.seoDescription) {
      await notion.updatePageProperties(post.notionPageId, {
        title: body.title,
        category: body.category,
        tags: body.tags,
        seoKeyword: body.seoKeyword,
        seoDescription: body.seoDescription,
      });
    }

    // Trigger re-sync to WordPress
    const jobId = await app.boss.send("sync-post", {
      tenantId,
      notionPageId: post.notionPageId,
      ...(body.publish && { thenPublish: true, forcePublish: true }),
      ...(body.slug && { wpSlug: body.slug }),
    });

    return reply.code(202).send({
      data: { jobId, postId: post.id, message: "Post updated. Sync job queued." },
    });
  });

  // Create a new post in Notion and trigger sync
  app.post("/api/posts/create", async (request, reply) => {
    const body = createPostSchema.parse(request.body);
    const tenantId = request.tenant.id;

    const credService = new CredentialService(app.prisma);
    const notionCreds = await credService.getNotionCredentials(tenantId);
    if (!notionCreds) return reply.code(400).send({ error: "Notion is not configured" });

    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { notionDatabaseId: true, notionTriggerStatus: true, notionPublishTriggerStatus: true },
    });
    if (!tenant.notionDatabaseId) return reply.code(400).send({ error: "Notion database not configured" });

    const notion = new NotionService(notionCreds.accessToken);
    const status = body.publish
      ? (tenant.notionPublishTriggerStatus ?? "Publish")
      : (tenant.notionTriggerStatus ?? "Post to Wordpress");

    // Insert Unsplash images into body (Pro plan only)
    let enrichedBody = body.body;
    if (body.images?.length && enrichedBody && config.UNSPLASH_ACCESS_KEY) {
      const tenantPlan = await app.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { plan: true, trialEndsAt: true },
      });
      if (canGenerateFeaturedImage(tenantPlan.plan, tenantPlan.trialEndsAt)) {
        for (const img of body.images) {
          try {
            const search = await axios.get<{
              results: Array<{ urls: { regular: string }; alt_description: string | null; links: { download_location: string } }>;
            }>("https://api.unsplash.com/search/photos", {
              params: { query: img.query, orientation: "landscape", per_page: 5 },
              headers: { Authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}` },
              timeout: 10_000,
            });
            const photo = search.data.results[0];
            if (photo) {
              // Trigger download tracking (Unsplash ToS)
              axios.get(photo.links.download_location, {
                headers: { Authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}` },
                timeout: 5_000,
              }).catch(() => {});
              const alt = photo.alt_description || img.query;
              const imageMarkdown = `\n\n![${alt}](${photo.urls.regular})`;
              // Insert after the matching heading
              const headingIndex = enrichedBody!.indexOf(img.afterHeading);
              if (headingIndex !== -1) {
                const endOfLine: number = enrichedBody!.indexOf("\n", headingIndex + img.afterHeading.length);
                const insertAt: number = endOfLine !== -1 ? endOfLine : headingIndex + img.afterHeading.length;
                enrichedBody = enrichedBody!.slice(0, insertAt) + imageMarkdown + enrichedBody!.slice(insertAt);
              }
            }
          } catch (err) {
            logger.warn({ err, query: img.query }, "Unsplash search failed for inline image");
          }
        }
      }
    }

    const notionPageId = await notion.createPage(tenant.notionDatabaseId, {
      title: body.title,
      body: enrichedBody,
      category: body.category,
      tags: body.tags,
      seoKeyword: body.seoKeyword,
      seoDescription: body.seoDescription,
      imageTitle: body.imageTitle,
      status,
    });

    const jobId = await app.boss.send("sync-post", {
      tenantId,
      notionPageId,
      ...(body.publish && { thenPublish: true, forcePublish: true }),
      ...(body.slug && { wpSlug: body.slug }),
    });

    return reply.code(202).send({
      data: { jobId, notionPageId, message: "Post created. Run `notipo jobs` to monitor progress." },
    });
  });

  // Direct publish: markdown → WordPress, no Notion
  app.post("/api/posts/direct", async (request, reply) => {
    const body = directPublishSchema.parse(request.body);
    const tenantId = request.tenant.id;

    // Only WordPress credentials are required — Notion is optional
    const credService = new CredentialService(app.prisma);
    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) {
      return reply.code(400).send({ error: "WordPress is not connected. Connect WordPress in Settings first." });
    }

    const jobId = await app.boss.send("direct-publish", {
      tenantId,
      title: body.title,
      markdown: body.body,
      category: body.category,
      tags: body.tags,
      seoKeyword: body.seoKeyword,
      seoDescription: body.seoDescription,
      featuredImageTitle: body.imageTitle,
      slug: body.slug,
      publish: body.publish,
    });

    return reply.code(202).send({
      data: { jobId, message: "Direct publish queued. Use `get /api/jobs` to monitor progress." },
    });
  });

  // Trigger sync from Notion
  app.post("/api/posts/sync", async (request, reply) => {
    const body = syncBodySchema.parse(request.body);
    const tenantId = request.tenant.id;

    // Enqueue sync job
    const jobId = await app.boss.send("sync-post", {
      tenantId,
      notionPageId: body.notionPageId,
    });

    return reply.code(202).send({
      data: { jobId, message: "Sync job queued" },
    });
  });

  // Trigger publish to WordPress
  app.post<{ Params: { id: string } }>("/api/posts/:id/publish", async (request, reply) => {
    const params = publishParamsSchema.parse(request.params);
    const tenantId = request.tenant.id;

    const post = await app.prisma.post.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!post) return reply.notFound("Post not found");

    // Enqueue publish job
    const jobId = await app.boss.send("publish-post", {
      tenantId,
      postId: params.id,
    });

    return reply.code(202).send({
      data: { jobId, message: "Publish job queued" },
    });
  });

  // Delete post and clean up WP resources
  app.delete<{ Params: { id: string } }>("/api/posts/:id", async (request, reply) => {
    const tenantId = request.tenant.id;
    const postId = request.params.id;

    const post = await app.prisma.post.findFirst({
      where: { id: postId, tenantId },
      include: { imageMappings: true },
    });
    if (!post) return reply.notFound("Post not found");

    const credService = new CredentialService(app.prisma);
    const wpCreds = await credService.getWordPressCredentials(tenantId);

    // Clean up WordPress resources (best-effort)
    if (wpCreds) {
      const wp = new WordPressService(wpCreds);

      // Delete WP post
      if (post.wpPostId) {
        await wp.deletePost(post.wpPostId).catch((e) =>
          logger.warn({ err: e, wpPostId: post.wpPostId }, "Failed to delete WP post"),
        );
      }

      // Delete featured image
      if (post.wpFeaturedMediaId) {
        await wp.deleteMedia(post.wpFeaturedMediaId).catch((e) =>
          logger.warn({ err: e, wpFeaturedMediaId: post.wpFeaturedMediaId }, "Failed to delete featured media"),
        );
      }

      // Delete inline images
      for (const mapping of post.imageMappings) {
        await wp.deleteMedia(mapping.wpMediaId).catch((e) =>
          logger.warn({ err: e, wpMediaId: mapping.wpMediaId }, "Failed to delete inline media"),
        );
      }
    }

    // Reset Notion page status (best-effort)
    if (post.notionPageId) {
      const notionCreds = await credService.getNotionCredentials(tenantId);
      if (notionCreds) {
        const notion = new NotionService(notionCreds.accessToken);
        await notion.updatePageStatus(post.notionPageId, "Draft").catch((e) =>
          logger.warn({ err: e }, "Failed to reset Notion status"),
        );
      }
    }

    // Delete from database (image mappings cascade)
    await app.prisma.imageMapping.deleteMany({ where: { postId, tenantId } });
    await app.prisma.job.deleteMany({ where: { postId, tenantId } });
    await app.prisma.post.delete({ where: { id: postId } });

    logger.info({ tenantId, postId, wpPostId: post.wpPostId }, "Post deleted with WP cleanup");
    return { data: { message: "Post deleted" } };
  });
}
