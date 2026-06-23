import Fastify from "fastify";
import { Sentry } from "./sentry.js";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { ZodError } from "zod";
import { config } from "./config.js";
import { getPostHogServer, shutdownPostHogServer } from "./lib/posthog-server.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { pgBossPlugin } from "./plugins/pg-boss.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { postRoutes } from "./routes/posts.js";
import { categoryRoutes } from "./routes/categories.js";
import { settingsRoutes } from "./routes/settings.js";
import { jobRoutes } from "./routes/jobs.js";
import { adminRoutes } from "./routes/admin.js";
import { userRoutes } from "./routes/users.js";
import { eventBusPlugin } from "./plugins/event-bus.js";
import { eventsRoutes } from "./routes/events.js";
import { notionWebhookRoutes } from "./routes/notion-webhook.js";
import { notionOAuthRoutes } from "./routes/notion-oauth.js";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";
import { billingRoutes } from "./routes/billing.js";
import { accountRoutes } from "./routes/account.js";
import { importRoutes } from "./routes/import.js";
import { mcpRoutes } from "./routes/mcp.js";
import { uploadRoutes } from "./routes/uploads.js";
import { templateRoutes } from "./routes/templates.js";
import { registerAllJobs } from "./jobs/index.js";

/**
 * Discovery-only mode: skip every plugin that needs an external service
 * (Postgres for Prisma + pg-boss, the job runner, the event bus, the
 * auth plugin) and mount only the MCP route + health check. The MCP
 * route's introspection methods (tools/list, initialize, etc.) are
 * static and return tool schemas without touching the database, so an
 * MCP catalog like Glama can boot the container with no env vars,
 * confirm the server actually exposes tools, and assign a quality
 * score. Tool *execution* still fails fast in this mode because the
 * handlers reach for app.prisma which is not decorated — which is the
 * correct behaviour, since there is no real backend to execute against.
 */
const DISCOVERY_ONLY = process.env.DISCOVERY_ONLY === "true";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === "development" && {
        transport: { target: "pino-pretty" },
      }),
    },
  });

  // Convert ZodError validation failures to 400 Bad Request
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
    }
    Sentry.captureException(error);
    const distinctId = (request as any).user?.id ?? "unknown";
    getPostHogServer()?.captureException(error, distinctId);
    throw error; // let Fastify handle everything else
  });

  app.addHook("onClose", async () => {
    await shutdownPostHogServer();
  });

  // Security headers
  app.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    done(null, payload);
  });

  // Plugins
  await app.register(cors, {
    origin: config.FRONTEND_URL
      ? [config.FRONTEND_URL, "http://localhost:3001"]
      : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(sensible);
  await app.register(rateLimit, {
    global: false,
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  // Serve user-uploaded category images from local disk (self-hosted mode, no GCS)
  if (!config.GCS_BUCKET) {
    const fs = await import("node:fs/promises");
    const uploadsRoot = path.join(process.cwd(), "uploads", "category-images");
    await fs.mkdir(uploadsRoot, { recursive: true });
    await app.register(fastifyStatic, {
      root: uploadsRoot,
      prefix: "/api/uploads/category-images/",
      decorateReply: false,
      wildcard: true,
    });
  }
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), "public", "category-images"),
    prefix: "/api/default-category-images/",
    decorateReply: false,
    wildcard: true,
  });

  if (DISCOVERY_ONLY) {
    // Minimal surface for MCP catalog introspection — see DISCOVERY_ONLY
    // comment at the top of this file.
    await app.register(healthRoutes);
    await app.register(mcpRoutes);
    return app;
  }

  await app.register(prismaPlugin);
  await app.register(pgBossPlugin);
  await app.register(authPlugin);
  await app.register(eventBusPlugin);

  // Jobs
  await registerAllJobs(app.boss, app.prisma, app.eventBus);

  // Routes
  await app.register(healthRoutes);
  await app.register(eventsRoutes);
  await app.register(postRoutes);
  await app.register(categoryRoutes);
  await app.register(settingsRoutes);
  await app.register(jobRoutes);
  await app.register(adminRoutes);
  await app.register(userRoutes);
  await app.register(notionWebhookRoutes);
  await app.register(notionOAuthRoutes);
  await app.register(authRoutes);
  await app.register(syncRoutes);
  await app.register(billingRoutes);
  await app.register(accountRoutes);
  await app.register(importRoutes);
  await app.register(mcpRoutes);
  await app.register(uploadRoutes);
  await app.register(templateRoutes);

  return app;
}
