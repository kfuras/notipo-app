import type PgBoss from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import type { EventEmitter } from "events";
import { SyncService } from "../services/sync.service.js";
import { canSyncPost } from "../lib/plan-limits.js";
import { sendWebhook } from "../lib/webhook.js";
import { logger } from "../lib/logger.js";

interface DirectPublishPayload {
  tenantId: string;
  title: string;
  markdown: string;
  category?: string;
  tags?: string[];
  seoKeyword?: string;
  seoDescription?: string;
  featuredImageTitle?: string;
  slug?: string;
  publish?: boolean;
}

export async function registerDirectPublishJob(boss: PgBoss, prisma: PrismaClient, eventBus: EventEmitter) {
  await boss.createQueue("direct-publish");
  await boss.work<DirectPublishPayload>("direct-publish", { batchSize: 1 }, async (jobs) => {
    const job = jobs[0];
    const { tenantId, publish, ...input } = job.data;
    const log = logger.child({ jobId: job.id, tenantId, title: input.title });

    log.info("Starting direct publish");

    // Check plan limits
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true, trialEndsAt: true },
    });
    const check = await canSyncPost(prisma, tenantId, tenant.plan, tenant.trialEndsAt);
    if (!check.allowed) {
      log.warn({ tenantId }, check.reason);
      throw new Error(check.reason);
    }

    // Track in jobs table
    const dbJob = await prisma.job.create({
      data: {
        tenantId,
        type: "DIRECT_PUBLISH",
        status: "RUNNING",
        payload: job.data as object,
        pgBossJobId: job.id,
        startedAt: new Date(),
      },
    });

    eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "DIRECT_PUBLISH", status: "RUNNING" });

    try {
      const syncService = new SyncService(prisma);
      const syncSteps: string[] = [];
      const onStep = async (step: string) => {
        if (!syncSteps.includes(step)) syncSteps.push(step);
        await prisma.job.update({ where: { id: dbJob.id }, data: { result: { step, steps: syncSteps } } });
        eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "DIRECT_PUBLISH", status: "RUNNING", step });
      };

      const { postId } = await syncService.syncDirect(tenantId, input, onStep);

      // Build result summary
      const post = await prisma.post.findFirst({
        where: { id: postId, tenantId },
        select: {
          wpPostId: true, wpUrl: true, status: true,
          category: { select: { name: true } },
          _count: { select: { imageMappings: true } },
        },
      });

      await prisma.job.update({
        where: { id: dbJob.id },
        data: {
          postId,
          status: "COMPLETED",
          completedAt: new Date(),
          result: {
            steps: syncSteps,
            category: post?.category?.name ?? null,
            images: post?._count.imageMappings ?? 0,
            wpPostId: post?.wpPostId ?? null,
            wpUrl: post?.wpUrl ?? null,
            postStatus: post?.status ?? null,
          },
        },
      });

      eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "DIRECT_PUBLISH", status: "COMPLETED", postId });

      if (publish) {
        await boss.send("publish-post", { tenantId, postId }, { singletonKey: `publish:${postId}` });
        log.info({ postId }, "Direct publish sync completed, publish enqueued");
      } else {
        log.info({ postId }, "Direct publish sync completed (draft)");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, `Direct publish failed: ${message}`);

      await prisma.job.update({
        where: { id: dbJob.id },
        data: { status: "FAILED", error: message },
      });

      eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "DIRECT_PUBLISH", status: "FAILED" });

      sendWebhook(prisma, tenantId, { jobType: "DIRECT_PUBLISH", status: "FAILED", postTitle: input.title, error: message });

      throw error;
    }
  });
}
