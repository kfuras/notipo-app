import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config.js";
import { NotionService } from "../services/notion.service.js";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { canUseWebhooks } from "../lib/plan-limits.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ route: "notion-webhook" });

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function notionWebhookRoutes(app: FastifyInstance) {
  app.decorateRequest("rawBody", undefined);

  // Preserve raw body for HMAC signature verification.
  // Fastify's default JSON parser discards the original bytes, but HMAC
  // must be computed over the exact bytes Notion sent.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req: FastifyRequest, body: Buffer, done) => {
      req.rawBody = body;
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/api/notion/webhook", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // ── Verification request (one-time during subscription setup) ──
    if (body.verification_token && !body.type) {
      // Log the token so the operator can set NOTION_WEBHOOK_SECRET.
      // This is a one-time setup value, not a recurring secret.
      log.info(
        `Notion webhook verification token received: ${body.verification_token} — set NOTION_WEBHOOK_SECRET env var to this value`,
      );
      return reply.code(200).send();
    }

    // ── HMAC signature verification ──
    const secret = config.NOTION_WEBHOOK_SECRET;
    if (!secret) {
      log.warn("Received webhook event but NOTION_WEBHOOK_SECRET is not set — rejecting");
      return reply.code(503).send();
    }

    const signature = request.headers["x-notion-signature"] as string | undefined;
    if (!signature) {
      log.warn("Missing X-Notion-Signature header");
      return reply.code(401).send();
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      log.warn("No raw body available for signature verification");
      return reply.code(401).send();
    }

    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    try {
      const isValid = timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
      if (!isValid) {
        log.warn("Invalid webhook signature");
        return reply.code(401).send();
      }
    } catch {
      log.warn("Webhook signature verification failed (length mismatch)");
      return reply.code(401).send();
    }

    // ── Handle event ──
    const eventType = body.type as string;
    if (eventType !== "page.content_updated" && eventType !== "page.properties_updated") {
      log.debug({ eventType }, "Ignoring unhandled event type");
      return reply.code(200).send();
    }

    const workspaceId = body.workspace_id as string;
    const entity = body.entity as { id: string; type: string };
    const pageId = entity.id;

    log.info({ workspaceId, pageId, eventType }, "Received Notion webhook event");

    // Look up tenant by workspace ID
    const tenant = await app.prisma.tenant.findFirst({
      where: { notionWorkspaceId: workspaceId },
    });

    if (!tenant) {
      log.warn({ workspaceId }, "No tenant found for workspace — ignoring");
      return reply.code(200).send();
    }

    // Check if tenant's plan allows webhooks
    if (!canUseWebhooks(tenant.plan, tenant.trialEndsAt)) {
      log.info({ tenantId: tenant.id }, "Webhook ignored — Free plan (webhooks disabled)");
      return reply.code(200).send();
    }

    // Get tenant's Notion credentials
    const credService = new CredentialService(app.prisma);
    const creds = await credService.getNotionCredentials(tenant.id);
    if (!creds) {
      log.warn({ tenantId: tenant.id }, "Tenant has no Notion credentials");
      return reply.code(200).send();
    }

    // Fetch current page status from Notion
    const notion = new NotionService(creds.accessToken);
    let status: string | null;
    try {
      status = await notion.getPageStatus(pageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ tenantId: tenant.id, pageId, error: message }, "Failed to fetch page status");
      return reply.code(200).send();
    }

    if (!status) {
      log.debug({ tenantId: tenant.id, pageId }, "Page has no Status — ignoring");
      return reply.code(200).send();
    }

    // ── Route to the appropriate job based on status ──

    // "Post to Wordpress" → sync only (creates WP draft) — new posts only
    if (status === tenant.notionTriggerStatus) {
      // If already synced, check if WP post still exists before blocking
      const existingPost = await app.prisma.post.findUnique({
        where: { tenantId_notionPageId: { tenantId: tenant.id, notionPageId: pageId } },
        select: { id: true, wpPostId: true, status: true },
      });
      if (existingPost?.wpPostId) {
        let wpPostAlive = true;
        const wpCreds = await credService.getWordPressCredentials(tenant.id);
        if (wpCreds) {
          try {
            const wp = new WordPressService(wpCreds);
            const wpPost = await wp.getPost(existingPost.wpPostId);
            if (wpPost?.status === "trash") wpPostAlive = false;
          } catch {
            wpPostAlive = false;
          }
        }
        if (wpPostAlive) {
          log.warn({ tenantId: tenant.id, pageId, wpPostId: existingPost.wpPostId }, "Post already synced to WP — use 'Update Wordpress' instead, resetting Notion status");
          const resetStatus = existingPost.status === "PUBLISHED" ? "Published" : "Ready to Review";
          await notion.updatePageStatus(pageId, resetStatus);
          return reply.code(200).send();
        }
        log.info({ tenantId: tenant.id, pageId, wpPostId: existingPost.wpPostId }, "WP post deleted, clearing stale data for re-sync");
        await app.prisma.post.update({
          where: { id: existingPost.id },
          data: { wpPostId: null, wpFeaturedMediaId: null, wpContent: null, wpUrl: null },
        });
      }

      const runningJob = await app.prisma.job.findFirst({
        where: { tenantId: tenant.id, type: "SYNC_POST", status: "RUNNING", payload: { path: ["notionPageId"], equals: pageId } },
      });
      if (runningJob) {
        log.debug({ tenantId: tenant.id, pageId }, "Sync already running, skipping");
        return reply.code(200).send();
      }

      log.info({ tenantId: tenant.id, pageId }, "Webhook: enqueuing sync-post");
      await app.boss.send(
        "sync-post",
        { tenantId: tenant.id, notionPageId: pageId },
        { singletonKey: `sync:${pageId}` },
      );
      return reply.code(200).send();
    }

    // "Publish" → always re-sync from Notion then publish
    if (status === tenant.notionPublishTriggerStatus) {
      log.info({ tenantId: tenant.id, pageId }, "Webhook: enqueuing sync-then-publish");
      await app.boss.send(
        "sync-post",
        { tenantId: tenant.id, notionPageId: pageId, thenPublish: true },
        { singletonKey: `sync:${pageId}` },
      );
      return reply.code(200).send();
    }

    // "Update Wordpress" → re-sync then auto-publish if live
    if (status === tenant.notionUpdateTriggerStatus) {
      const runningJob = await app.prisma.job.findFirst({
        where: { tenantId: tenant.id, type: "SYNC_POST", status: "RUNNING", payload: { path: ["notionPageId"], equals: pageId } },
      });
      if (runningJob) {
        log.debug({ tenantId: tenant.id, pageId }, "Sync already running, skipping update");
        return reply.code(200).send();
      }

      log.info({ tenantId: tenant.id, pageId }, "Webhook: enqueuing sync-post (with publish)");
      await app.boss.send(
        "sync-post",
        { tenantId: tenant.id, notionPageId: pageId, thenPublish: true },
        { singletonKey: `sync:${pageId}` },
      );
      return reply.code(200).send();
    }

    log.debug({ tenantId: tenant.id, pageId, status }, "Status does not match any trigger — ignoring");
    return reply.code(200).send();
  });
}
