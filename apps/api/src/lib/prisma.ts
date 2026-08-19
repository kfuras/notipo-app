import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Single shared PrismaClient (one connection pool). Both the Fastify `prisma`
 * plugin and better-auth (`lib/auth.ts`) import this so there is exactly one
 * pool. better-auth needs a client at module-load time, before the Fastify app
 * exists, which is why the client lives here rather than only on `app.prisma`.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["error"],
});
