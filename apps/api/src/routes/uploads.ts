import type { FastifyInstance } from "fastify";
import { WordPressService } from "../services/wordpress.service.js";
import { CredentialService } from "../services/credential.service.js";

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
      return reply.code(400).send({ error: "WordPress is not connected" });
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

    const wp = new WordPressService(wpCreds);
    const filename = file.filename || `paste-${Date.now()}.png`;
    const media = await wp.uploadMedia(buffer, filename, file.mimetype);

    return { data: { url: media.source_url, mediaId: media.id } };
  });
}
