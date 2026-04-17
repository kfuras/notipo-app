import type { FastifyInstance } from "fastify";
import { WordPressService } from "../services/wordpress.service.js";
import { CredentialService } from "../services/credential.service.js";
import { logger } from "../lib/logger.js";

export async function uploadRoutes(app: FastifyInstance) {
  /**
   * Upload an image to the tenant's WordPress media library.
   * Returns the WP-hosted URL so the editor can insert it as a markdown image.
   */
  app.post("/api/uploads/image", async (request, reply) => {
    const tenantId = request.tenant.id;

    const credService = new CredentialService(app.prisma);
    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) {
      return reply.code(400).send({ error: "WordPress is not connected. Connect WordPress in Settings first." });
    }

    const file = await request.file();
    if (!file) return reply.badRequest("No file uploaded");
    if (!file.mimetype.startsWith("image/")) {
      return reply.badRequest("Only image files are allowed");
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      return reply.badRequest("Image must be under 10MB");
    }

    try {
      const wp = new WordPressService(wpCreds);
      const filename = file.filename || `paste-${Date.now()}.png`;
      const media = await wp.uploadMedia(buffer, filename, file.mimetype);

      if (!media?.source_url) {
        logger.error({ tenantId, media }, "WordPress media upload returned unexpected response");
        return reply.code(502).send({ error: "WordPress did not return a valid image URL" });
      }

      return { data: { url: media.source_url, mediaId: media.id } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tenantId, error: message }, "Image upload to WordPress failed");
      return reply.code(502).send({ error: `WordPress upload failed: ${message}` });
    }
  });
}
