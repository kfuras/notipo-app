import type PgBoss from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import { sendEmail } from "../lib/email.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ job: "send-onboarding-email" });

/**
 * Sends a reminder email to users who signed up 24+ hours ago
 * but haven't connected both Notion and WordPress yet.
 * Runs once per hour; only sends one email per tenant.
 */
export async function registerSendOnboardingEmailJob(boss: PgBoss, prisma: PrismaClient) {
  // Only send notification emails on the hosted version (Stripe configured)
  if (!config.STRIPE_SECRET_KEY) return;

  await boss.createQueue("send-onboarding-email");

  await boss.work("send-onboarding-email", async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Find tenants created >24h ago that are missing Notion or WordPress and haven't been emailed yet
    const tenants = await prisma.tenant.findMany({
      where: {
        createdAt: { lt: cutoff },
        onboardingEmailSentAt: null,
        OR: [
          { notionCredentials: null },
          { wordpressCredentials: null },
        ],
      },
      include: {
        users: {
          where: { role: "OWNER", emailVerified: true },
          select: { email: true, name: true },
        },
      },
    });

    let sent = 0;
    for (const tenant of tenants) {
      const owner = tenant.users[0];
      if (!owner) continue;

      const missingNotion = !tenant.notionCredentials;
      const missingWordpress = !tenant.wordpressCredentials;

      const steps: string[] = [];
      if (missingNotion) steps.push("connect Notion");
      if (missingWordpress) steps.push("connect WordPress");

      const frontendUrl = config.FRONTEND_URL || "https://notipo.com";
      const dashboardUrl = `${frontendUrl}/admin`;
      const ok = await sendEmail(
        owner.email,
        "Finish setting up Notipo — you're almost there",
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
          <p>Hi there,</p>
          <p>You signed up for Notipo but haven't finished setting up yet. You still need to <strong>${steps.join(" and ")}</strong> to start publishing from Notion to WordPress.</p>
          <p>It only takes a minute — WordPress connects with one click, and Notion is just a few steps.</p>
          <p style="margin:24px 0;">
            <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Finish Setup</a>
          </p>
          <p style="color:#666;font-size:13px;">If you have any questions, just reply to this email.</p>
          <p style="color:#888;font-size:12px;margin-top:32px;">— The Notipo Team</p>
        </div>`,
      );

      if (ok) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { onboardingEmailSentAt: new Date() },
        });
        sent++;
      }
    }

    if (sent > 0) {
      log.info({ count: sent }, "Sent onboarding reminder emails");
    }
  });

  // Run once per hour
  setInterval(() => {
    boss.send("send-onboarding-email", {}, { singletonKey: "send-onboarding-email" }).catch(() => {});
  }, 60 * 60 * 1000);

  await boss.send("send-onboarding-email", {}, { singletonKey: "send-onboarding-email" });
}
