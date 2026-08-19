import fp from "fastify-plugin";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { prisma as client } from "../lib/prisma.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prisma(app: FastifyInstance) {
  // Shared singleton (lib/prisma.ts) — better-auth uses the same pool.
  await client.$connect();
  app.decorate("prisma", client);

  app.addHook("onClose", async () => {
    await client.$disconnect();
  });
}

export const prismaPlugin = fp(prisma, { name: "prisma" });
