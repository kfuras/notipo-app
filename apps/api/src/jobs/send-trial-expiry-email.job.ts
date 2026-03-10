import type PgBoss from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import { sendEmail } from "../lib/email.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ job: "send-trial-expiry-email" });

/**
 * Sends a notification email to trial users whose trial ends within 2 days.
 * Runs once per hour; only sends one email per tenant.
 */
export async function registerSendTrialExpiryEmailJob(boss: PgBoss, prisma: PrismaClient) {
  // Only send notification emails on the hosted version (Stripe configured)
  if (!config.STRIPE_SECRET_KEY) return;

  await boss.createQueue("send-trial-expiry-email");

  await boss.work("send-trial-expiry-email", async () => {
    const now = new Date();
    const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    // Find trial tenants expiring within 2 days that haven't been emailed yet
    const tenants = await prisma.tenant.findMany({
      where: {
        plan: "TRIAL",
        trialEndsAt: { lte: twoDaysFromNow, gt: now },
        trialExpiryEmailSentAt: null,
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

      const daysLeft = Math.ceil(
        (tenant.trialEndsAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      const dayWord = daysLeft === 1 ? "day" : "days";

      const frontendUrl = config.FRONTEND_URL || "https://notipo.com";
      const billingUrl = `${frontendUrl}/admin/billing`;
      const ok = await sendEmail(
        owner.email,
        `Your Notipo Pro trial ends in ${daysLeft} ${dayWord}`,
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
          <p>Hi there,</p>
          <p>Your Notipo Pro trial ends in <strong>${daysLeft} ${dayWord}</strong>. After that, your account will switch to the Free plan (5 posts/month, no featured images).</p>
          <p>To keep unlimited posts, Unsplash featured images, and instant sync, upgrade to Pro for $19/month.</p>
          <p style="margin:24px 0;">
            <a href="${billingUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Upgrade to Pro</a>
          </p>
          <p style="color:#666;font-size:13px;">Not ready to upgrade? No worries — your account stays active on the Free plan. You can upgrade anytime.</p>
          <p style="color:#888;font-size:12px;margin-top:32px;">— The Notipo Team</p>
        </div>`,
      );

      if (ok) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { trialExpiryEmailSentAt: new Date() },
        });
        sent++;
      }
    }

    if (sent > 0) {
      log.info({ count: sent }, "Sent trial expiry notification emails");
    }
  });

  // Run once per hour
  setInterval(() => {
    boss.send("send-trial-expiry-email", {}, { singletonKey: "send-trial-expiry-email" }).catch(() => {});
  }, 60 * 60 * 1000);

  await boss.send("send-trial-expiry-email", {}, { singletonKey: "send-trial-expiry-email" });
}
