import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Liveness — proves Node is running and answering, nothing more.
   *
   * This route used to run `select 1` so the uptime monitor would notice a
   * database outage. A serverless Postgres suspends its compute after a few
   * idle minutes, and a monitor querying it every minute keeps it awake — and
   * billable — around the clock. The database check now lives at /health/db,
   * for callers that poll it at a cadence the compute can sleep between.
   */
  app.get("/health", { config: { rawBody: false } }, async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  /**
   * Readiness — `select 1` against the database, 503 when it fails.
   *
   * 503 rather than 200-with-a-flag, because the monitor reads the status code
   * first. Nothing restarts on it: Fly runs no checks against this path, and
   * the compose healthcheck watches postgres directly. Every call wakes a
   * suspended compute for several minutes, so poll it hourly, not per minute.
   */
  app.get("/health/db", { config: { rawBody: false } }, async (_request, reply) => {
    const timestamp = new Date().toISOString();

    // DISCOVERY_ONLY boots without the database plugins so MCP catalogs can
    // scan the tool list from a container that has no Postgres. There is
    // nothing to check there, and a scanner should not meet a 503.
    if (!app.hasDecorator("prisma")) {
      return { status: "ok", database: "not configured", timestamp };
    }

    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok", timestamp };
    } catch (err) {
      app.log.error({ err }, "Health check could not reach the database");
      return reply
        .code(503)
        .send({ status: "error", database: "unreachable", timestamp });
    }
  });
}
