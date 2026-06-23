/**
 * Standalone stdio MCP server for catalog introspection (Glama, Smithery,
 * mcp.so, etc.). Registers the same 13 tool schemas as the live HTTP
 * route at POST /api/mcp so a catalog can clone the repo, run this file,
 * and confirm the server exposes real tools — then assign a quality
 * score.
 *
 * Why this exists separately from routes/mcp.ts:
 *
 * - Catalog services do not build the project's production Dockerfile.
 *   They use their own image (Debian + Node + mcp-proxy), git-clone the
 *   repo, run user-supplied build steps, then run user-supplied CMD.
 *   Crucially they only support stdio MCP servers — the CMD cannot be
 *   an HTTP URL.
 * - The HTTP route's tool handlers reach for app.prisma, app.inject(),
 *   and a Fastify lifecycle. None of that exists in a stdio context
 *   without a real Postgres + the full API surface — which a catalog
 *   container does not have.
 * - This file therefore registers the same tool *schemas* (so tools/list
 *   returns 13 entries) but the handlers stub out: any actual call says
 *   "use the hosted HTTP endpoint at notipo.com/api/mcp instead". The
 *   only message a catalog ever sends is tools/list, so the stubs are
 *   defensive — they never run in catalog flows.
 *
 * Keep the tool schemas in sync with routes/mcp.ts. The full handler
 * implementations live there.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOSTED_ENDPOINT = "https://notipo.com/api/mcp";

function notSupported(): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Tool execution is not available over the stdio transport. ` +
          `Use the hosted Streamable HTTP endpoint at ${HOSTED_ENDPOINT} ` +
          `with the x-api-key header set to your Notipo API key. ` +
          `Docs: https://notipo.com/ai-agents`,
      },
    ],
    isError: true,
  };
}

async function main() {
  const mcp = new McpServer({ name: "notipo", version: "1.2.3" });

  mcp.registerTool(
    "list_posts",
    {
      title: "List Posts",
      description:
        "List all posts for your Notipo account. Returns title, status, WordPress URL, category, and timestamps.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "get_post",
    {
      title: "Get Post",
      description:
        "Get details of a specific post by ID, including status, WordPress URL, and category.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "create_post",
    {
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
        seoDescription: z
          .string()
          .max(160)
          .optional()
          .describe(
            "Custom meta description for SEO (max 160 chars). Auto-derived from content if not set.",
          ),
        slug: z.string().optional().describe("Custom URL slug"),
        publish: z
          .boolean()
          .optional()
          .default(false)
          .describe("Publish immediately (true) or create as draft (false)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "direct_publish",
    {
      title: "Direct Publish",
      description:
        "Publish a blog post directly to WordPress without Notion. " +
        "Handles image uploads, Gutenberg conversion, featured image generation, and SEO metadata. " +
        "Body must be markdown. Set publish=true to go live, false for draft. " +
        "Use this instead of create_post when you don't need Notion.",
      inputSchema: z.object({
        title: z.string().describe("Post title"),
        body: z.string().describe("Post content in markdown (required)"),
        category: z.string().optional().describe("Category name"),
        tags: z.array(z.string()).optional().describe("Tag names"),
        seoKeyword: z.string().optional().describe("SEO focus keyword"),
        seoDescription: z
          .string()
          .max(160)
          .optional()
          .describe("Custom meta description for SEO (max 160 chars)"),
        imageTitle: z
          .string()
          .optional()
          .describe("Featured image title/text overlay"),
        slug: z.string().optional().describe("Custom URL slug"),
        publish: z
          .boolean()
          .optional()
          .default(false)
          .describe("Publish immediately (true) or create as draft (false)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "update_post",
    {
      title: "Update Post",
      description:
        "Update an existing post's content or properties in Notion, then re-sync to WordPress. " +
        "Only provided fields are updated.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to update"),
        title: z.string().optional().describe("New title"),
        body: z
          .string()
          .optional()
          .describe("New content in markdown (replaces entire body)"),
        category: z.string().optional().describe("New category name"),
        tags: z.array(z.string()).optional().describe("New tag names"),
        seoKeyword: z.string().optional().describe("New SEO focus keyword"),
        seoDescription: z
          .string()
          .max(160)
          .optional()
          .describe("New meta description for SEO (max 160 chars)"),
        slug: z.string().optional().describe("New URL slug"),
        publish: z
          .boolean()
          .optional()
          .describe("Set true to also publish after updating"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "publish_post",
    {
      title: "Publish Post",
      description: "Publish a draft post to WordPress (make it live).",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to publish"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "delete_post",
    {
      title: "Delete Post",
      description:
        "Delete a post from Notipo, WordPress, and reset the Notion page status. This cannot be undone.",
      inputSchema: z.object({
        postId: z.string().describe("The post ID to delete"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "list_categories",
    {
      title: "List Categories",
      description:
        "List all WordPress categories synced to Notipo. Use these names when creating posts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "list_tags",
    {
      title: "List Tags",
      description:
        "List all WordPress tags synced to Notipo. Use these names when creating posts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "get_job",
    {
      title: "Get Job Status",
      description:
        "Check the status of a sync or publish job. Returns status (PENDING, RUNNING, COMPLETED, FAILED), " +
        "progress steps, and any error message.",
      inputSchema: z.object({
        jobId: z
          .string()
          .describe(
            "The job ID returned from create_post, update_post, or publish_post",
          ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "list_jobs",
    {
      title: "List Recent Jobs",
      description:
        "List recent sync and publish jobs. Useful for monitoring pipeline activity.",
      inputSchema: z.object({
        status: z
          .enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"])
          .optional()
          .describe("Filter by job status"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Number of jobs to return (default 10)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "get_settings",
    {
      title: "Get Settings",
      description:
        "Get your Notipo account configuration: which services are connected (Notion, WordPress), " +
        "current plan, feature settings, and trigger statuses.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => notSupported(),
  );

  mcp.registerTool(
    "sync_now",
    {
      title: "Sync Now",
      description:
        "Trigger an immediate sync from Notion. Checks for any posts with trigger statuses and queues sync jobs. " +
        "Pro plan only. Has a 15-second cooldown between calls.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => notSupported(),
  );

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // Important: log to stderr only. stdout is reserved for MCP protocol
  // frames when using stdio transport.
  process.stderr.write(
    `notipo stdio MCP server connected. 13 tools registered. ` +
      `Tool execution disabled in this transport — use ${HOSTED_ENDPOINT} for live calls.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
