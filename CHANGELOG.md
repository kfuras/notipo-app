# Changelog

All notable changes to Notipo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

Each `## vX.Y.Z` section is extracted verbatim by `.github/workflows/release.yml` and posted as the GitHub release notes when the matching tag is pushed.

## v1.3.0

### Fly.io + Neon Postgres Migration, Subdomain Split

Notipo's hosted infrastructure moved off Google Cloud Run + Cloud SQL onto Fly.io + Neon Postgres. Marketing site and admin/API are now split across two subdomains, matching the pattern used by sister projects like Klarbud.

**URL changes** (breaking for hosted-product clients):

- Marketing site: `notipo.com` (unchanged)
- Admin UI: `notipo.com/admin` → `https://app.notipo.com/admin`
- Auth pages: `notipo.com/auth/*` → `https://app.notipo.com/auth/*`
- REST API: `notipo.com/api/*` → `https://app.notipo.com/api/*`
- MCP endpoint: `notipo.com/api/mcp` → `https://app.notipo.com/api/mcp`

**Update your MCP client configuration** if you have Claude Desktop, Cursor, or another client pointing at `notipo.com/api/mcp` — the old URL now returns 404.

**Self-hosters**: no impact. Docker images still expect one domain via the `DOMAIN` env var, and Traefik routes `/api`, `/admin`, `/auth`, and `/` internally. The subdomain split is a hosted-only architecture change.

### Front-door nginx reverse proxy

The `apps/web` container now runs as an nginx reverse-proxy front door for `app.notipo.com`:

- Serves `/admin` and `/auth` as static Next.js export locally
- Proxies `/api` and `/health` to `notipo-prod-api.internal:3000` via Fly private networking
- Proxies remaining paths (marketing) to `notipo-prod-site.internal:80`

Requires `API_INTERNAL_URL` and `SITE_INTERNAL_URL` env vars at runtime.

### CLI 1.1.3 published to npm

Updated the `NOTIPO_URL=https://notipo.com` example in `notipo --help` output to `https://app.notipo.com`. Backwards-compatible — CLI itself is env-driven and works against any hostname.

### Fixes

- Sync `package-lock.json` with `apps/web/package.json` — missing entries for @blocknote/*, tailwindcss 4.3.2, lucide-react, tailwind-merge caused `npm ci` failures on fresh CI builds and Glama's introspector.
- Update README API examples to `app.notipo.com`.
- CI: replace Google Cloud Build deploy step with `flyctl deploy --remote-only`. Requires `FLY_API_TOKEN` secret.

## v1.2.6

### Cleaner Smithery Scan Output

`triggers/list` — a Smithery-specific scanner probe that is not part of the MCP spec — is now in the discovery-methods allow-list. Previously it fell into the authentication path, returned `401 Authorization required`, and embedded a Smithery setup-URL redirect in the catalog's scan log. Now it returns a clean `-32601 Method not found`, matching how `resources/list` and `prompts/list` already behave when the server does not implement those capabilities.

No scoring impact — Smithery's quality score already topped Capability Quality at 38/40 after v1.2.5. This change just removes the spurious-looking auth warning from the scan log.

## v1.2.5

### Output Schemas on the Live MCP HTTP Route

`POST /api/mcp` now declares an `outputSchema` for each of the 13 tools — list of posts, single post with WP/Notion IDs, job acknowledgements with `jobId`, category and tag lists, full job state, settings response, and a success flag for `sync_now`.

v1.2.4 added these schemas to the stdio entrypoint at `apps/api/src/stdio-mcp.ts` (which Glama introspects), but the schemas were missing from the HTTP route at `apps/api/src/routes/mcp.ts` (which Smithery and any "External URL" catalog scans). Smithery's Capability Quality score therefore stayed flat after v1.2.4 — the live endpoint still returned tool definitions without output schemas.

This release brings the HTTP route in line. The server-info `version` field also bumps from the long-stale `1.0.0` to `1.2.5` so catalog scans report the deployed version.

No behaviour change for clients: the handlers still return JSON in `content[].text` as before. The schemas are declarative metadata.

## v1.2.4

### Output Schemas on All MCP Tools

The stdio MCP server at `apps/api/src/stdio-mcp.ts` now declares an `outputSchema` for each of the 13 tools — list of posts, single post with WP/Notion IDs, job acknowledgements with `jobId`, category and tag lists, full job state with progress, settings response with plan + SEO plugin detection, and a success flag for `sync_now`.

Why: MCP catalog services score servers on the presence of structured-output declarations because they let agents (and the agent-running runtime) validate responses without parsing free-form text. On Smithery, the missing output schemas were the largest single hit on the Capability Quality score — adding all 13 lifts the listing's quality score by ~10 points.

No behaviour change for production: the live HTTP route at `POST /api/mcp` continues to return free-form JSON in `content[].text` as before. The new schemas live only on the stdio entrypoint that catalog services use for introspection.

## v1.2.3

### Standalone Stdio MCP Server for Catalog Introspection

A new `apps/api/src/stdio-mcp.ts` registers the 13 Notipo tool schemas on a stdio transport so MCP catalogs (Glama, Smithery, mcp.so) can introspect the server with their generic stdio-only build pipeline.

Why a separate file: catalog services do not build the production Dockerfile and do not allow CMD to be an HTTP URL. They git-clone the repo, run user-supplied build steps in their own Debian + Node image, then run user-supplied CMD — which has to be a local stdio MCP server. The HTTP route at `POST /api/mcp` needs Postgres, pg-boss, Fastify, and the full API surface — none of which exist in a catalog container.

The stdio entrypoint shares the same tool *schemas* as the HTTP route so `tools/list` returns 13 entries. Handlers stub out and direct callers to the hosted endpoint at `notipo.com/api/mcp` — catalogs only call `tools/list` during introspection, so the stubs never run in catalog flows.

Glama config:
- Build steps: `npm ci && npm run build --workspace=@notipo/api`
- CMD: `["node", "apps/api/dist/stdio-mcp.js"]`

## v1.2.2

### Discovery-Only Mode for MCP Catalogs

A new `DISCOVERY_ONLY=true` environment variable boots the API with just the health check and the MCP route mounted. Prisma, pg-boss, the job runner, the event bus, and the auth plugin are skipped, so the container starts cleanly with no database and no environment configuration. The MCP route's `tools/list` then returns the 13 tool schemas without authentication.

Why: MCP catalog services (Glama, Smithery, mcp.so) build the published Dockerfile and call `tools/list` to verify the server actually exposes tools. Without a discovery-only mode the API crashed at `pgBossPlugin` before the MCP route was ever registered, so introspection failed and the Glama quality score stayed at `–` (not tested) — blocking the listing on `punkpeye/awesome-mcp-servers#8568`.

Tool execution still fails fast in discovery mode because the handlers reach for `app.prisma`, which is not decorated when the plugin is skipped. That is the correct behaviour — there is no real backend to execute against in this mode.

To enable on Glama: set `DISCOVERY_ONLY=true` in the server's environment-variables schema on the Glama admin page, and add `{"DISCOVERY_ONLY": "true"}` to the placeholder parameters field.

## v1.2.1

### MCP Discovery Without Authentication

`POST /api/mcp` now accepts the MCP capability-discovery methods (`initialize`, `tools/list`, `prompts/list`, `resources/list`, `notifications/initialized`, `ping`, `resources/templates/list`) without an API key, matching the MCP spec. Tool execution still requires a valid `x-api-key` header — only the schema-listing path was unauthenticated.

This unblocks MCP catalog services (Glama, Smithery, mcp.so, awesome-mcp-servers checks) which clone the repo, start the container, and call `tools/list` to confirm the server actually exposes tools. Previously every directory bot saw `401` and refused the listing.

No data is exposed by the change: the 13 tool names are already public on [notipo.com/ai-agents](https://notipo.com/ai-agents) and in the README.

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
