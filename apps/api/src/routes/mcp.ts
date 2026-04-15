import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { logger } from "../lib/logger.js";

/**
 * MCP (Model Context Protocol) server endpoint.
 *
 * Exposes Notipo's API as MCP tools so AI agents (Claude Desktop, Cursor, etc.)
 * can create, publish, and manage WordPress posts through Notipo.
 *
 * Auth: same x-api-key header as the REST API.
 * Transport: Streamable HTTP (stateless, one McpServer per request).
 */
export async function mcpRoutes(app: FastifyInstance) {
  /**
   * Build an McpServer with tenant context captured via closure.
   * Created per-request so each tool handler has access to the authenticated tenant.
   */
  function createMcpServer(tenantId: string, apiKey: string) {
    const mcp = new McpServer({
      name: "notipo",
      version: "1.0.0",
    });

    // Helper: delegate to the existing REST API via Fastify's inject()
    async function callApi(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
      const opts: Record<string, unknown> = {
        method,
        url,
        headers: { "x-api-key": apiKey },
      };
      if (payload !== undefined) opts.payload = payload;
      const response = await app.inject(opts as any);
      return { statusCode: response.statusCode, body: JSON.parse(response.body) };
    }

    // ── list_posts ──────────────────────────────────────────────────────
    mcp.registerTool("list_posts", {
      title: "List Posts",
      description: "List all posts for your Notipo account. Returns title, status, WordPress URL, category, and timestamps.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async () => {
      const posts = await app.prisma.post.findMany({
        where: { tenantId },
        orderBy: { updatedAt: "desc" },
        include: { category: true },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(posts.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            wpUrl: p.wpUrl,
            category: p.category?.name ?? null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })), null, 2),
        }],
      };
    });

    // ── get_post ────────────────────────────────────────────────────────
    mcp.registerTool("get_post", {
      title: "Get Post",
      description: "Get details of a specific post by ID, including status, WordPress URL, and category.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async ({ postId }) => {
      const post = await app.prisma.post.findFirst({
        where: { id: postId, tenantId },
        include: { category: true },
      });
      if (!post) {
        return { content: [{ type: "text" as const, text: "Post not found" }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: post.id,
            title: post.title,
            status: post.status,
            wpPostId: post.wpPostId,
            wpUrl: post.wpUrl,
            notionPageId: post.notionPageId,
            category: post.category?.name ?? null,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
          }, null, 2),
        }],
      };
    });

    // ── create_post ─────────────────────────────────────────────────────
    mcp.registerTool("create_post", {
      title: "Create Post",
      description:
        "Create a new blog post. Creates a Notion page and triggers sync to WordPress. " +
        "The body should be markdown. Set publish=true to publish immediately, or leave false to create a draft.",
      inputSchema: z.object({
        title: z.string().describe("Post title"),
        body: z.string().optional().describe("Post content in markdown"),
        category: z.string().optional().describe("Category name"),
        tags: z.array(z.string()).optional().describe("Tag names"),
        seoKeyword: z.string().optional().describe("SEO focus keyword"),
        slug: z.string().optional().describe("Custom URL slug"),
        publish: z.boolean().optional().default(false).describe("Publish immediately (true) or create as draft (false)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async (args) => {
      const { statusCode, body } = await callApi("POST", "/api/posts/create", args);
      if (statusCode >= 400) {
        return { content: [{ type: "text" as const, text: `Error: ${body.error || body.message}` }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Post created. Job ID: ${body.data.jobId}. Notion page: ${body.data.notionPageId}. Use get_job to monitor sync progress.`,
        }],
      };
    });

    // ── update_post ─────────────────────────────────────────────────────
    mcp.registerTool("update_post", {
      title: "Update Post",
      description:
        "Update an existing post's content or properties in Notion, then re-sync to WordPress. " +
        "Only provided fields are updated.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to update"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New content in markdown (replaces entire body)"),
        category: z.string().optional().describe("New category name"),
        tags: z.array(z.string()).optional().describe("New tag names"),
        seoKeyword: z.string().optional().describe("New SEO focus keyword"),
        slug: z.string().optional().describe("New URL slug"),
        publish: z.boolean().optional().describe("Set true to also publish after updating"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async ({ postId, ...rest }) => {
      const { statusCode, body } = await callApi("PATCH", `/api/posts/${postId}`, rest);
      if (statusCode >= 400) {
        return { content: [{ type: "text" as const, text: `Error: ${body.error || body.message}` }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Post updated. Job ID: ${body.data.jobId}. Re-sync to WordPress queued.`,
        }],
      };
    });

    // ── publish_post ────────────────────────────────────────────────────
    mcp.registerTool("publish_post", {
      title: "Publish Post",
      description: "Publish a draft post to WordPress (make it live).",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to publish"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async ({ postId }) => {
      const { statusCode, body } = await callApi("POST", `/api/posts/${postId}/publish`);
      if (statusCode >= 400) {
        return { content: [{ type: "text" as const, text: `Error: ${body.error || body.message}` }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Publish job queued. Job ID: ${body.data.jobId}. Use get_job to monitor progress.`,
        }],
      };
    });

    // ── delete_post ─────────────────────────────────────────────────────
    mcp.registerTool("delete_post", {
      title: "Delete Post",
      description: "Delete a post from Notipo, WordPress, and reset the Notion page status. This cannot be undone.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to delete"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, async ({ postId }) => {
      const { statusCode, body } = await callApi("DELETE", `/api/posts/${postId}`);
      if (statusCode >= 400) {
        return { content: [{ type: "text" as const, text: `Error: ${body.error || body.message}` }], isError: true };
      }
      return {
        content: [{ type: "text" as const, text: "Post deleted." }],
      };
    });

    // ── list_categories ─────────────────────────────────────────────────
    mcp.registerTool("list_categories", {
      title: "List Categories",
      description: "List all WordPress categories synced to Notipo. Use these names when creating posts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async () => {
      const categories = await app.prisma.category.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(categories.map((c) => ({ id: c.id, name: c.name, wpCategoryId: c.wpCategoryId })), null, 2),
        }],
      };
    });

    // ── list_tags ───────────────────────────────────────────────────────
    mcp.registerTool("list_tags", {
      title: "List Tags",
      description: "List all WordPress tags synced to Notipo. Use these names when creating posts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async () => {
      const tags = await app.prisma.tag.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(tags.map((t) => ({ id: t.id, name: t.name, wpTagId: t.wpTagId })), null, 2),
        }],
      };
    });

    // ── get_job ─────────────────────────────────────────────────────────
    mcp.registerTool("get_job", {
      title: "Get Job Status",
      description:
        "Check the status of a sync or publish job. Returns status (PENDING, RUNNING, COMPLETED, FAILED), " +
        "progress steps, and any error message.",
      inputSchema: z.object({
        jobId: z.string().describe("The job ID returned from create_post, update_post, or publish_post"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async ({ jobId }) => {
      const job = await app.prisma.job.findFirst({
        where: { id: jobId, tenantId },
        include: {
          post: { select: { id: true, title: true, status: true, wpUrl: true } },
        },
      });
      if (!job) {
        return { content: [{ type: "text" as const, text: "Job not found" }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: job.id,
            type: job.type,
            status: job.status,
            error: job.error,
            result: job.result,
            post: job.post,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
          }, null, 2),
        }],
      };
    });

    // ── list_jobs ───────────────────────────────────────────────────────
    mcp.registerTool("list_jobs", {
      title: "List Recent Jobs",
      description: "List recent sync and publish jobs. Useful for monitoring pipeline activity.",
      inputSchema: z.object({
        status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).optional().describe("Filter by job status"),
        limit: z.number().min(1).max(50).optional().default(10).describe("Number of jobs to return (default 10)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async ({ status, limit }) => {
      const jobs = await app.prisma.job.findMany({
        where: { tenantId, ...(status && { status }) },
        orderBy: { createdAt: "desc" },
        take: limit ?? 10,
        select: {
          id: true,
          type: true,
          status: true,
          error: true,
          createdAt: true,
          completedAt: true,
          post: { select: { title: true } },
        },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(jobs, null, 2),
        }],
      };
    });

    // ── get_settings ────────────────────────────────────────────────────
    mcp.registerTool("get_settings", {
      title: "Get Settings",
      description:
        "Get your Notipo account configuration: which services are connected (Notion, WordPress), " +
        "current plan, feature settings, and trigger statuses.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async () => {
      const { body } = await callApi("GET", "/api/settings");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
      };
    });

    // ── sync_now ────────────────────────────────────────────────────────
    mcp.registerTool("sync_now", {
      title: "Sync Now",
      description:
        "Trigger an immediate sync from Notion. Checks for any posts with trigger statuses and queues sync jobs. " +
        "Pro plan only. Has a 15-second cooldown between calls.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async () => {
      const { statusCode, body } = await callApi("POST", "/api/sync-now");
      if (statusCode >= 400) {
        return { content: [{ type: "text" as const, text: `Error: ${body.error || body.message}` }], isError: true };
      }
      return {
        content: [{ type: "text" as const, text: "Sync triggered. Posts with trigger statuses will be processed." }],
      };
    });

    return mcp;
  }

  // ── POST /mcp ───────────────────────────────────────────────────────
  // Stateless: one McpServer + transport per request, auth checked before handling.
  app.post("/mcp", async (request, reply) => {
    const apiKey =
      (request.headers["x-api-key"] as string | undefined) ||
      (request.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");

    if (!apiKey) {
      return reply.code(401).send({ error: "Missing authentication. Provide x-api-key header or Authorization: Bearer <key>." });
    }

    const user = await app.prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, tenant: { select: { id: true } } },
    });

    if (!user) {
      return reply.code(401).send({ error: "Invalid API key" });
    }

    const mcp = createMcpServer(user.tenant.id, apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);

    reply.raw.on("close", () => {
      transport.close();
    });

    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // GET /mcp — SSE streaming not supported in stateless mode
  app.get("/mcp", async (_request, reply) => {
    reply.code(405).send({ error: "SSE not supported in stateless mode. Use POST /mcp." });
  });

  // DELETE /mcp — session termination not needed in stateless mode
  app.delete("/mcp", async (_request, reply) => {
    reply.code(405).send({ error: "Session management not supported in stateless mode." });
  });

  logger.info("MCP server registered at POST /mcp");
}
