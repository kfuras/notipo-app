import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

/**
 * Mounts better-auth on `/api/auth/*`.
 *
 * We do NOT use `toNodeHandler(request.raw)` + `reply.hijack()`: Fastify's JSON
 * content-type parser has already consumed the request stream by the time the
 * route handler runs, so better-auth would see an empty body and reject every
 * POST (sign-in, sign-up, social) with a validation error. Instead we
 * reconstruct a Web `Request` from the already-parsed Fastify request and call
 * better-auth's Web `auth.handler` directly, then translate the `Response` back
 * onto the Fastify reply (preserving multiple Set-Cookie headers).
 *
 * `/api/auth/*` is already exempt from the `x-api-key` hook in plugins/auth.ts.
 */
async function betterAuth(app: FastifyInstance) {
  app.all("/api/auth/*", async (request, reply) => {
    const host = (request.headers["x-forwarded-host"] as string) || request.headers.host || "app.notipo.com";
    const url = new URL(request.url, `https://${host}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value == null) continue;
      // content-length is recomputed from the re-serialized body below.
      if (key.toLowerCase() === "content-length") continue;
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.append(key, value);
    }

    const method = request.method.toUpperCase();
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD" && request.body != null) {
      body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    }

    const response = await auth.handler(new Request(url.toString(), { method, headers, body }));

    reply.status(response.status);
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return; // handled separately (may be multiple)
      reply.header(key, value);
    });
    for (const cookie of setCookies) reply.header("set-cookie", cookie);

    const text = await response.text();
    reply.send(text.length ? text : null);
  });
}

export const betterAuthPlugin = fp(betterAuth, {
  name: "better-auth",
  dependencies: ["prisma"],
});
