import fp from "fastify-plugin";
import { PgBoss } from "pg-boss";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    boss: PgBoss;
  }
}

async function pgBoss(app: FastifyInstance) {
  const boss = new PgBoss(config.DATABASE_URL);

  boss.on("error", (error) => {
    app.log.error(error, "pg-boss error");
  });

  await boss.start();
  app.decorate("boss", boss);

  app.addHook("onClose", async () => {
    await boss.stop();
  });

  app.log.info("pg-boss started");
}

export const pgBossPlugin = fp(pgBoss, {
  name: "pg-boss",
  dependencies: ["prisma"],
});
