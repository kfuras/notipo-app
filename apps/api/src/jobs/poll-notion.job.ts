import type { PgBoss } from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import { pollTenant } from "../lib/poll-tenant.js";
import { getPollInterval } from "../lib/plan-limits.js";
import { logger } from "../lib/logger.js";

// Track per-tenant last poll time for plan-based interval enforcement
const lastPolledAt = new Map<string, number>();

export async function registerPollNotionJob(boss: PgBoss, prisma: PrismaClient) {
  await boss.createQueue("poll-notion");

  // Register the handler
  await boss.work("poll-notion", async () => {
    const log = logger.child({ job: "poll-notion" });

    // Get all tenants with Notion configured
    const tenants = await prisma.tenant.findMany({
      where: {
        notionCredentials: { not: null },
        notionDatabaseId: { not: null },
      },
    });

    const now = Date.now();
    for (const tenant of tenants) {
      // Enforce per-tenant poll interval based on plan
      const intervalMs = getPollInterval(tenant.plan, tenant.trialEndsAt) * 1000;
      const last = lastPolledAt.get(tenant.id) ?? 0;
      if (now - last < intervalMs) {
        log.debug({ tenantId: tenant.id, intervalMs }, "Skipping tenant — too soon");
        continue;
      }

      try {
        await pollTenant(boss, prisma, tenant);
        lastPolledAt.set(tenant.id, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ tenantId: tenant.id, error: message }, "Notion poll failed for tenant");
      }
    }
  });

  // Global tick every 60s — per-tenant intervals enforced inside handler
  const TICK_MS = 60_000;
  setInterval(() => {
    boss.send("poll-notion", {}, { singletonKey: "poll-notion" }).catch((err: unknown) => {
      logger.error({ err }, "Failed to enqueue poll-notion job");
    });
  }, TICK_MS);

  // Kick off an immediate first poll on startup
  await boss.send("poll-notion", {}, { singletonKey: "poll-notion" });

  logger.info("Notion polling scheduled (60s tick, per-tenant intervals by plan)");
}
