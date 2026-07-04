import type { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";
import { config } from "../config.js";

interface WebhookPayload {
  jobType: string;
  status: string;
  postTitle?: string;
  error?: string;
}

/**
 * Send a failure notification to the tenant's configured webhook URL.
 * Works with both Slack (reads `text`) and Discord (reads `content`).
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function sendWebhook(prisma: PrismaClient, tenantId: string, payload: WebhookPayload) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookUrl: true },
    });

    if (!tenant?.webhookUrl) return;

    const typeLabel = payload.jobType === "SYNC_POST" ? "Sync" : "Publish";
    const title = payload.postTitle ? `"${payload.postTitle}"` : "Unknown post";
    const errorLine = payload.error ? `\nError: ${payload.error}` : "";
    const dashboardUrl = config.FRONTEND_URL
      ? `${config.FRONTEND_URL}/admin/jobs`
      : "https://app.notipo.com/admin/jobs";

    const message = `<!channel> ⚠️ ${typeLabel} failed: ${title}${errorLine}\n→ ${dashboardUrl}`;

    await fetch(tenant.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.warn({ tenantId, err }, "Failed to send webhook notification");
  }
}
