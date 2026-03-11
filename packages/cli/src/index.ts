#!/usr/bin/env node
import { readConfig, writeConfig, configPath, type Config } from "./config.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ── API client ────────────────────────────────────────────────────────────────

async function api<T>(config: Config, path: string, method = "GET", body?: unknown): Promise<T> {
  const url = `${config.url}${path}`;
  const res = await fetch(url, {
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
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new Error(`${res.status} ${msg || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const reset = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";
const purple = "\x1b[35m";

function color(s: string, c: string) {
  return `${c}${s}${reset}`;
}

function statusColor(status: string) {
  if (["PUBLISHED", "COMPLETED"].includes(status)) return color(status, green);
  if (["FAILED"].includes(status)) return color(status, red);
  if (["RUNNING"].includes(status)) return color(status, yellow);
  return color(status, dim);
}

function col(s: string, width: number) {
  return s.slice(0, width).padEnd(width);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdLogin() {
  const rl = readline.createInterface({ input, output });
  console.log(`\n${color("Notipo login", bold)}\n`);

  const url = (await rl.question(`  Instance URL ${dim}(default: https://notipo.com)${reset}: `)).trim() || "https://notipo.com";
  const apiKey = (await rl.question("  API key: ")).trim();
  rl.close();

  if (!apiKey) {
    console.error(color("\n  Error: API key is required.", red));
    process.exit(1);
  }

  // Validate by hitting /api/settings
  process.stdout.write("  Verifying... ");
  try {
    await api({ url, apiKey }, "/api/settings");
    writeConfig({ url, apiKey });
    console.log(`${color("✓", green)}\n`);
    console.log(`  Config saved to ${dim}${configPath()}${reset}`);
    console.log(`  Run ${color("notipo status", cyan)} to verify your connections.\n`);
  } catch (err) {
    console.log(color("✗", red));
    console.error(color(`\n  Could not connect: ${(err as Error).message}`, red));
    console.error(`  Check your instance URL and API key, then try again.\n`);
    process.exit(1);
  }
}

async function cmdStatus() {
  const config = readConfig();
  const data = await api<{
    notion?: { connected: boolean; databaseId?: string };
    wordpress?: { connected: boolean; siteUrl?: string };
  }>(config, "/api/settings");

  console.log(`\n${color("Connection status", bold)}\n`);
  console.log(`  Instance   ${dim}${config.url}${reset}`);

  const notion = data.notion;
  const wp = data.wordpress;

  const notionIcon = notion?.connected ? color("✓", green) : color("✗", red);
  const wpIcon = wp?.connected ? color("✓", green) : color("✗", red);

  console.log(`  Notion     ${notionIcon}  ${notion?.connected ? dim + (notion.databaseId ?? "") + reset : color("not connected", red)}`);
  console.log(`  WordPress  ${wpIcon}  ${wp?.connected ? dim + (wp.siteUrl ?? "") + reset : color("not connected", red)}`);
  console.log();
}

async function cmdSync() {
  const config = readConfig();
  process.stdout.write("  Triggering sync... ");
  await api(config, "/api/sync-now", "POST");
  console.log(color("✓", green));
  console.log(`\n  Run ${color("notipo jobs", cyan)} to monitor progress.\n`);
}

async function cmdPosts() {
  const config = readConfig();
  const data = await api<{
    posts: Array<{
      id: string;
      title: string;
      status: string;
      wpPostId?: number;
      wpUrl?: string;
      updatedAt: string;
    }>;
  }>(config, "/api/posts");

  const posts = data.posts ?? [];
  if (posts.length === 0) {
    console.log(`\n  ${dim}No posts yet.${reset}\n`);
    return;
  }

  console.log(`\n${color("Posts", bold)}\n`);
  console.log(`  ${dim}${col("TITLE", 40)} ${col("STATUS", 18)} ${col("WP ID", 8)} UPDATED${reset}`);
  console.log(`  ${dim}${"-".repeat(80)}${reset}`);

  for (const p of posts) {
    const updated = new Date(p.updatedAt).toLocaleDateString();
    const wpId = p.wpPostId ? String(p.wpPostId) : dim + "—" + reset;
    console.log(`  ${col(p.title || "—", 40)} ${col("", 0)}${statusColor(p.status).padEnd(18 + (statusColor(p.status).length - p.status.length))} ${col(wpId, 8)} ${dim}${updated}${reset}`);
  }
  console.log();
}

async function cmdJobs() {
  const config = readConfig();
  const data = await api<{
    jobs: Array<{
      id: string;
      type: string;
      status: string;
      postTitle?: string;
      steps?: string[];
      error?: string;
      startedAt: string;
    }>;
  }>(config, "/api/jobs");

  const jobs = data.jobs ?? [];
  if (jobs.length === 0) {
    console.log(`\n  ${dim}No jobs yet.${reset}\n`);
    return;
  }

  console.log(`\n${color("Recent jobs", bold)}\n`);

  for (const j of jobs) {
    const date = new Date(j.startedAt).toLocaleString();
    const type = j.type === "SYNC_POST" ? "sync" : "publish";
    console.log(`  ${statusColor(j.status)} ${color(type, cyan)}  ${dim}${j.postTitle ?? "—"}${reset}  ${dim}${date}${reset}`);
    if (j.steps && j.steps.length > 0) {
      for (const step of j.steps) {
        console.log(`    ${dim}· ${step}${reset}`);
      }
    }
    if (j.error) {
      console.log(`    ${color("! " + j.error, red)}`);
    }
  }
  console.log();
}

async function cmdPostsDelete(id: string) {
  const config = readConfig();
  if (!id) {
    console.error(color("  Usage: notipo posts delete <id>", red));
    process.exit(1);
  }
  process.stdout.write(`  Deleting post ${dim}${id}${reset}... `);
  await api(config, `/api/posts/${id}`, "DELETE");
  console.log(color("✓", green) + "\n");
}

function cmdHelp() {
  console.log(`
${color("notipo", bold)} — Notipo CLI

${color("Commands:", bold)}
  ${color("login", cyan)}               Authenticate and save your API key
  ${color("status", cyan)}              Show Notion and WordPress connection status
  ${color("sync", cyan)}                Trigger an immediate Notion poll
  ${color("posts", cyan)}               List all posts with status
  ${color("posts delete", cyan)} ${dim}<id>${reset}  Delete a post (cleans up WordPress + Notion)
  ${color("jobs", cyan)}                Show recent sync and publish jobs

${color("Examples:", bold)}
  ${dim}npx notipo login${reset}
  ${dim}npx notipo sync${reset}
  ${dim}npx notipo posts${reset}
  ${dim}npx notipo jobs${reset}
`);
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const [, , cmd, sub, arg] = process.argv;

try {
  if (cmd === "login") {
    await cmdLogin();
  } else if (cmd === "status") {
    await cmdStatus();
  } else if (cmd === "sync") {
    await cmdSync();
  } else if (cmd === "posts" && sub === "delete") {
    await cmdPostsDelete(arg);
  } else if (cmd === "posts") {
    await cmdPosts();
  } else if (cmd === "jobs") {
    await cmdJobs();
  } else {
    cmdHelp();
  }
} catch (err) {
  if (err instanceof Error && err.message.includes("No config")) {
    console.error(color(`\n  Not logged in. Run ${reset}${cyan}notipo login${reset}${red} first.\n`, red));
  } else {
    console.error(color(`\n  Error: ${(err as Error).message}\n`, red));
  }
  process.exit(1);
}
