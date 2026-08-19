import fp from "fastify-plugin";
import { toNodeHandler } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

/**
 * Mounts better-auth's Web handler on `/api/auth/*`. `reply.hijack()` hands the
 * raw socket to better-auth so Fastify does NOT parse the body or manage the
 * reply — required, because better-auth reads the raw request stream (and the
 * OAuth callback / cookie handling need the untouched response). `/api/auth/*`
 * is already exempt from the `x-api-key` hook in plugins/auth.ts, so the two
 * auth layers never collide.
 */
async function betterAuth(app: FastifyInstance) {
  const handler = toNodeHandler(auth);
  app.all("/api/auth/*", async (request, reply) => {
    reply.hijack();
    await handler(request.raw, reply.raw);
  });
}

export const betterAuthPlugin = fp(betterAuth, {
  name: "better-auth",
  dependencies: ["prisma"],
});
