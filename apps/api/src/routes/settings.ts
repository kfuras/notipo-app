import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { NotionService } from "../services/notion.service.js";
import { syncWpCategories } from "../lib/sync-wp-categories.js";
import { getEffectivePlan } from "../lib/plan-limits.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const notionSettingsSchema = z.object({
  accessToken: z.string().min(1),
  workspaceId: z.string().optional(),
  databaseId: z.string().optional(),
  triggerStatus: z.string().optional(),
  publishTriggerStatus: z.string().optional(),
  updateTriggerStatus: z.string().optional(),
});

const wordpressSettingsSchema = z.object({
  siteUrl: z.string().url(),
  username: z.string().min(1),
  appPassword: z.string().min(1),
});

const generalSettingsSchema = z.object({
  codeHighlighter: z.enum(["PRISMATIC", "WP_CODE", "HIGHLIGHT_JS", "PRISM_JS"]).optional(),
  databaseId: z.string().optional(),
  triggerStatus: z.string().optional(),
  publishTriggerStatus: z.string().optional(),
  updateTriggerStatus: z.string().optional(),
  webhookUrl: z.string().url().or(z.literal("")).optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  /** GET /api/settings — tenant config overview (no secrets) */
  app.get("/api/settings", async (request) => {
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: {
        notionCredentials: true,
        notionAuthMode: true,
        wordpressCredentials: true,
        notionWorkspaceId: true,
        notionDatabaseId: true,
        notionTriggerStatus: true,
        notionPublishTriggerStatus: true,
        notionUpdateTriggerStatus: true,
        wpSiteUrl: true,
        codeHighlighter: true,
        webhookUrl: true,
        plan: true,
        trialEndsAt: true,
      },
    });

    return {
      data: {
        notion: {
          configured: tenant.notionCredentials !== null,
          authMode: tenant.notionAuthMode || "internal",
          oauthAvailable: !!(config.NOTION_OAUTH_CLIENT_ID && config.NOTION_OAUTH_CLIENT_SECRET && config.NOTION_OAUTH_REDIRECT_URI),
          workspaceId: tenant.notionWorkspaceId,
          databaseId: tenant.notionDatabaseId,
          triggerStatus: tenant.notionTriggerStatus,
          publishTriggerStatus: tenant.notionPublishTriggerStatus,
          updateTriggerStatus: tenant.notionUpdateTriggerStatus,
        },
        wordpress: {
          configured: tenant.wordpressCredentials !== null,
          siteUrl: tenant.wpSiteUrl,
        },
        codeHighlighter: tenant.codeHighlighter,
        webhookUrl: tenant.webhookUrl,
        plan: tenant.plan,
        effectivePlan: getEffectivePlan(tenant.plan, tenant.trialEndsAt),
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      },
    };
  });

  /** PUT /api/settings/notion — set Notion credentials + optional DB config */
  app.put("/api/settings/notion", async (request, reply) => {
    const body = notionSettingsSchema.parse(request.body);
    const credService = new CredentialService(app.prisma);

    await credService.setNotionCredentials(request.tenant.id, {
      accessToken: body.accessToken,
      workspaceId: body.workspaceId,
    });

    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: {
        notionAuthMode: "internal",
        ...(body.databaseId !== undefined && { notionDatabaseId: body.databaseId }),
        ...(body.triggerStatus !== undefined && { notionTriggerStatus: body.triggerStatus }),
        ...(body.publishTriggerStatus !== undefined && { notionPublishTriggerStatus: body.publishTriggerStatus }),
        ...(body.updateTriggerStatus !== undefined && { notionUpdateTriggerStatus: body.updateTriggerStatus }),
        ...(body.workspaceId !== undefined && { notionWorkspaceId: body.workspaceId }),
      },
    });

    return reply.code(204).send();
  });

  /** DELETE /api/settings/notion — disconnect Notion */
  app.delete("/api/settings/notion", async (request, reply) => {
    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: {
        notionCredentials: null,
        notionAuthMode: null,
        notionWorkspaceId: null,
        notionDatabaseId: null,
      },
    });

    return reply.code(204).send();
  });

  /** DELETE /api/settings/wordpress — disconnect WordPress */
  app.delete("/api/settings/wordpress", async (request, reply) => {
    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: {
        wordpressCredentials: null,
        wpSiteUrl: null,
        wpSeoPlugin: null,
      },
    });

    return reply.code(204).send();
  });

  /** PUT /api/settings/wordpress — set WordPress credentials */
  app.put("/api/settings/wordpress", async (request, reply) => {
    const body = wordpressSettingsSchema.parse(request.body);

    // Verify credentials before saving
    const wp = new WordPressService(body);
    try {
      await wp.testConnection();
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 401 || status === 403) {
        return reply.code(400).send({ error: "Invalid WordPress credentials. Check your username and application password." });
      }
      return reply.code(400).send({ error: "Could not connect to WordPress. Check your site URL." });
    }

    const credService = new CredentialService(app.prisma);
    await credService.setWordPressCredentials(request.tenant.id, {
      siteUrl: body.siteUrl,
      username: body.username,
      appPassword: body.appPassword,
    });

    // Detect SEO plugin (best-effort, non-blocking)
    const seoPlugin = await wp.detectSeoPlugin();
    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: { wpSeoPlugin: seoPlugin },
    });
    if (seoPlugin) {
      logger.info({ tenantId: request.tenant.id, seoPlugin }, "SEO plugin detected");
    }

    // Auto-sync WP categories into the DB (and push to Notion if connected)
    try {
      const notionCreds = await credService.getNotionCredentials(request.tenant.id);
      const tenant = await app.prisma.tenant.findUniqueOrThrow({ where: { id: request.tenant.id }, select: { notionDatabaseId: true } });
      const notion = notionCreds ? new NotionService(notionCreds.accessToken) : undefined;
      await syncWpCategories(app.prisma, request.tenant.id, wp, notion, tenant.notionDatabaseId ?? undefined);
    } catch (e) {
      logger.warn({ err: e }, "Failed to auto-sync WP categories after credential save");
    }

    return reply.code(204).send();
  });

  /** PATCH /api/settings — update non-secret config */
  app.patch("/api/settings", async (request, reply) => {
    const body = generalSettingsSchema.parse(request.body);

    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: {
        ...(body.codeHighlighter !== undefined && { codeHighlighter: body.codeHighlighter }),
        ...(body.databaseId !== undefined && { notionDatabaseId: body.databaseId }),
        ...(body.triggerStatus !== undefined && { notionTriggerStatus: body.triggerStatus }),
        ...(body.publishTriggerStatus !== undefined && { notionPublishTriggerStatus: body.publishTriggerStatus }),
        ...(body.updateTriggerStatus !== undefined && { notionUpdateTriggerStatus: body.updateTriggerStatus }),
        ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl || null }),
      },
    });

    return reply.code(204).send();
  });

  /** POST /api/settings/test-webhook — send a test message to the saved webhook URL */
  app.post("/api/settings/test-webhook", async (request, reply) => {
    const tenant = await app.prisma.tenant.findUniqueOrThrow({
      where: { id: request.tenant.id },
      select: { webhookUrl: true },
    });

    if (!tenant.webhookUrl) {
      return reply.code(400).send({ error: "No webhook URL configured" });
    }

    const message = "<!channel> ✅ Notipo webhook test — connection working!";
    const res = await fetch(tenant.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return reply.code(400).send({ error: `Webhook returned HTTP ${res.status}` });
    }

    return reply.code(204).send();
  });
}
