#!/usr/bin/env node
import { readConfig, type Config } from "./config.js";

// ── API client ────────────────────────────────────────────────────────────────

async function api<T>(config: Config, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch {}
    throw new Error(`${res.status} ${msg || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function err(message: string, detail?: unknown) {
  console.error(JSON.stringify({ error: message, ...(detail ? { detail } : {}) }, null, 2));
  process.exit(1);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStatus(config: Config) {
  const data = await api<{
    notion?: { connected: boolean; databaseId?: string };
    wordpress?: { connected: boolean; siteUrl?: string };
  }>(config, "/api/settings");
  out({ notion: data.notion, wordpress: data.wordpress });
}

async function cmdSync(config: Config) {
  await api(config, "/api/sync-now", "POST");
  out({ ok: true, message: "Sync triggered. Run `notipo jobs` to monitor progress." });
}

async function cmdPosts(config: Config) {
  const data = await api<{
    posts: Array<{
      id: string;
      title: string;
      status: string;
      wpPostId?: number;
      wpUrl?: string;
      notionPageId?: string;
      updatedAt: string;
    }>;
  }>(config, "/api/posts");
  out(data.posts ?? []);
}

async function cmdJobs(config: Config) {
  const data = await api<{
    jobs: Array<{
      id: string;
      type: string;
      status: string;
      postTitle?: string;
      steps?: string[];
      error?: string;
      startedAt: string;
      completedAt?: string;
    }>;
  }>(config, "/api/jobs");
  out(data.jobs ?? []);
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
      "posts delete <id>": "Delete a post (cleans up WordPress + Notion)",
      jobs: "List recent sync and publish jobs",
    },
    config: {
      env: "NOTIPO_URL and NOTIPO_API_KEY environment variables",
      file: "~/.notipo/config.json (written by `notipo login` if using the interactive wrapper)",
    },
    examples: [
      "NOTIPO_URL=https://notipo.com NOTIPO_API_KEY=ntp_... notipo sync",
      "notipo posts",
      "notipo jobs",
    ],
  });
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const [, , cmd, sub, arg] = process.argv;

if (!cmd || cmd === "help") {
  cmdHelp();
  process.exit(0);
}

try {
  const config = readConfig();

  if (cmd === "status") {
    await cmdStatus(config);
  } else if (cmd === "sync") {
    await cmdSync(config);
  } else if (cmd === "posts" && sub === "delete") {
    await cmdPostsDelete(config, arg);
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
