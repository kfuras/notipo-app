# Changelog

All notable changes to Notipo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

Each `## vX.Y.Z` section is extracted verbatim by `.github/workflows/release.yml` and posted as the GitHub release notes when the matching tag is pushed.

## v1.2.0

The largest Notipo release to date. Notipo is now open source under AGPL-3.0, you can write posts directly in the app without ever opening Notion, AI agents can publish through the new MCP server, and self-hosters get pre-built multi-arch Docker images.

### Open Source

The repository is now public at [github.com/kfuras/notipo-app](https://github.com/kfuras/notipo-app), licensed under AGPL-3.0. Multi-arch Docker images for self-hosters are published to `ghcr.io/kfuras/notipo-api` and `ghcr.io/kfuras/notipo-web` on each tagged release. The `SUPPORT_EMAIL` and `BRAND_NAME` environment variables let self-hosters rebrand transactional emails without forking the codebase.

The repo was renamed from `kfuras/notipo` to `kfuras/notipo-app` to make room for additional sibling projects. Old links continue to redirect.

### In-App Writer

A new `/admin/write` page brings post creation entirely inside Notipo. Notion is now optional, not required.

- Borderless title and body in a Notion/Gutenberg style
- Markdown formatting toolbar plus slash commands (type `/` at the start of a line)
- Image paste from clipboard and drag-and-drop, uploaded straight into the WordPress media library
- Keyboard shortcuts (Cmd/Ctrl+B, I, K), list continuation on Enter, Tab/Shift+Tab indentation
- Auto-save to localStorage with draft restore on reload
- Language selector for code blocks
- Edit any existing post from the Write page — `?id=<postId>` loads the post and updates in place
- WordPress connection warning banner when WP isn't configured

Onboarding now requires only WordPress; Notion moves to Settings as an optional power-user feature.

### MCP Server for AI Agents

Notipo now exposes a Model Context Protocol server at `POST /api/mcp` so Claude Desktop, Cursor, and custom AI agents can manage posts directly. Streamable HTTP transport, stateless, authenticated with the same API key used for the REST API.

13 tools are available: `list_posts`, `get_post`, `create_post`, `direct_publish`, `update_post`, `publish_post`, `delete_post`, `list_categories`, `list_tags`, `get_job`, `list_jobs`, `get_settings`, `sync_now`. Write operations delegate through the REST API so all plan checks, validation, and job queuing logic are reused.

### Direct Publish to WordPress

`POST /api/posts/direct` and the `direct_publish` MCP tool publish straight to WordPress without creating a Notion page. Useful for API, CLI, and AI-agent workflows where Notion isn't part of the pipeline. Markdown body is converted to Gutenberg blocks, optional featured image generation runs only when `imageTitle` is provided, and SEO metadata is applied via the detected SEO plugin.

### WordPress to Notion Import

The reverse direction — pull existing WordPress posts into Notion — is now supported (Pro feature). Detects already-imported posts, supports overwrite, imports SEO keywords from Rank Math/Yoast/AIOSEO/SEOPress, converts Gutenberg blocks to Markdown, and chunks Notion page children to respect the 100-block and 2000-char API limits.

### SEO-Aware FAQ Blocks

FAQ sections in markdown (H2/H3 "FAQ" or "Frequently Asked Questions" headings followed by Q&A pairs) are now converted to native FAQ blocks in WordPress: Rank Math `faq-block`, Yoast `faq-block`, or a plain `<details>` accordion fallback — chosen automatically based on the tenant's detected SEO plugin.

### AI-Generated Featured Images

A new `AI_GENERATED` featured image mode generates illustrations from the post title, category, tags, and the tenant's chosen `aiImageStyle` (e.g. "comic book", "watercolor"). Powered by the free Gemini 2.5 Flash Image model. Standard featured images now ship without text overlay for a cleaner default.

### CLI

- `notipo posts update <id>` — update an existing post from the command line
- `notipo --help` and `notipo -h` aliases work alongside `notipo help`
- Published as `notipo@1.1.2` on npm

### Observability

- Sentry error monitoring is wired up across the API and the admin UI
- PostHog is now proxied through `/ingest` to avoid Safari ITP blocking
- Security headers added across the API and the nginx layer

### Reliability

- Pasted images in the editor are guarded against null IDs and surface descriptive errors on upload failure
- Stale app shell cache is cleared on auth-state changes
- Auth state is cleared on logout/key changes to avoid cross-tenant bleed
- Featured image generation only runs for direct publish when `imageTitle` is provided
- Editing a post now updates rather than duplicating it
- API keys are hashed before being stored in localStorage
- WordPress redirect URLs are sanitized via the `URL` constructor
- `setApiKey` is awaited before redirecting after email verification, eliminating a race on slow connections

### Infrastructure

- Production deployment migrated from Fly.io to Google Cloud Run (`notipo-prod`, `europe-west4`)
- Category image uploads moved to Google Cloud Storage with signed URLs and a 365-day lifecycle
- Docker images are now built in GitHub Actions instead of Cloud Build, with multi-arch support (`linux/amd64`, `linux/arm64`) for self-hosters
- Workload Identity Federation for keyless GitHub Actions auth to GCP
- Prisma migrations run via a dedicated Cloud Run job (`notipo-migrate`) before each API deploy

### CI Quality

- CodeQL security scanning, weekly Dependabot updates, and stale-issue/PR cleanup
- Auto-merge for Dependabot PRs is restricted to `semver-minor` and `semver-patch` only
- `actionlint` validates GitHub Actions workflows on every PR
- A nightly CLI smoke test catches regressions in the published `notipo` npm package

### Major Dependency Updates

- Prisma upgraded to v7 (the API Dockerfile was updated to copy the new client output paths from the workspace `node_modules`)
- `pg-boss` upgraded to v12 (job-queue schema is migrated automatically on first start of the new image)
- Next.js, Fastify, and Hono updated to patch security advisories

## v1.1.4

### Post Deletion

Delete posts directly from the dashboard. Notipo cleans up the WordPress post, featured image, all inline images from the media library, and resets the Notion page status back to Draft.

### Two-Step Publish Fix

The two-step workflow (Post to WordPress → review → Publish) now works correctly. Previously, the Publish trigger would skip publishing if the WordPress post was still a draft. A new `forcePublish` flag ensures the Publish trigger always publishes, while Update WordPress retains the smart behavior (only auto-publishes if the WP post is already live).

### Job Step Tracking

Sync and publish jobs now persist every step (Fetching from Notion, Processing images, Creating WP draft, etc.) in the job result. The Jobs page shows a collapsible step list for completed and failed jobs — previously steps were only visible while a job was running. Each job tracks only its own steps for a clean view.

### Other Improvements

- Orphaned featured images are cleaned up when a WordPress post is trashed or deleted externally
- Publish trigger always re-syncs content from Notion before publishing
- Sync jobs now link to the post record at creation time (fixes missing post name on Jobs page for re-syncs)
- Duplicate step names within a single job are deduplicated
