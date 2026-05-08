import type { PgBoss } from "pg-boss";
import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger.js";

export async function registerCheckTrialsJob(boss: PgBoss, prisma: PrismaClient) {
  await boss.createQueue("check-trials");

  await boss.work("check-trials", async () => {
    const expired = await prisma.tenant.updateMany({
      where: {
        plan: "TRIAL",
        trialEndsAt: { lt: new Date() },
      },
      data: { plan: "FREE" },
    });

    if (expired.count > 0) {
      logger.info({ count: expired.count }, "Downgraded expired trial tenants to FREE");
    }
  });

  // Run once per hour
  setInterval(() => {
    boss.send("check-trials", {}, { singletonKey: "check-trials" }).catch(() => {});
  }, 60 * 60 * 1000);

  await boss.send("check-trials", {}, { singletonKey: "check-trials" });
}
