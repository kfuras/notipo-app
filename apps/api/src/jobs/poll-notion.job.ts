import type { PgBoss } from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import { pollTenant } from "../lib/poll-tenant.js";
import { getPollInterval } from "../lib/plan-limits.js";
import { logger } from "../lib/logger.js";

// Track per-tenant last poll time for plan-based interval enforcement
const lastPolledAt = new Map<string, number>();

export async function registerPollNotionJob(boss: PgBoss, prisma: PrismaClient) {
  // pg-boss v12 enforces singleton/dedup via the QUEUE POLICY — the send-time
  // `singletonKey` below silently no-ops on a 'standard' queue (v9 behaviour changed).
  // 'stately' allows at most one poll-notion job per state (queued + active), so the
  // 60s tick + startup send can't pile up. Without this the backlog OOM-crashes the
  // worker on startup. retryLimit 0: a missed poll just runs on the next tick.
  // (Existing prod queues are migrated to 'stately' directly in the DB — pg-boss v12's
  // updateQueue cannot change policy, and createQueue no-ops on an existing queue.)
  await boss.createQueue("poll-notion", { policy: "stately", retryLimit: 0, expireInSeconds: 120 });

  // Register the handler
  await boss.work("poll-notion", { pollingIntervalSeconds: 30 }, async () => {
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

  // Global tick — per-tenant intervals are enforced inside the handler, and
  // every plan currently gates polling at 300s. A 60s tick therefore woke the
  // database five times for every time a tenant could actually be polled: four
  // of five ticks queried the tenants, found all of them "too soon", and did
  // nothing. Matching the tick to the interval it enforces removes that waste
  // without changing how often any tenant is polled.
  const TICK_MS = 300_000;
  setInterval(() => {
    boss.send("poll-notion", {}, { singletonKey: "poll-notion" }).catch((err: unknown) => {
      logger.error({ err }, "Failed to enqueue poll-notion job");
    });
  }, TICK_MS);

  // Kick off an immediate first poll on startup
  await boss.send("poll-notion", {}, { singletonKey: "poll-notion" });

  logger.info("Notion polling scheduled (60s tick, per-tenant intervals by plan)");
}
