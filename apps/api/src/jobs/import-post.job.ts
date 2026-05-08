import type { PgBoss } from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import type { EventEmitter } from "events";
import { ImportService } from "../services/import.service.js";
import { sendWebhook } from "../lib/webhook.js";
import { logger } from "../lib/logger.js";

interface ImportPostPayload {
  tenantId: string;
  wpPostId: number;
  overwrite?: boolean;
  wpCategoryMap?: Record<number, string>;
  wpTagMap?: Record<number, string>;
}

export async function registerImportPostJob(boss: PgBoss, prisma: PrismaClient, eventBus: EventEmitter) {
  await boss.createQueue("import-post");
  await boss.work<ImportPostPayload>("import-post", { batchSize: 1 }, async (jobs) => {
    const job = jobs[0];
    const { tenantId, wpPostId, overwrite = false, wpCategoryMap, wpTagMap } = job.data;
    const log = logger.child({ jobId: job.id, tenantId, wpPostId });

    log.info("Starting WordPress post import");

    const dbJob = await prisma.job.create({
      data: {
        tenantId,
        type: "IMPORT_POST",
        status: "RUNNING",
        payload: job.data as object,
        pgBossJobId: job.id,
        startedAt: new Date(),
      },
    });

    eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "IMPORT_POST", status: "RUNNING" });

    try {
      const importService = new ImportService(prisma);
      const importSteps: string[] = [];
      const onStep = async (step: string) => {
        if (!importSteps.includes(step)) importSteps.push(step);
        await prisma.job.update({ where: { id: dbJob.id }, data: { result: { step, steps: importSteps } } });
        eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "IMPORT_POST", status: "RUNNING", step });
      };

      const result = await importService.importPost(
        tenantId, wpPostId, overwrite, onStep, wpCategoryMap, wpTagMap,
      );

      await prisma.job.update({
        where: { id: dbJob.id },
        data: {
          postId: result.postId,
          status: "COMPLETED",
          completedAt: new Date(),
          result: {
            steps: importSteps,
            title: result.title,
            notionPageId: result.notionPageId,
            skipped: result.skipped || false,
          },
        },
      });

      eventBus.emit("job:update", {
        tenantId, jobId: dbJob.id, type: "IMPORT_POST", status: "COMPLETED",
        postId: result.postId,
      });

      log.info({ postId: result.postId, skipped: result.skipped }, "WordPress post import completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, `WordPress post import failed: ${message}`);

      await prisma.job.update({
        where: { id: dbJob.id },
        data: { status: "FAILED", error: message },
      });

      eventBus.emit("job:update", { tenantId, jobId: dbJob.id, type: "IMPORT_POST", status: "FAILED" });

      sendWebhook(prisma, tenantId, { jobType: "IMPORT_POST", status: "FAILED", error: message });

      throw error;
    }
  });
}
