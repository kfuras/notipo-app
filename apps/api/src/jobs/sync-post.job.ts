import type PgBoss from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import type { EventEmitter } from "events";
import { SyncService } from "../services/sync.service.js";
import { NotionService } from "../services/notion.service.js";
import { CredentialService } from "../services/credential.service.js";
import { canSyncPost } from "../lib/plan-limits.js";
import { sendWebhook } from "../lib/webhook.js";
import { logger } from "../lib/logger.js";

interface SyncPostPayload {
  tenantId: string;
  notionPageId: string;
  thenPublish?: boolean;
  forcePublish?: boolean;
}

export async function registerSyncPostJob(boss: PgBoss, prisma: PrismaClient, eventBus: EventEmitter) {
  await boss.createQueue("sync-post");
  await boss.work<SyncPostPayload>("sync-post", { batchSize: 1 }, async (jobs) => {
    const job = jobs[0];
    const { tenantId, notionPageId } = job.data;
    const { thenPublish, forcePublish } = job.data;
    const log = logger.child({ jobId: job.id, tenantId, notionPageId });

    log.info("Starting post sync");

    // Check plan limits — only for new posts (not re-syncs)
    const existingPost = await prisma.post.findUnique({
      where: { tenantId_notionPageId: { tenantId, notionPageId } },
      select: { id: true },
    });
    if (!existingPost) {
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { plan: true, trialEndsAt: true },
      });
      const check = await canSyncPost(prisma, tenantId, tenant.plan, tenant.trialEndsAt);
      if (!check.allowed) {
        log.warn({ tenantId }, check.reason);
        throw new Error(check.reason);
      }
    }

    // Track in jobs table
    const dbJob = await prisma.job.create({
      data: {
        tenantId,
        postId: existingPost?.id,
        type: "SYNC_POST",
        status: "RUNNING",
        payload: job.data as object,
        pgBossJobId: job.id,
        startedAt: new Date(),
      },
    });

    eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "SYNC_POST", status: "RUNNING", notionPageId });

    try {
      const syncService = new SyncService(prisma);
      const syncSteps: string[] = [];
      const onStep = async (step: string) => {
        if (!syncSteps.includes(step)) syncSteps.push(step);
        await prisma.job.update({ where: { id: dbJob.id }, data: { result: { step, steps: syncSteps } } });
        eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "SYNC_POST", status: "RUNNING", notionPageId, step });
      };
      const { postId, wpStatus, wasPublished } = await syncService.syncPost(tenantId, notionPageId, onStep);

      // Build result summary from the synced post
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

      eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "SYNC_POST", status: "COMPLETED", postId, notionPageId });

      if (thenPublish) {
        // Auto-publish if:
        // - forcePublish is set (user triggered "Publish" — always publish even if WP post is a draft)
        // - WP post is already live (re-sync of published post)
        // - Post was previously published in our DB (prior sync may have reverted WP to draft)
        // - Brand new post (wpStatus is null) — user triggered "Publish" directly
        if (forcePublish || wpStatus === "publish" || wasPublished || wpStatus === null) {
          await boss.send("publish-post", { tenantId, postId }, { singletonKey: `publish:${postId}` });
          log.info({ postId, wpStatus, wasPublished }, "Post sync completed, publish enqueued");
        } else {
          // Draft re-sync where WP post exists as draft: revert status
          await prisma.post.update({ where: { id: postId }, data: { status: "SYNCED" } });
          log.info({ postId, wpStatus }, "Post sync completed, skipping auto-publish (WP post is draft)");
        }
      } else {
        log.info({ postId }, "Post sync completed, awaiting Publish trigger");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, `Post sync failed: ${message}`);

      await prisma.job.update({
        where: { id: dbJob.id },
        data: { status: "FAILED", error: message },
      });

      eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "SYNC_POST", status: "FAILED" });

      // Mark post as FAILED if it exists
      await prisma.post
        .update({
          where: { tenantId_notionPageId: { tenantId, notionPageId } },
          data: { status: "FAILED" },
        })
        .catch(() => undefined); // post may not exist yet if failure was early

      // Reset Notion status so the page isn't stuck on "Syncing"
      try {
        const credService = new CredentialService(prisma);
        const creds = await credService.getNotionCredentials(tenantId);
        if (creds) {
          const notion = new NotionService(creds.accessToken);
          await notion.updatePageStatus(notionPageId, "Sync Failed");
        }
      } catch (notionErr) {
        log.warn({ error: notionErr }, "Failed to reset Notion status after sync failure");
      }

      // Send webhook notification
      const failedPost = await prisma.post.findUnique({
        where: { tenantId_notionPageId: { tenantId, notionPageId } },
        select: { title: true },
      });
      sendWebhook(prisma, tenantId, { jobType: "SYNC_POST", status: "FAILED", postTitle: failedPost?.title, error: message });

      throw error; // pg-boss will retry
    }
  });
}
