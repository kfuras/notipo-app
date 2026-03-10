/**
 * Register all pg-boss job handlers and cron schedules.
 */

import type PgBoss from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import type { EventEmitter } from "events";
import { registerSyncPostJob } from "./sync-post.job.js";
import { registerPublishPostJob } from "./publish-post.job.js";
import { registerPollNotionJob } from "./poll-notion.job.js";
import { registerCheckTrialsJob } from "./check-trials.job.js";
import { registerSendOnboardingEmailJob } from "./send-onboarding-email.job.js";
import { registerSendTrialExpiryEmailJob } from "./send-trial-expiry-email.job.js";
import { resetNotionStatusForFailedJobs } from "./reset-notion-status.js";
import { logger } from "../lib/logger.js";

export async function registerAllJobs(boss: PgBoss, prisma: PrismaClient, eventBus: EventEmitter) {
  // Mark any RUNNING jobs as FAILED — they were interrupted by a server restart
  const stale = await prisma.job.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", error: "Interrupted by server restart" },
  });
  if (stale.count > 0) {
    logger.warn({ count: stale.count }, "Marked stale RUNNING jobs as FAILED on startup");
    await resetNotionStatusForFailedJobs(prisma);
  }

  await registerSyncPostJob(boss, prisma, eventBus);
  await registerPublishPostJob(boss, prisma, eventBus);
  await registerPollNotionJob(boss, prisma);
  await registerCheckTrialsJob(boss, prisma);
  await registerSendOnboardingEmailJob(boss, prisma);
  await registerSendTrialExpiryEmailJob(boss, prisma);

  // Periodically fail jobs stuck in RUNNING for more than 5 minutes
  setInterval(async () => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await prisma.job.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      data: { status: "FAILED", error: "Timed out after 5 minutes" },
    });
    if (stuck.count > 0) {
      logger.warn({ count: stuck.count }, "Marked timed-out RUNNING jobs as FAILED");
      await resetNotionStatusForFailedJobs(prisma);
    }
  }, 60 * 1000);

  logger.info("All job handlers registered");
}
