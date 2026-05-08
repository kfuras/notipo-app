#!/usr/bin/env node
import { readConfig, type Config } from "./config.js";

// ── API client ────────────────────────────────────────────────────────────────

async function api<T>(config: Config, path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-API-Key": config.apiKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${config.url}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch {}
    throw new Error(`${res.status} ${msg || res.statusText}`);
  }

  const json = await res.json() as { data?: T } | T;
  // Unwrap Notipo's { data: ... } envelope if present
  if (json !== null && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function err(message: string, detail?: unknown): never {
  console.error(JSON.stringify({ error: message, ...(detail ? { detail } : {}) }, null, 2));
  process.exit(1);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStatus(config: Config) {
  const data = await api<{
    notion?: { configured: boolean; databaseId?: string };
    wordpress?: { configured: boolean; siteUrl?: string };
    plan?: string;
    effectivePlan?: string;
  }>(config, "/api/settings");
  out(data);
}

async function cmdSync(config: Config) {
  await api(config, "/api/sync-now", "POST");
  out({ ok: true, message: "Sync triggered. Run `notipo jobs` to monitor progress." });
}

async function cmdPosts(config: Config) {
  const posts = await api<Array<{
    id: string;
    title: string;
    status: string;
    wpPostId?: number;
    wpUrl?: string;
    notionPageId?: string;
    updatedAt: string;
  }>>(config, "/api/posts");
  out(posts ?? []);
}

async function cmdJobs(config: Config) {
  const jobs = await api<Array<{
    id: string;
    type: string;
    status: string;
    postTitle?: string;
    steps?: string[];
    error?: string;
    startedAt: string;
    completedAt?: string;
  }>>(config, "/api/jobs");
  out(jobs ?? []);
}

async function cmdPostsCreate(config: Config, args: string[]) {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  const title = get("--title");
  if (!title) err("Missing --title. Usage: notipo posts create --title \"My Post\" [options]");

  const body: Record<string, unknown> = { title };
  const bodyText = get("--body"); if (bodyText) body.body = bodyText;
  const category = get("--category"); if (category) body.category = category;
  const tags = get("--tags"); if (tags) body.tags = (tags as string).split(",").map((t) => t.trim());
  const seoKeyword = get("--seo-keyword"); if (seoKeyword) body.seoKeyword = seoKeyword;
  const imageTitle = get("--image-title"); if (imageTitle) body.imageTitle = imageTitle;
  const slug = get("--slug"); if (slug) body.slug = slug;
  const excerpt = get("--excerpt"); if (excerpt) body.excerpt = excerpt;
  const scheduledAt = get("--schedule"); if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
  if (has("--sticky")) body.sticky = true;
  if (has("--no-comments")) body.commentStatus = "closed";
  if (has("--no-pingbacks")) body.pingStatus = "closed";
  if (has("--publish")) body.publish = true;

  const result = await api<{ jobId: string; notionPageId: string; message: string }>(
    config, "/api/posts/create", "POST", body
  );
  out(result);

  if (has("--wait")) {
    process.stderr.write("Waiting for job to complete...\n");
    type Job = { id: string; type: string; pgBossJobId?: string; postId?: string; status: string; result?: unknown; error?: string };
    let syncPostId: string | undefined;

    // Phase 1: wait for SYNC_POST to complete
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const jobs = await api<Job[]>(config, "/api/jobs");
      const job = jobs.find((j) => j.pgBossJobId === result.jobId);
      if (job?.status === "FAILED") { out(job); return; }
      if (job?.status === "COMPLETED") {
        syncPostId = job.postId;
        if (!has("--publish")) { out(job); return; }
        break;
      }
    }

    // Phase 2: if --publish, wait for the subsequent PUBLISH_POST job
    if (has("--publish") && syncPostId) {
      process.stderr.write("Waiting for publish to complete...\n");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const jobs = await api<Job[]>(config, "/api/jobs");
        const job = jobs.find((j) => j.type === "PUBLISH_POST" && j.postId === syncPostId);
        if (job?.status === "COMPLETED" || job?.status === "FAILED") { out(job); return; }
      }
    }

    err("Timed out waiting for job. Run `notipo jobs` to check status.");
  }
}

async function cmdPostsUpdate(config: Config, args: string[]) {
  const id = args[0];
  if (!id || id.startsWith("--")) err("Missing post ID. Usage: notipo posts update <id> [--title \"...\"] [--body \"...\"] [options]");

  const flagArgs = args.slice(1);
  const get = (flag: string) => {
    const i = flagArgs.indexOf(flag);
    return i !== -1 ? flagArgs[i + 1] : undefined;
  };
  const has = (flag: string) => flagArgs.includes(flag);

  const body: Record<string, unknown> = {};
  const title = get("--title"); if (title) body.title = title;
  const bodyText = get("--body"); if (bodyText) body.body = bodyText;
  const category = get("--category"); if (category) body.category = category;
  const tags = get("--tags"); if (tags) body.tags = (tags as string).split(",").map((t) => t.trim());
  const seoKeyword = get("--seo-keyword"); if (seoKeyword) body.seoKeyword = seoKeyword;
  const slug = get("--slug"); if (slug) body.slug = slug;
  const excerpt = get("--excerpt"); if (excerpt) body.excerpt = excerpt;
  const scheduledAt = get("--schedule"); if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
  if (has("--sticky")) body.sticky = true;
  if (has("--no-comments")) body.commentStatus = "closed";
  if (has("--no-pingbacks")) body.pingStatus = "closed";
  if (has("--publish")) body.publish = true;

  if (Object.keys(body).length === 0) err("Nothing to update. Pass at least one flag (--title, --body, --category, etc.)");

  const result = await api<{ jobId: string; postId: string; message: string }>(
    config, `/api/posts/${id}`, "PATCH", body
  );
  out(result);

  if (has("--wait")) {
    process.stderr.write("Waiting for sync to complete...\n");
    type Job = { id: string; type: string; pgBossJobId?: string; postId?: string; status: string; result?: unknown; error?: string };

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const jobs = await api<Job[]>(config, "/api/jobs");
      const job = jobs.find((j) => j.pgBossJobId === result.jobId);
      if (job?.status === "FAILED") { out(job); return; }
      if (job?.status === "COMPLETED") {
        if (!has("--publish")) { out(job); return; }
        // Wait for PUBLISH_POST
        process.stderr.write("Waiting for publish to complete...\n");
        for (let k = 0; k < 30; k++) {
          await new Promise((r) => setTimeout(r, 3000));
          const pJobs = await api<Job[]>(config, "/api/jobs");
          const pJob = pJobs.find((j) => j.type === "PUBLISH_POST" && j.postId === result.postId);
          if (pJob?.status === "COMPLETED" || pJob?.status === "FAILED") { out(pJob); return; }
        }
        break;
      }
    }
    err("Timed out waiting for job. Run `notipo jobs` to check status.");
  }
}

async function cmdPostsDelete(config: Config, id: string) {
  if (!id) err("Missing post ID. Usage: notipo posts delete <id>");
  await api(config, `/api/posts/${id}`, "DELETE");
  out({ ok: true, deleted: id });
}

function cmdHelp() {
  out({
    usage: "notipo <command> [args]",
    commands: {
      status: "Show Notion and WordPress connection status",
      sync: "Trigger an immediate Notion poll",
      posts: "List all posts",
      "posts create": "Create a post in Notion and sync to WordPress",
      "posts create --title <title> [--body <text>] [--category <cat>] [--tags <a,b>] [--seo-keyword <kw>] [--image-title <title>] [--publish] [--wait]": "",
      "posts update <id>": "Update a post's content/properties and re-sync to WordPress",
      "posts update <id> [--title <title>] [--body <text>] [--category <cat>] [--tags <a,b>] [--seo-keyword <kw>] [--slug <slug>] [--publish] [--wait]": "",
      "posts delete <id>": "Delete a post (cleans up WordPress + Notion)",
      jobs: "List recent sync and publish jobs",
    },
    config: {
      env: "NOTIPO_URL and NOTIPO_API_KEY environment variables",
      file: "~/.notipo/config.json (written by `notipo login` if using the interactive wrapper)",
    },
    examples: [
      "notipo posts create --title \"My Post\" --category \"AI\" --publish --wait",
      "NOTIPO_URL=https://notipo.com NOTIPO_API_KEY=ntp_... notipo sync",
      "notipo posts",
      "notipo jobs",
    ],
  });
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const [, , cmd, sub, ...rest] = process.argv;

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  cmdHelp();
  process.exit(0);
}

try {
  const config = readConfig();

  if (cmd === "status") {
    await cmdStatus(config);
  } else if (cmd === "sync") {
    await cmdSync(config);
  } else if (cmd === "posts" && sub === "create") {
    await cmdPostsCreate(config, rest);
  } else if (cmd === "posts" && sub === "update") {
    await cmdPostsUpdate(config, rest);
  } else if (cmd === "posts" && sub === "delete") {
    await cmdPostsDelete(config, rest[0]);
  } else if (cmd === "posts") {
    await cmdPosts(config);
  } else if (cmd === "jobs") {
    await cmdJobs(config);
  } else {
    err(`Unknown command: ${cmd}. Run \`notipo help\` for usage.`);
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("No config")) {
    err("Not authenticated. Set NOTIPO_URL and NOTIPO_API_KEY environment variables.");
  } else {
    err(msg);
  }
}
