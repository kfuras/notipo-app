import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireSession } from "../plugins/auth.js";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { NotionService } from "../services/notion.service.js";
import { syncWpCategories } from "../lib/sync-wp-categories.js";
import { resolveGeminiApiKey } from "../lib/gemini-key.js";
import { getEffectivePlan, isSelfHosted } from "../lib/plan-limits.js";
import { isPrivateUrl } from "../lib/url-validation.js";
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

const geminiKeySchema = z.object({
  apiKey: z.string().min(20).max(200),
});

const generalSettingsSchema = z.object({
  codeHighlighter: z.enum(["PRISMATIC", "WP_CODE", "HIGHLIGHT_JS", "PRISM_JS"]).optional(),
  featuredImageMode: z.enum(["STANDARD", "AI_GENERATED"]).optional(),
  aiImageStyle: z.string().max(100).optional(),
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
        featuredImageMode: true,
        aiImageStyle: true,
        geminiCredentials: true,
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
        featuredImageMode: tenant.featuredImageMode,
        aiImageStyle: tenant.aiImageStyle,
        // Whether AI mode can be switched on at all, and whether this blog
        // brought its own key. Self-hosted falls back to the instance key;
        // the hosted service does not — see lib/gemini-key.ts.
        geminiAvailable:
          tenant.geminiCredentials !== null || (isSelfHosted() && !!config.GEMINI_API_KEY),
        geminiConfigured: tenant.geminiCredentials !== null,
        webhookUrl: tenant.webhookUrl,
        plan: tenant.plan,
        effectivePlan: getEffectivePlan(tenant.plan, tenant.trialEndsAt),
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      },
    };
  });

  /** GET /api/settings/wordpress-credentials — return decrypted WP credentials for authenticated tenant */
  app.get("/api/settings/wordpress-credentials", async (request, reply) => {
    const credService = new CredentialService(app.prisma);
    const creds = await credService.getWordPressCredentials(request.tenant.id);
    if (!creds) {
      return reply.code(404).send({ error: "WordPress not connected" });
    }
    return { data: creds };
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

  /**
   * PUT /api/settings/gemini — store this blog's own Gemini key.
   *
   * Bring-your-own-key, because Gemini bills a prepaid account. On the hosted
   * service there is no shared key to fall back to; a blog that wants
   * AI-generated featured images pays for them itself.
   */
  app.put("/api/settings/gemini", async (request, reply) => {
    const { apiKey } = geminiKeySchema.parse(request.body);
    await new CredentialService(app.prisma).setGeminiCredentials(request.tenant.id, { apiKey });
    return reply.code(204).send();
  });

  /**
   * DELETE /api/settings/gemini — remove the key.
   *
   * Falls back to STANDARD image generation in the same write. Leaving the mode
   * on AI_GENERATED without a key would fail at publish time instead, which is
   * a worse place to find out.
   */
  app.delete("/api/settings/gemini", async (request, reply) => {
    await new CredentialService(app.prisma).clearGeminiCredentials(request.tenant.id);
    if (!(await resolveGeminiApiKey(app.prisma, request.tenant.id))) {
      await app.prisma.tenant.updateMany({
        where: { id: request.tenant.id, featuredImageMode: "AI_GENERATED" },
        data: { featuredImageMode: "STANDARD" },
      });
    }
    return reply.code(204).send();
  });

  /** PATCH /api/settings — update non-secret config */
  app.patch("/api/settings", async (request, reply) => {
    const body = generalSettingsSchema.parse(request.body);

    // Reject SSRF-y webhook URLs at save time so they never reach the job runner.
    if (body.webhookUrl && (await isPrivateUrl(body.webhookUrl))) {
      return reply.code(400).send({ error: "Webhook URL points to a private/internal address" });
    }

    // AI mode spends money against a Gemini key. Refuse to turn it on unless
    // one resolves for this blog, so the switch cannot be flipped into someone
    // else's billing account.
    if (body.featuredImageMode === "AI_GENERATED") {
      const key = await resolveGeminiApiKey(app.prisma, request.tenant.id);
      if (!key) {
        return reply.badRequest(
          "AI-generated featured images need a Gemini API key. Add one under Settings first.",
        );
      }
    }

    await app.prisma.tenant.update({
      where: { id: request.tenant.id },
      data: {
        ...(body.codeHighlighter !== undefined && { codeHighlighter: body.codeHighlighter }),
        ...(body.featuredImageMode !== undefined && { featuredImageMode: body.featuredImageMode }),
        ...(body.aiImageStyle !== undefined && { aiImageStyle: body.aiImageStyle || null }),
        ...(body.databaseId !== undefined && { notionDatabaseId: body.databaseId }),
        ...(body.triggerStatus !== undefined && { notionTriggerStatus: body.triggerStatus }),
        ...(body.publishTriggerStatus !== undefined && { notionPublishTriggerStatus: body.publishTriggerStatus }),
        ...(body.updateTriggerStatus !== undefined && { notionUpdateTriggerStatus: body.updateTriggerStatus }),
        ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl || null }),
      },
    });

    return reply.code(204).send();
  });

  /** GET /api/settings/wordpress-health — check WP connection health via app password introspection */
  app.get("/api/settings/wordpress-health", async (request, reply) => {
    const credService = new CredentialService(app.prisma);
    const creds = await credService.getWordPressCredentials(request.tenant.id);
    if (!creds) return reply.code(404).send({ error: "WordPress not connected" });

    const wp = new WordPressService(creds);
    try {
      const user = await wp.testConnection();
      const appPassword = await wp.introspectAppPassword();
      return {
        data: {
          connected: true,
          user: user.name,
          appPassword: appPassword ? {
            name: appPassword.name,
            lastUsed: appPassword.last_used,
            lastIp: appPassword.last_ip,
          } : null,
        },
      };
    } catch {
      return { data: { connected: false, user: null, appPassword: null } };
    }
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
    if (await isPrivateUrl(tenant.webhookUrl)) {
      return reply.code(400).send({ error: "Webhook URL points to a private/internal address" });
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

  /**
   * GET /api/settings/api-key — the programmatic key (CLI/MCP) for the active
   * blog. Session-only: a request authenticated *with* an API key cannot read
   * or rotate the key.
   */
  app.get("/api/settings/api-key", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const key = await app.prisma.apiKey.findFirst({
      where: { tenantId: request.tenant.id },
      orderBy: { createdAt: "desc" },
      select: { key: true, name: true, lastUsedAt: true, createdAt: true },
    });
    if (!key) return { data: null };
    return {
      data: {
        key: key.key,
        name: key.name,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      },
    };
  });

  /**
   * POST /api/settings/api-key/rotate — regenerate the active blog's key.
   * Session-only. Replaces every existing key for the blog with one fresh key,
   * so the old key stops working immediately.
   */
  app.post("/api/settings/api-key/rotate", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const newKey = `ntp_${randomBytes(32).toString("hex")}`;
    await app.prisma.$transaction([
      app.prisma.apiKey.deleteMany({ where: { tenantId: request.tenant.id } }),
      app.prisma.apiKey.create({
        data: {
          key: newKey,
          tenantId: request.tenant.id,
          userId: request.user.id,
          name: "Default",
        },
      }),
    ]);
    return { data: { key: newKey } };
  });
}
