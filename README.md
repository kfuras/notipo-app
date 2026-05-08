# Notipo

**Open-source WordPress publishing for writers, developers, and AI agents.**

Write in a clean markdown editor, sync from Notion, or hit a REST API / CLI / MCP server — Notipo handles the full pipeline: markdown → Gutenberg conversion, image hosting in your WordPress media library, AI- or Unsplash-generated featured images, and Rank Math / Yoast / SEOPress / AIOSEO metadata applied automatically on publish.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![npm: notipo CLI](https://img.shields.io/npm/v/notipo.svg?label=npm%20cli)](https://www.npmjs.com/package/notipo)
[![Hosted SaaS at notipo.com](https://img.shields.io/badge/hosted%20saas-notipo.com-A855F7)](https://notipo.com)
[![MCP Server](https://img.shields.io/badge/MCP-Server-FF4CE2)](https://notipo.com/docs/api/mcp)

---

## Three ways to publish to WordPress

### 1. The built-in markdown editor
Distraction-free editor with toolbar shortcuts, slash commands, drag-and-drop images, and one-click publish. No Notion required.

### 2. From Notion
Connect Notion, change a page status to `Post to Wordpress` or `Publish`, and Notipo handles the rest — markdown extraction, image caching to WP media library, featured image generation, SEO metadata via Rank Math / Yoast / SEOPress / AIOSEO.

### 3. From an AI agent, REST API, CLI, or n8n workflow
Notipo exposes a **Model Context Protocol (MCP) server** with 13 tools for AI agents, plus a REST API and a CLI. Claude Desktop, Cursor, Windsurf, Claude Code, ChatGPT — any MCP-compatible agent can publish posts end-to-end.

```bash
# CLI: publish a post end-to-end
npm install -g notipo
notipo posts create --title "Why Every Dev Should Have a Blog" --publish

# REST API: one call runs the full pipeline
curl -X POST https://notipo.com/api/posts/create \
  -H "X-API-Key: $NOTIPO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"## Intro\n\nMarkdown in, WordPress out.","publish":true}'
```

```jsonc
// MCP: drop into Claude Desktop config
{
  "mcpServers": {
    "notipo": {
      "type": "http",
      "url": "https://notipo.com/api/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

See **[notipo.com/ai-agents](https://notipo.com/ai-agents)** for the full AI-agent integration story.

---

## Hosted SaaS vs. self-hosting

The **hosted version at [notipo.com](https://notipo.com)** is the supported, batteries-included product — managed infrastructure, automatic upgrades, instant Notion webhook delivery, and a free tier with 5 posts/month. Pro is $19/month for unlimited posts plus AI featured images.

This repository is the same code that runs the hosted product. **You can self-host it** under the AGPL-3.0 license — see [DEVELOPMENT.md](DEVELOPMENT.md) for the local dev story and [docker-compose.yml](docker-compose.yml) for production deployment with Traefik + Let's Encrypt.

Self-hosting is unsupported — no help beyond what's in this repo, no upgrade path. If you need any of those, [the hosted product](https://notipo.com) is faster, cheaper, and already running.

---

## Tech stack

- **Backend:** Fastify, TypeScript, Prisma, PostgreSQL 17
- **Job queue:** [pg-boss](https://github.com/timgit/pg-boss) (Postgres-backed, no Redis)
- **Frontend (admin):** Next.js 16 + BlockNote editor + shadcn/ui + Tailwind
- **AI:** Google Gemini (featured images), [Model Context Protocol](https://modelcontextprotocol.io) (agent integration)
- **Other:** Sharp (images), Stripe (billing), Resend (transactional email), Sentry (errors), PostHog (product analytics), Notion SDK, WordPress REST API
- **CLI:** zero-dependency npm package, native fetch only

Monorepo (Turborepo + npm workspaces):
```
apps/
  api/     — Fastify backend, MCP server, job workers
  web/     — Next.js admin UI
packages/
  cli/     — `notipo` npm package (MIT-licensed thin client)
  shared/  — TypeScript types and enums
plugins/
  notipo-seo/  — WordPress plugin for Yoast/AIOSEO metadata bridge
```

---

## Quick start (self-host)

You'll need: Docker, Docker Compose, a domain pointed at your server, a Notion integration, and a WordPress site with [Application Passwords](https://wordpress.org/documentation/article/application-passwords/) enabled (WP 5.6+).

```bash
git clone https://github.com/kfuras/notipo-app.git
cd notipo
cp apps/api/.env.example .env
# Edit .env — at minimum set DATABASE_URL, ENCRYPTION_KEY, API_KEY
docker compose up -d
```

The compose stack starts Traefik + the API + admin UI + Postgres, with Let's Encrypt TLS on first run. See [docker-compose.yml](docker-compose.yml) for details.

For local development without Docker:

```bash
docker compose -f docker-compose.dev.yml up   # Postgres only
npm install
npm run migrate -w @notipo/api
turbo dev                                      # API on :3000, web on :3001
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.

---

## Documentation

- **API reference:** [notipo.com/docs/api/introduction](https://notipo.com/docs/api/introduction)
- **MCP server (13 tools):** [notipo.com/docs/api/mcp](https://notipo.com/docs/api/mcp)
- **CLI:** [notipo.com/docs/api/cli](https://notipo.com/docs/api/cli)
- **n8n integration:** [notipo.com/docs/api/n8n](https://notipo.com/docs/api/n8n)
- **All docs:** [notipo.com/docs](https://notipo.com/docs)
- **Architecture & development:** [DEVELOPMENT.md](DEVELOPMENT.md) and [.claude/CLAUDE.md](.claude/CLAUDE.md)

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0) — see [LICENSE](LICENSE).

In plain English:
- ✅ You can use, modify, and self-host Notipo for any purpose, including commercial.
- ✅ You can fork it and contribute changes back.
- ⚠️ If you run a modified version as a hosted service, you must publish your modifications under the same license. This is the "Affero clause" — it closes the network-service loophole that plain GPL leaves open.
- ✅ The `notipo` CLI package is published to npm under MIT (it's just a thin API client wrapper).
- ✅ The `notipo-seo` WordPress plugin is published under MIT (compatible with WordPress's GPL ecosystem).

If you want to use Notipo's code in a proprietary hosted product without AGPL obligations, [open an issue](https://github.com/kfuras/notipo-app/issues/new) — commercial licensing may be available.

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

For security disclosures, see [SECURITY.md](SECURITY.md) — please don't open public issues for vulnerabilities.

---

## Links

- **Hosted SaaS:** [notipo.com](https://notipo.com)
- **AI Agents:** [notipo.com/ai-agents](https://notipo.com/ai-agents)
- **Blog:** [notipo.com/blog](https://notipo.com/blog)
- **Twitter/X:** [@kjetilfuras](https://x.com/kjetilfuras)
