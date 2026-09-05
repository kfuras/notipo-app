import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { NotionService } from "../services/notion.service.js";
import { syncWpCategories } from "../lib/sync-wp-categories.js";
import { logger } from "../lib/logger.js";
import type { PrismaClient, Category } from "@prisma/client";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Remove a background image from the tenant's WordPress media library.
 *
 * Best effort on purpose. The file lives on the customer's own site, so a
 * failure here means one orphaned image in their library — not a reason to
 * fail the request they actually made. The row is updated either way.
 */
async function deleteBackgroundMedia(
  prisma: PrismaClient,
  tenantId: string,
  mediaId: number | null,
) {
  if (!mediaId) return;
  try {
    const creds = await new CredentialService(prisma).getWordPressCredentials(tenantId);
    if (!creds) return;
    await new WordPressService(creds).deleteMedia(mediaId);
  } catch (err) {
    logger.warn({ err, tenantId, mediaId }, "Could not remove background image from WordPress");
  }
}

/**
 * The background is stored as the public URL WordPress gave us, so there is
 * nothing to sign or resolve. previewUrl is kept in the response because the
 * frontend reads it, and it used to be a separate signed URL.
 */
function withPreviewUrl(category: Category) {
  const bg = category.backgroundImage;
  if (bg?.startsWith("http://") || bg?.startsWith("https://")) {
    return { ...category, previewUrl: bg };
  }
  return category;
}

function withPreviewUrls(categories: Category[]) {
  return categories.map(withPreviewUrl);
}

const updateCategorySchema = z.object({
  backgroundImage: z.string().min(1).nullable(),
});

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/api/categories", async (request) => {
    const categories = await app.prisma.category.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: { name: "asc" },
    });
    return { data: withPreviewUrls(categories) };
  });

  app.get("/api/tags", async (request) => {
    const tags = await app.prisma.tag.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: { name: "asc" },
    });
    return { data: tags };
  });

  /** Sync categories and tags from the tenant's WordPress site into the DB. */
  app.post("/api/categories/sync", async (request, reply) => {
    const credService = new CredentialService(app.prisma);
    const wpCreds = await credService.getWordPressCredentials(request.tenant.id);
    if (!wpCreds) return reply.badRequest("WordPress credentials not configured");

    const wp = new WordPressService(wpCreds);
    const notionCreds = await credService.getNotionCredentials(request.tenant.id);
    const tenant = await app.prisma.tenant.findUniqueOrThrow({ where: { id: request.tenant.id }, select: { notionDatabaseId: true } });
    const notion = notionCreds ? new NotionService(notionCreds.accessToken) : undefined;
    const synced = await syncWpCategories(app.prisma, request.tenant.id, wp, notion, tenant.notionDatabaseId ?? undefined);

    const [categories, tags] = await Promise.all([
      app.prisma.category.findMany({ where: { tenantId: request.tenant.id }, orderBy: { name: "asc" } }),
      app.prisma.tag.findMany({ where: { tenantId: request.tenant.id }, orderBy: { name: "asc" } }),
    ]);
    return { data: { categories: withPreviewUrls(categories), tags }, synced };
  });

  /** Update a category's background image (JSON — accepts a URL or filename string). */
  app.patch<{ Params: { id: string } }>("/api/categories/:id", async (request, reply) => {
    const body = updateCategorySchema.parse(request.body);

    const category = await app.prisma.category.updateMany({
      where: { id: request.params.id, tenantId: request.tenant.id },
      data: body,
    });

    if (category.count === 0) return reply.notFound("Category not found");

    const updated = await app.prisma.category.findFirst({ where: { id: request.params.id, tenantId: request.tenant.id } });
    return { data: updated ? withPreviewUrl(updated) : updated };
  });

  /** Upload a background image for a category (multipart form-data). */
  app.post<{ Params: { id: string } }>("/api/categories/:id/background-image", async (request, reply) => {
    if (!request.tenant) return reply.unauthorized("Missing authentication");
    const tenantId = request.tenant.id;
    const categoryId = request.params.id;

    const category = await app.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!category) return reply.notFound("Category not found");

    const file = await request.file();
    if (!file) return reply.badRequest("No file uploaded");

    const ext = ALLOWED_MIME_TYPES[file.mimetype];
    if (!ext) {
      return reply.badRequest(`Invalid file type: ${file.mimetype}. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`);
    }

    // Buffer the file to check size before uploading
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    if (file.file.truncated) {
      return reply.badRequest("File too large. Maximum size is 5 MB.");
    }

    const creds = await new CredentialService(app.prisma).getWordPressCredentials(tenantId);
    if (!creds) {
      return reply
        .code(400)
        .send({ error: "WordPress is not connected. Connect WordPress in Settings first." });
    }

    // Named after the category rather than its id: this lands in the customer's
    // own media library, where an opaque cuid tells them nothing.
    const safeName =
      category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
    const filename = `notipo-background-${safeName}.${ext}`;

    let media;
    try {
      media = await new WordPressService(creds).uploadMedia(buffer, filename, file.mimetype);
    } catch (err) {
      logger.error({ err, tenantId, categoryId }, "WordPress rejected the background image upload");
      return reply.code(502).send({ error: "WordPress rejected the upload" });
    }
    if (!media?.source_url || !media?.id) {
      logger.error({ tenantId, categoryId, media }, "WordPress media upload returned no url or id");
      return reply.code(502).send({ error: "WordPress did not return a valid image URL" });
    }

    // Replacing: take the previous one out of their library so it does not pile up.
    await deleteBackgroundMedia(app.prisma, tenantId, category.backgroundImageMediaId);

    const updated = await app.prisma.category.update({
      where: { id: categoryId },
      data: { backgroundImage: media.source_url, backgroundImageMediaId: media.id },
    });

    return { data: withPreviewUrl(updated) };
  });

  /** Remove the background image for a category. */
  app.delete<{ Params: { id: string } }>("/api/categories/:id/background-image", async (request, reply) => {
    const tenantId = request.tenant.id;
    const categoryId = request.params.id;

    const category = await app.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!category) return reply.notFound("Category not found");

    await deleteBackgroundMedia(app.prisma, tenantId, category.backgroundImageMediaId);

    const updated = await app.prisma.category.update({
      where: { id: categoryId },
      data: { backgroundImage: null, backgroundImageMediaId: null },
    });

    return { data: updated };
  });

  app.delete<{ Params: { id: string } }>("/api/categories/:id", async (request, reply) => {
    const category = await app.prisma.category.findFirst({
      where: { id: request.params.id, tenantId: request.tenant.id },
    });
    if (!category) return reply.notFound("Category not found");

    const postCount = await app.prisma.post.count({
      where: { categoryId: request.params.id, tenantId: request.tenant.id },
    });
    if (postCount > 0) {
      return reply.badRequest(`Cannot delete category: ${postCount} post(s) still assigned to it`);
    }

    // Take the background out of their media library before dropping the row.
    await deleteBackgroundMedia(app.prisma, request.tenant.id, category.backgroundImageMediaId);

    await app.prisma.category.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });
}
