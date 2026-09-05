import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Liveness for the monitor, not just for the process.
   *
   * This used to return a static ok, which proved only that Node was running
   * and answering. The uptime monitor watching it would therefore stay green
   * through a database outage — the one failure that takes the product down
   * without taking the server down. A `select 1` closes that gap.
   *
   * 503 rather than 200-with-a-flag, because the monitor reads the status code
   * first. Nothing restarts on it: Fly runs no checks against this path, and
   * the compose healthcheck watches postgres directly.
   */
  app.get("/health", { config: { rawBody: false } }, async (_request, reply) => {
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
