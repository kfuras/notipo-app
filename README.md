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
  <a href="https://notipo.com/auth/register"><strong>Try it free</strong></a> · <a href="https://notipo.com/docs"><strong>Docs</strong></a> · <a href="https://notipo.com/docs/self-hosting"><strong>Self-Hosting</strong></a>
</p>

---

An open-source alternative to manual copy-paste, Zapier/n8n workflows, and WordPress plugins for publishing from Notion. Self-host it on any VPS with Docker, or use the hosted version at [notipo.com](https://notipo.com).

## Why Notipo?

- **Zero manual work** — change a status in Notion and your post appears in WordPress as a draft, with images uploaded, SEO metadata applied, and a featured image generated. No copy-pasting, no reformatting.
- **Your content stays yours** — self-host on your own server with all features unlocked. No vendor lock-in, no usage limits, no tracking.
- **Built for writers, not developers** — no Zapier workflows to maintain, no n8n nodes to configure, no WordPress plugins to keep updated. One setup, then it just works.
- **Handles the hard parts** — Notion image URLs expire after an hour. Notipo re-uploads every image to your WordPress media library so nothing breaks. Code blocks get proper syntax highlighting. SEO fields are filled automatically.

Don't want to self-host? [Sign up for a free account](https://notipo.com/auth/register) — every new account gets a **7-day Pro trial** with all features, no credit card required.

## Features

### Live Dashboard & Job Tracking

See all your posts at a glance with real-time status updates. The dashboard shows post counts, recent jobs with live progress via Server-Sent Events, and connection health for Notion and WordPress.

<p align="center">
  <img src="https://notipo.com/features/4-dashboard.gif" alt="Dashboard with live job tracking" width="700" />
</p>

### Job Monitoring & History

Every sync and publish action runs as a background job. Track progress in real time, filter by status, and inspect error details when something goes wrong.

<p align="center">
  <img src="https://notipo.com/features/1-jobs.gif" alt="Job monitoring and history" width="700" />
</p>

### Auto-Import Categories & Tags

WordPress categories and tags are automatically imported and pushed to your Notion database as select options. Upload custom background images per category for featured image generation.

<p align="center">
  <img src="https://notipo.com/features/2-categories.gif" alt="Categories and tags sync" width="700" />
</p>

### Settings & Code Highlighting

Connect Notion (OAuth or manual token), set WordPress credentials, choose your code highlighter (Prism.js, Highlight.js, or WordPress default), and configure Slack/Discord webhook notifications.

<p align="center">
  <img src="https://notipo.com/features/3-settings.gif" alt="Settings and code highlighting" width="700" />
</p>

### Everything else

- **Two-step publish** — review the draft in WordPress, then set "Publish" in Notion to go live
- **Content updates** — re-sync from Notion without creating duplicates
- **Featured images** — auto-generated with your post title on a background (upload your own, Unsplash, or gradient)
- **Inline images** — Notion images uploaded to your WordPress media library automatically
- **SEO metadata** — Rank Math focus keyword, title, and description applied during sync
- **Webhook notifications** — Slack or Discord alerts when jobs fail
- **Multi-tenant** — run multiple blogs from a single instance

## How It Works

1. **Write** your post in Notion
2. **Set the status** to "Post to Wordpress" — Notipo converts content to Gutenberg blocks, uploads images, generates a featured image, applies SEO metadata, and creates a WordPress draft
3. **Review** the draft in WordPress
4. **Set the status** to "Publish" — the draft goes live
5. **Update anytime** — set "Update Wordpress" to re-sync content from Notion

Notion webhooks are the primary trigger. A safety-net poll runs every 5 minutes to catch missed events. If a job fails, the Notion status resets automatically so you can retry.

All credentials are encrypted in the database with AES-256-GCM.

---

## Self-Hosting

When self-hosting, **all features are unlocked** — unlimited posts, featured images, webhooks, and instant sync. No billing or Stripe configuration needed.

```bash
git clone https://github.com/kfuras/notipo.git
cd notipo
cp .env.example .env
# Edit .env — set ENCRYPTION_KEY and API_KEY at minimum
docker compose up -d
```

Open `https://yourdomain.com/admin` and register. The first user becomes the owner with full access.

For the full self-hosting guide (requirements, environment variables, TLS setup, updating), see the **[Self-Hosting docs](https://notipo.com/docs/self-hosting)**.

For local development setup, see **[DEVELOPMENT.md](DEVELOPMENT.md)**.

---

## Tech Stack

- **Backend:** [Fastify](https://fastify.dev), [Prisma](https://prisma.io), PostgreSQL, [pg-boss](https://github.com/timgit/pg-boss)
- **Frontend:** [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com)
- **Infrastructure:** Docker, [Traefik](https://traefik.io), nginx
- **Monorepo:** [Turborepo](https://turbo.build) + npm workspaces

---

## License

Copyright (C) 2026 Kjetil Furas

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
