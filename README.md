<p align="center">
  <a href="https://notipo.com">
    <img alt="Notipo" src="https://notipo.com/icon.svg" width="80" />
  </a>
</p>

<h1 align="center">Notipo</h1>

<p align="center">
  <strong>Publish blog posts from Notion to WordPress, automatically.</strong>
</p>

<p align="center">
  <a href="https://opensource.org/license/agpl-v3"><img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-20+-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Docker-ready-blue.svg" alt="Docker">
</p>

<p align="center">
  <a href="https://notipo.com/auth/register"><strong>Try the hosted version free for 7 days</strong></a> · <a href="https://notipo.com/docs"><strong>Docs</strong></a> · <a href="https://notipo.com/docs/self-hosting"><strong>Self-Hosting Guide</strong></a>
</p>

<br />

## About

Notipo lets you write blog posts in Notion and publish them to WordPress by changing a status. Images, SEO metadata, featured images, and code blocks are handled automatically. Self-host it on any VPS with Docker, or use the hosted version at [notipo.com](https://notipo.com).

Don't want to self-host? [Sign up for a free account](https://notipo.com/auth/register) — every new account gets a **7-day Pro trial** with all features, no credit card required.

## Features

<table>
<tr>
<td align="center"><img src="https://notipo.com/features/4-dashboard.gif" alt="Dashboard" width="400" /></td>
<td align="center"><img src="https://notipo.com/features/1-jobs.gif" alt="Jobs" width="400" /></td>
</tr>
<tr>
<td align="center"><img src="https://notipo.com/features/2-categories.gif" alt="Categories & Tags" width="400" /></td>
<td align="center"><img src="https://notipo.com/features/3-settings.gif" alt="Settings" width="400" /></td>
</tr>
</table>

- **Notion to WordPress sync** — change a status in Notion, post appears as a WordPress draft
- **Two-step publish** — review the draft in WordPress, then set "Publish" in Notion to go live
- **Content updates** — re-sync content from Notion without creating duplicates
- **Featured images** — auto-generated with your post title overlaid on a background (upload your own, Unsplash, or gradient fallback)
- **Inline images** — Notion images uploaded to your WordPress media library, URLs replaced automatically
- **SEO metadata** — Rank Math focus keyword, title, and description applied during sync
- **Code highlighting** — Prism.js or Highlight.js syntax blocks in your posts
- **Category and tag sync** — WordPress categories and tags imported into Notion as dropdown options
- **Webhook notifications** — Slack or Discord alerts when jobs fail
- **Multi-tenant** — run multiple blogs from a single instance

## How It Works

You write posts in Notion. When you change the status to "Post to Wordpress", Notipo converts the content to Gutenberg blocks, uploads images, generates a featured image, applies SEO metadata, and creates a WordPress draft. When you set the status to "Publish", the draft goes live. Use "Update Wordpress" to re-sync content — it only auto-publishes if the post is currently live.

Notion webhooks are the primary trigger. A safety-net poll runs every 5 minutes to catch missed events. If a job fails, the Notion status resets automatically so you can retry.

All credentials are encrypted in the database with AES-256-GCM. WordPress credentials are validated on save.

---

## Quick Start

The fastest way to try Notipo locally with Docker (no Node.js required):

```bash
git clone https://github.com/kfuras/notipo.git
cd notipo
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — set ENCRYPTION_KEY and API_KEY at minimum
docker compose -f docker-compose.dev.yml --profile full up --build
```

Open `http://localhost/admin` and register with your email and password. The first user becomes the owner — see [First-run setup](#first-run-setup) to connect Notion and WordPress.

---

## Documentation

- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Development — native Node](#development--native-node)
- [Development — local Docker](#development--local-docker-no-node-required)
- [Production — VPS self-hosted](#production--vps-self-hosted)
- [First-run setup](#first-run-setup)
- [Notion database setup](#notion-database-setup)
- [Admin UI](#admin-ui)
- [Tech stack](#tech-stack)

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 | Native dev only |
| Docker | 24 | All deployment modes |
| Docker Compose | v2 (`docker compose`) | Not v1 (`docker-compose`) |

---

## Environment variables

Copy the example file and fill in the values:

```bash
cp apps/api/.env.example apps/api/.env
```

**Required for all environments:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ENCRYPTION_KEY` | 64-char hex string — `openssl rand -hex 32` |
| `API_KEY` | Admin API key for `/api/admin/*` routes — `openssl rand -hex 16` |
| `ALLOW_SIGNUP` | Set to `true` for open registration (default: `false` — only the first user can register) |

**Notion OAuth** (optional — enables "Connect to Notion" button):

| Variable | Description |
|----------|-------------|
| `NOTION_OAUTH_CLIENT_ID` | From your Notion public integration |
| `NOTION_OAUTH_CLIENT_SECRET` | From your Notion public integration |
| `NOTION_OAUTH_REDIRECT_URI` | `https://yourdomain.com/api/notion/oauth/callback` |
| `NOTION_WEBHOOK_SECRET` | HMAC secret for webhook verification (from Notion integration settings) |
| `POLL_INTERVAL_SECONDS` | Safety-net poll interval in seconds (default: `300`) |

**Email (Resend)** (required for email verification and password reset):

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | Sender address (e.g. `noreply@yourdomain.com`) — verify your domain in Resend |
| `ADMIN_NOTIFY_EMAIL` | (Optional) Email address to notify when new users sign up |

**Unsplash** (optional — enhances featured image backgrounds):

| Variable | Description |
|----------|-------------|
| `UNSPLASH_ACCESS_KEY` | API key from [unsplash.com/developers](https://unsplash.com/developers) — when set, featured images use a relevant Unsplash photo instead of a plain gradient |

**Required for VPS deployment only:**

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Your public domain, e.g. `yourdomain.com` |
| `ACME_EMAIL` | Email for Let's Encrypt certificate notifications |
| `DB_PASSWORD` | Postgres password — `openssl rand -hex 16` |

**Seed variables** (development only — `npm run seed -w @notipo/api`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SEED_TENANT_NAME` | `Dev Tenant` | Display name for your blog |
| `SEED_TENANT_SLUG` | `dev` | URL-safe identifier |
| `SEED_OWNER_EMAIL` | `dev@notipo.local` | Your login email |
| `SEED_OWNER_PASSWORD` | _(none)_ | Set to log in with email/password instead of API key |
| `SEED_API_KEY` | falls back to `API_KEY` | Tenant API key for calling the API |
| `SEED_NOTION_TRIGGER_STATUS` | `Ready to Publish` | Notion status that triggers sync |

The seed is for local development only. In production, register your account through the admin UI instead — the first user becomes the owner automatically.

---

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
cp apps/api/.env.example apps/api/.env
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

---

## Development — local Docker (no Node required)

Runs the full production images locally. No Node, npm, or Prisma CLI needed on your machine.

**1. Copy and edit env:**

```bash
cp apps/api/.env.example apps/api/.env
# Fill in ENCRYPTION_KEY and API_KEY at minimum
```

**2. Build and start:**

```bash
docker compose -f docker-compose.dev.yml --profile full up --build
```

The admin UI is at `http://localhost/admin` (nginx proxies API requests to the backend).

On first start the API container runs database migrations automatically. Register with your email and password — the first user becomes the owner.

---

## Production — VPS self-hosted

Uses pre-built Docker images from GitHub Container Registry, Traefik as a reverse proxy, and automatic TLS via Let's Encrypt.

**Requirements:**
- A Linux VPS with Docker and Docker Compose installed
- A domain name with an A record pointing to the VPS IP
- Port 80 and 443 open in the firewall

**1. Clone the repo on the VPS:**

```bash
git clone https://github.com/kfuras/notipo.git
cd notipo
```

**2. Create and configure `.env`:**

```bash
cp apps/api/.env.example apps/api/.env
```

Set at minimum:

```
ENCRYPTION_KEY=<openssl rand -hex 32>
API_KEY=<openssl rand -hex 16>
DB_PASSWORD=<openssl rand -hex 16>
DOMAIN=yourdomain.com
ACME_EMAIL=you@example.com
```

**3. Start the stack:**

```bash
docker compose up -d
```

On first start, the app container runs `prisma migrate deploy` before the server starts. Check the logs if the health check fails:

```bash
docker logs notipo-app
```

**4. Register your account:**

Open `https://yourdomain.com/admin` and register with your email and password. The first user becomes the owner with full access — no email verification required.

**Updating to a new version:**

```bash
docker compose pull
docker compose up -d
```

To pin a specific version, replace `latest` with a version tag (e.g. `1.0.0`) in `docker-compose.yml`.

---

## First-run setup

After registering, you need to connect Notion and WordPress. An inline onboarding stepper on the dashboard guides you through three steps:

**Step 1 — Duplicate the Notion template:**
Open the [Notipo Blog Template](https://free-dentist-6b2.notion.site/30d842af972f8091a104eb8773fbf390?v=30d842af972f8091a104eb8773fbf390) and duplicate it to your workspace. This gives you a database with all required properties pre-configured. Confirm in the stepper once done.

**Step 2 — Connect Notion** (choose one):
- **OAuth** (recommended for hosted): Click "Connect to Notion" → authorize in Notion's consent screen → select the database you just duplicated. Credentials and database ID are configured automatically. Requires `NOTION_OAUTH_*` env vars.
- **Internal integration** (recommended for self-hosted): Click "Use manual token" in Settings, paste your integration token and database ID. See the [full step-by-step guide](https://notipo.com/docs/notion-setup#internal-integration) for creating the integration, configuring capabilities, sharing the database, and finding the database ID.

**Step 3 — Connect WordPress:**
- Site URL (e.g. `https://yourblog.com`)
- Username (your WordPress admin username, found under Users in WP admin)
- Application password (WP admin → Users → Profile → scroll to Application Passwords → enter a name like "Notipo" → click "Add New Application Password")

When you save WordPress credentials, all your WP categories and tags are automatically imported into Notipo and pushed to your Notion database as `Category` select and `Tags` multi-select options. They stay in sync — new categories or tags you create in WordPress are picked up every 60 seconds and appear in Notion automatically. You can also trigger a manual sync from the **Categories & Tags** page.

---

## Notion database setup

Start by duplicating the [Notipo Blog Template](https://free-dentist-6b2.notion.site/30d842af972f8091a104eb8773fbf390?v=30d842af972f8091a104eb8773fbf390) — it has all required properties pre-configured.

Your Notion database needs these properties:

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

The `Status` options are configurable per tenant — the names above are defaults. `Category` and `Tags` options are automatically synced from your WordPress site once you connect WP credentials. After syncing, the `WordPress Link` property is updated with the wp-admin edit URL for drafts, or the live frontend URL for published posts. If you delete a WP post and re-trigger "Post to Wordpress", a fresh draft is created automatically.

---

## Billing & Plans

When self-hosting, **all features are unlocked** with no restrictions — unlimited posts, featured images, webhooks, and instant sync. No billing configuration needed. New registrations automatically get the PRO plan when Stripe is not configured.

The hosted version at [notipo.com](https://notipo.com) offers a Free tier (5 posts/month) and a Pro plan ($19/month) with unlimited posts and all features.

---

## Admin UI

The admin UI is served at `/admin`. Login with email and password, or enter an API key directly.

New tenants see an onboarding stepper that guides them through connecting Notion and WordPress. The dashboard shows post status counts, recent jobs with live progress updates (via Server-Sent Events), and a "Sync Now" button for instant Notion polling.

Pages:

- **Dashboard** — post counts, recent jobs, config health check, instant sync
- **Posts** — full post list with status badges, WordPress links, categories
- **Categories & Tags** — auto-imported from WordPress, custom background images for featured image generation
- **Jobs** — background job log with error details and status filtering
- **Settings** — Notion connection, WordPress credentials, trigger statuses, code highlighter, webhook URL
- **Billing** — current plan, upgrade to Pro, manage subscription
- **Account** — profile, API key, change password, delete account
- **Tenants** — admin-only, create and manage tenants

Mobile-optimized: bottom navigation on phones, sidebar on desktop.

---

## Tech Stack

- **Backend:** [Fastify](https://fastify.dev), [Prisma](https://prisma.io), PostgreSQL, [pg-boss](https://github.com/timgit/pg-boss)
- **Frontend:** [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com)
- **Infrastructure:** Docker, [Traefik](https://traefik.io), nginx
- **Monorepo:** [Turborepo](https://turbo.build) + npm workspaces

---

## License

Copyright (C) 2026 Kjetil Furås

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
