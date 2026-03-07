# Development Guide

How to set up a local development environment for Notipo.

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 | Native dev only |
| Docker | 24 | All modes |
| Docker Compose | v2 (`docker compose`) | Not v1 (`docker-compose`) |

## Development — native Node

The fastest dev loop. Postgres runs in Docker; the app and web frontend run locally with hot reload.

**1. Start Postgres:**

```bash
docker compose -f docker-compose.dev.yml up -d
```

**2. Install dependencies (from monorepo root):**

```bash
npm install
```

**3. Copy and edit env:**

```bash
cp .env.example .env
# DATABASE_URL defaults to localhost:5432 — correct for this mode
```

**4. Run migrations and seed:**

```bash
npm run migrate -w @notipo/api
npm run seed -w @notipo/api
```

**5. Start all apps:**

```bash
turbo dev
```

Or start individually:

```bash
npm run dev -w @notipo/api    # API at http://localhost:3000
npm run dev -w @notipo/web    # Web at http://localhost:3001
```

The API is available at `http://localhost:3000`.
The admin UI is at `http://localhost:3001/admin`.

## Development — local Docker (no Node required)

Runs the full production images locally. No Node, npm, or Prisma CLI needed on your machine.

**1. Copy and edit env:**

```bash
cp .env.example .env
# Fill in ENCRYPTION_KEY and API_KEY at minimum
```

**2. Build and start:**

```bash
docker compose -f docker-compose.dev.yml --profile full up --build
```

The admin UI is at `http://localhost/admin` (nginx proxies API requests to the backend).

On first start the API container runs database migrations automatically. Register with your email and password — the first user becomes the owner.

## Environment Variables

All environment variables are documented in [`.env.example`](.env.example) with inline comments. Copy it and fill in the values:

```bash
cp .env.example .env
```

**Minimum required:** `ENCRYPTION_KEY` and `API_KEY`. Everything else is optional or has sensible defaults.

## First-Run Setup

After registering, an onboarding stepper on the dashboard guides you through three steps:

1. **Duplicate the Notion template** — [Notipo Blog Template](https://free-dentist-6b2.notion.site/30d842af972f8091a104eb8773fbf390?v=30d842af972f8091a104eb8773fbf390) gives you a database with all required properties pre-configured.

2. **Connect Notion** (choose one):
   - **OAuth** (requires `NOTION_OAUTH_*` env vars): Click "Connect to Notion" → authorize → select your database.
   - **Internal integration**: Click "Use manual token", paste your integration token and database ID. See the [Notion setup guide](https://notipo.com/docs/notion-setup).

3. **Connect WordPress**: Site URL, username, and application password. See the [WordPress setup guide](https://notipo.com/docs/wordpress-setup).

## Notion Database Properties

Start by duplicating the [Notipo Blog Template](https://free-dentist-6b2.notion.site/30d842af972f8091a104eb8773fbf390?v=30d842af972f8091a104eb8773fbf390) — it has all required properties pre-configured.

| Property | Type | Notes |
|----------|------|-------|
| Name | Title | Post title (default Notion title column) |
| Status | Select | Options: `Post to Wordpress`, `Publish`, `Update Wordpress`, `Ready to Review`, `Published` |
| Category | Select | Auto-populated from WordPress categories |
| Tags | Multi-select | Auto-populated from WordPress tags |
| Slug | Text | URL slug for the WordPress post |
| Featured Image Title | Text | Text overlay on the featured image (defaults to post title if blank) |
| SEO Keyword | Text | Rank Math focus keyword |
| WordPress Link | URL | Auto-filled with the WP post URL after sync/publish |

The `Status` options are configurable per tenant. `Category` and `Tags` are automatically synced from WordPress.

## Project Structure

```
apps/api/          — Fastify backend (TypeScript), Prisma + PostgreSQL, pg-boss job queue
apps/web/          — Next.js frontend (admin UI, auth + dashboard)
packages/shared/   — Shared TypeScript types and enums
```

## Useful Commands

```bash
turbo build                        # Build all packages
turbo test                         # Run all tests
npm test -w @notipo/api            # Run API tests only
npm run migrate -w @notipo/api     # Run migrations (dev)
npm run seed -w @notipo/api        # Seed dev data
npm run generate -w @notipo/api    # Regenerate Prisma client
```
