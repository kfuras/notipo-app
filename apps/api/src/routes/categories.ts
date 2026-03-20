import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { NotionService } from "../services/notion.service.js";
import { syncWpCategories } from "../lib/sync-wp-categories.js";
import { uploadFile, deleteFile, getSignedUrl } from "../lib/storage.js";
import type { Category } from "@prisma/client";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Delete a GCS-hosted background image if it uses the gcs: prefix. */
async function deleteBackgroundImage(backgroundImage: string | null) {
  if (!backgroundImage?.startsWith("gcs:")) return;
  await deleteFile(backgroundImage);
}

/** Add a previewUrl for gcs: background images so the frontend can display them. */
async function withPreviewUrl(category: Category) {
  if (category.backgroundImage?.startsWith("gcs:")) {
    return { ...category, previewUrl: await getSignedUrl(category.backgroundImage) };
  }
  return category;
}

async function withPreviewUrls(categories: Category[]) {
  return Promise.all(categories.map(withPreviewUrl));
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
    return { data: await withPreviewUrls(categories) };
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
    return { data: { categories: await withPreviewUrls(categories), tags }, synced };
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
    return { data: updated ? await withPreviewUrl(updated) : updated };
  });

  /** Upload a background image for a category (multipart form-data). */
  app.post<{ Params: { id: string } }>("/api/categories/:id/background-image", async (request, reply) => {
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

    const filename = `${categoryId}-${Date.now()}.${ext}`;
    const ref = await uploadFile(tenantId, filename, buffer, file.mimetype);

    // Delete old uploaded file if replacing
    await deleteBackgroundImage(category.backgroundImage);

    const updated = await app.prisma.category.update({
      where: { id: categoryId },
      data: { backgroundImage: ref },
    });

    return { data: await withPreviewUrl(updated) };
  });

  /** Remove the background image for a category. */
  app.delete<{ Params: { id: string } }>("/api/categories/:id/background-image", async (request, reply) => {
    const tenantId = request.tenant.id;
    const categoryId = request.params.id;

    const category = await app.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!category) return reply.notFound("Category not found");

    await deleteBackgroundImage(category.backgroundImage);

    const updated = await app.prisma.category.update({
      where: { id: categoryId },
      data: { backgroundImage: null },
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

    // Clean up uploaded file before deleting
    await deleteBackgroundImage(category.backgroundImage);

    await app.prisma.category.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });
}
