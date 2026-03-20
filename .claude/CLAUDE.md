# Notipo

SaaS for publishing blog posts from Notion to WordPress with automated image handling, code syntax highlighting, and SEO optimization.

## Monorepo Structure

Turborepo + npm workspaces monorepo:

```
apps/api/          — Fastify backend (TypeScript), Prisma + PostgreSQL, pg-boss job queue
apps/web/          — Next.js frontend (admin UI only, auth + dashboard)
packages/shared/   — Shared TypeScript types and enums
```

### apps/api/ (Fastify Backend)

- `src/services/` — Business logic (no HTTP concerns)
- `src/routes/` — Thin HTTP layer (validation + delegation)
- `src/jobs/` — pg-boss background job handlers
- `src/plugins/` — Fastify lifecycle plugins (DB, queue, auth)
- `src/lib/` — Utilities and API client wrappers
- `public/category-images/` — Default background images for featured image generation
- `src/lib/storage.ts` — Google Cloud Storage client for user-uploaded category images
- `public/fonts/` — Bundled DejaVu Sans Bold font
- `prisma/` — Database schema and migrations

### apps/web/ (Next.js Frontend — Admin UI Only)

- `src/app/` — App Router pages (root `/` redirects to `/auth/login`, admin at `/admin/*`, auth at `/auth/*`)
- `src/components/admin/` — Admin UI components (sidebar, bottom nav)
- `src/components/ui/` — shadcn/ui components
- `src/hooks/` — Custom hooks (use-api with useApi/useApiCall, use-event-source, use-mobile)
- `src/lib/` — API client, auth context, PostHog analytics (`posthog.tsx`: `capture()`, `identifyUser()`, `resetUser()`)

Marketing site (landing page, blog, docs) lives in a separate repo: `notipo-site`.

### PostHog Event Tracking

All events use the `capture()` helper from `src/lib/posthog.tsx`. No-ops if PostHog is not initialized.

| Event | Properties | Location |
|-------|------------|----------|
| `user_registered` | `auto_verified` | auth-context.tsx |
| `user_logged_in` | `method` | auth-context.tsx |
| `onboarding_step_completed` | `step` (template/notion/wordpress), `method` | admin/page.tsx |
| `onboarding_completed` | — | admin/page.tsx (fires once via localStorage) |
| `notion_connected` | `method` (oauth/manual) | admin/page.tsx |
| `wordpress_connected` | `method` (auto/manual) | admin/page.tsx, WPAuthHandler |
| `sync_now_clicked` | — | admin/page.tsx |
| `job_completed` | `type` (SYNC_POST/PUBLISH_POST) | admin/page.tsx (SSE handler) |
| `job_failed` | `type` | admin/page.tsx (SSE handler) |
| `upgrade_clicked` | `current_plan` | admin/billing/page.tsx |
| `checkout_completed` | — | admin/billing/page.tsx |
| `settings_notion_updated` | `method` | admin/settings/page.tsx |
| `settings_wordpress_updated` | — | admin/settings/page.tsx |
| `settings_code_highlighter_changed` | `value` | admin/settings/page.tsx |
| `settings_webhook_updated` | `has_url` | admin/settings/page.tsx |
| `notion_disconnected` | — | admin/settings/page.tsx |
| `wordpress_disconnected` | — | admin/settings/page.tsx |
| `account_deleted` | — | admin/account/page.tsx |

Mobile: bottom nav bar on phones (<768px), sidebar on desktop. Admin tables switch to card layouts on mobile via `md:hidden`/`hidden md:block` pattern. Dark theme-color meta tag set dynamically for phone safe areas.

### WordPress One-Click Connection

WordPress connection uses the built-in `authorize-application.php` flow (WordPress 5.6+):

1. User enters their site URL in the onboarding or settings form
2. Clicks "Connect WordPress" → redirected to `{siteUrl}/wp-admin/authorize-application.php?app_name=Notipo&success_url={callbackUrl}`
3. User clicks "Approve" in WordPress admin
4. WordPress redirects back to `/admin` with `site_url`, `user_login`, and `password` query params
5. `WPAuthHandler` component (in `admin/page.tsx`) detects the params, calls `PUT /api/settings/wordpress` to save, and cleans the URL

Manual entry (username + application password) is kept as a fallback via "Enter credentials manually" link. Both the dashboard onboarding (`WordPressStepContent`) and settings page (`WordPressCard`) support both flows.

### packages/shared/

- Shared enums: `PostStatus`, `JobType`, `JobStatus`, `CodeHighlighter`, `UserRole`, `Plan`
- API response types: `ApiPost`, `ApiCategory`, `ApiJob`, `ApiTenant`, etc.

## Key Commands

```bash
# Development
docker compose -f docker-compose.dev.yml up  # Start postgres only
turbo dev                          # Start all apps with hot reload
npm run dev -w @notipo/api         # Start API only (port 3000)
npm run dev -w @notipo/web         # Start web only (port 3001)

# Build & Test
turbo build                        # Build all packages
turbo test                         # Run all tests
npm test -w @notipo/api            # Run API tests only

# Database
npm run migrate -w @notipo/api     # Run migrations (dev)
npm run migrate:prod -w @notipo/api # Apply migrations (production)
npm run seed -w @notipo/api        # Seed dev data
npm run generate -w @notipo/api    # Regenerate Prisma client

# Deploy (VPS)
ssh dev "cd ~/notipo && docker compose pull && docker compose up -d"
```

## Notion → WordPress Publish Flow

Three Notion status values drive the pipeline (all configurable per tenant):

| Notion Status        | Action                                                      | Notion → after     |
|----------------------|-------------------------------------------------------------|--------------------|
| `Post to Wordpress`  | Sync post → create WP **draft**                             | `Ready to Review`  |
| `Publish`            | Re-sync from Notion → publish **live** (`forcePublish`)     | `Published`        |
| `Update Wordpress`   | Re-sync content from Notion to WP                           | see below          |

`Update Wordpress` behaviour depends on the current WP post status (checked via the WP REST API):
- **WP post is live** (`publish`): re-syncs content, then auto-publishes → Notion `Published`
- **WP post is a draft**: re-syncs content only → Notion `Ready to Review`
- **WP post was deleted/trashed**: creates a fresh WP draft → Notion `Ready to Review`

**`Post to Wordpress` on existing posts:** If the WP post still exists, the trigger is rejected and Notion status resets. If the WP post was deleted/trashed, stale data is cleared and a fresh draft is created. A race-condition guard re-checks the DB before creating a draft to prevent duplicates from concurrent jobs.

**Failure handling:** When sync or publish jobs fail, the Notion status is automatically reset (e.g. "Syncing" → back to the trigger status) so the user can retry. Webhook notifications (Slack/Discord) are sent on failure if configured. Jobs stuck in RUNNING for >5 minutes are auto-failed, and stale RUNNING jobs are marked FAILED on server restart.

**WordPress Link in Notion:** Drafts get the wp-admin edit URL (`/wp-admin/post.php?post=X&action=edit`). Published posts get the live frontend URL.

**SEO metadata:** Rank Math SEO (focus keyword, title, description) is applied during sync — not just at publish time. The description is derived from the markdown content (~160 chars). The publish step refreshes it with the WP-generated excerpt.

Trigger detection: Notion webhooks (configured on the public integration, delivered automatically for OAuth users) are the primary trigger via `POST /api/notion/webhook`. A safety-net poll runs every 5 minutes by default (`POLL_INTERVAL_SECONDS` env var) to catch missed events. The dashboard has a "Sync Now" button for instant manual polling.

### Internal PostStatus (DB)
`SYNCED` → `IMAGES_PROCESSING` → `PUBLISHING` → `PUBLISHED`
Also: `UPDATE_PENDING`, `FAILED`

## Multi-Tenant Architecture

Every table has `tenantId`. All queries MUST filter by tenantId.

- **Admin routes** (`/api/admin/*`) — protected by global `API_KEY` env var
- **Tenant routes** (`/api/*`) — protected by per-user API key
- **Auth routes** (`/api/auth/*`) — unauthenticated, self-service signup with email verification

### Admin Impersonation

Admin can browse any tenant's data by sending the admin API key + `X-Impersonate-Tenant: <tenantId>` header (or `?impersonateTenant=` query param for SSE). The auth plugin sets `request.tenant` from the specified tenant ID and `request.isAdmin = true`. Regular users cannot use this header — it's only honoured when the API key matches the admin `API_KEY` env var.

In the frontend, clicking "View" on the Tenants page stores `{ tenantId, tenantName }` in `sessionStorage`. The `useApiCall()` hook and `useApi()` hook automatically attach the impersonation header to all requests. An amber banner at the top shows "Viewing as [tenant]" with an Exit button.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/settings` | Tenant config overview (no secrets) |
| PUT | `/api/settings/notion` | Set Notion credentials + trigger statuses |
| DELETE | `/api/settings/notion` | Disconnect Notion |
| PUT | `/api/settings/wordpress` | Set WordPress credentials (validates connection first) |
| DELETE | `/api/settings/wordpress` | Disconnect WordPress |
| PATCH | `/api/settings` | Update code highlighter, database ID, trigger statuses, webhook URL |
| POST | `/api/settings/test-webhook` | Send `@channel` test message to saved webhook URL |
| GET | `/api/posts` | List posts |
| GET | `/api/posts/:id` | Get post |
| POST | `/api/posts/create` | Create Notion page + trigger sync. Accepts title, body (markdown), category, tags, seoKeyword, imageTitle, slug, publish, images (inline Unsplash, Pro only) |
| POST | `/api/posts/sync` | Trigger sync from existing Notion page |
| POST | `/api/posts/:id/publish` | Trigger publish to WordPress |
| DELETE | `/api/posts/:id` | Delete post + clean up WP resources + reset Notion |
| GET | `/api/categories` | List categories |
| GET | `/api/tags` | List tags |
| POST | `/api/categories/sync` | Sync categories & tags from WordPress |
| PATCH | `/api/categories/:id` | Update category background image |
| POST | `/api/categories/:id/background-image` | Upload category background image (multipart) |
| DELETE | `/api/categories/:id/background-image` | Remove category background image |
| DELETE | `/api/categories/:id` | Delete category (cleans up uploaded image) |
| GET | `/api/notion/oauth/authorize` | Generate Notion OAuth URL |
| GET | `/api/notion/oauth/callback` | Handle Notion OAuth redirect (→ `/admin`) |
| POST | `/api/notion/webhook` | Notion webhook receiver (HMAC-verified) |
| GET | `/api/events` | SSE stream of job updates |
| GET | `/api/jobs` | List recent jobs |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| GET | `/api/admin/tenants` | List all tenants |
| POST | `/api/admin/tenants` | Create tenant + owner user |
| DELETE | `/api/admin/tenants/:id` | Delete tenant |
| GET | `/api/auth/providers` | Available auth methods |
| POST | `/api/auth/register` | Self-service signup (sends verification email) |
| POST | `/api/auth/login` | Login, returns API key (requires verified email) |
| POST | `/api/auth/verify-email` | Verify email + auto-login (returns API key) |
| POST | `/api/auth/resend-verification` | Resend verification email |
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Set new password using reset token |
| POST | `/api/sync-now` | Trigger immediate Notion poll for tenant (Pro only, 15s cooldown) |
| GET | `/api/billing` | Current plan, usage stats, trial info |
| POST | `/api/billing/checkout` | Create Stripe Checkout session (upgrade to Pro) |
| POST | `/api/billing/portal` | Create Stripe Customer Portal session (manage subscription) |
| POST | `/api/billing/webhook` | Stripe webhook handler (unauthenticated, signature-verified) |
| GET | `/api/account` | Current user profile + tenant info |
| PATCH | `/api/account/password` | Change password (rate-limited) |
| DELETE | `/api/account` | Delete account (OWNER deletes tenant + cascade) |

## Key Services

### `sync.service.ts`
Orchestrates `Post to Wordpress` trigger. Notion → markdown → images → Gutenberg blocks → featured image → WP draft → SEO meta. Returns `{ postId, wpStatus, wasPublished }`. Handles deleted WP posts (404/trash → creates fresh draft).

### `publish.service.ts`
Orchestrates `Publish` trigger. Draft → live, refreshes SEO meta with WP excerpt, updates Notion status.

### `poll-tenant.ts` (lib)
Per-tenant Notion poll logic, shared by the poll-notion job and `POST /api/sync-now` endpoint.

### `featured-image.service.ts`
Generates 1200x628 PNG featured images. Two modes controlled by tenant `featuredImageMode`:
- **STANDARD** (default): sharp + @napi-rs/canvas with text overlay. Background priority: uploaded image (`gcs:{tenantId/filename}` stored in GCS, served via signed URLs), HTTPS URL, bundled default (`public/category-images/`), Unsplash, gradient fallback. Unsplash searches by category name (30 results cached in-memory), picks photo deterministically by hashing post title. Returns `FeaturedImageResult` with optional `UnsplashAttribution`. Requires `UNSPLASH_ACCESS_KEY`; falls back to gradient without it.
- **AI_GENERATED**: Delegates to `gemini-image.service.ts` which calls the Gemini REST API to generate an illustration from the post title, category, tags, and tenant's `aiImageStyle` (e.g. "comic book", "watercolor"). Requires `GEMINI_API_KEY` env var. Output is resized to 1200x628 via sharp.

Photographer attribution (Unsplash only) is appended as a Gutenberg paragraph block in sync/publish services.

### `gemini-image.service.ts`
Calls Google Gemini API (`gemini-3-pro-image-preview`) to generate blog featured images. Builds a prompt from post title, category, tags, and style. Returns 1200x628 PNG buffer. No text is included in the generated image.

### Inline Unsplash Images (POST /api/posts/create)
The `images` field accepts an array of `{ query, afterHeading }` objects. On Pro plan, the route searches Unsplash for each query and inserts `![alt](url)` into the markdown body after the matching heading before creating the Notion page. Gated by `canGenerateFeaturedImage()` (same as featured images). Falls back silently if Unsplash search fails.

### `image-pipeline.service.ts`
Caches Notion S3 image URLs → WordPress media library. Handles orphan cleanup.

### `credential.service.ts`
Encrypts/decrypts tenant credentials with AES-256-GCM.

### `webhook.ts` (lib)
Sends failure notifications to tenant's configured webhook URL. Works with both Slack (`text`) and Discord (`content`). Uses `<!channel>` to trigger push notifications. Fire-and-forget — errors are logged but never thrown.

### `reset-notion-status.ts` (jobs)
Resets Notion page status after job failures (e.g. "Syncing" → back to trigger status). Called on job failure, server startup cleanup, and periodic stale job check.

### Job lifecycle (`jobs/index.ts`)
On startup: marks all RUNNING jobs as FAILED ("Interrupted by server restart"). Every 60s: auto-fails jobs stuck in RUNNING for >5 minutes. Both trigger Notion status reset.

### Job step tracking
Both sync and publish jobs persist a `steps` array in the job `result` JSON field. Steps are accumulated during execution (deduplicated with `includes()` check) and stored on completion. Each job only tracks its own steps — the sync job shows sync steps, and the publish job shows only publish-specific steps. The Jobs page UI shows steps collapsible for completed/failed jobs and always-expanded for running jobs.

### Publish trigger: `forcePublish`
The "Publish" Notion trigger passes `forcePublish: true` in the sync-post payload, ensuring the post is published even when the WP post is currently a draft (two-step flow: Post to WordPress → Publish). The "Update WordPress" trigger does NOT set `forcePublish`, so it only auto-publishes if the WP post is already live.

## Billing & Plans

Three plans: **Free**, **Pro** ($19/mo), **Trial** (7-day Pro trial on signup, no card required).

| Feature | Free | Pro / Trial |
|---------|------|-------------|
| Posts/month | 5 | Unlimited |
| Featured images | No | Yes |
| Webhooks + instant sync | No | Yes |
| Poll interval | 5 min | 5 min |
| Code highlighting + SEO | Yes | Yes |

Plan logic in `apps/api/src/lib/plan-limits.ts`. `getEffectivePlan()` resolves TRIAL→FREE if expired. Feature gating applied in:
- `sync-post.job.ts` — post count check (new posts only)
- `sync.service.ts` — featured image generation
- `notion-webhook.ts` — webhook processing
- `poll-notion.job.ts` — per-tenant poll intervals
- `sync.ts` — instant sync (`/api/sync-now`)

Stripe integration (optional): Checkout for upgrades, Customer Portal for management, webhook for lifecycle events. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` env vars.

**Self-hosted mode:** When Stripe is not configured, all features are unlocked. New registrations get PRO plan directly (no trial). `isSelfHosted()` in `plan-limits.ts` checks `!config.STRIPE_SECRET_KEY`.

Trial expiry: Runtime check via `getEffectivePlan()` + hourly `check-trials` job as safety net.

## Environment Variables

See `.env.example`. Minimal required:
```
DATABASE_URL=
ENCRYPTION_KEY=            # 64-char hex: openssl rand -hex 32
API_KEY=                   # Admin API key
ALLOW_SIGNUP=true
RESEND_API_KEY=            # For email verification + password reset
RESEND_FROM_EMAIL=noreply@notipo.com
ADMIN_NOTIFY_EMAIL=        # Optional: receive email when new users sign up
NEXT_PUBLIC_POSTHOG_KEY=   # Optional: PostHog analytics (marketing site + admin UI)
GEMINI_API_KEY=            # Optional: AI-generated featured images via Google Gemini
GCS_BUCKET=                # Google Cloud Storage bucket for category image uploads
```

## Deployment

**Production (Google Cloud Run, `notipo-prod` project, `europe-west4`):**
- `notipo-api` — Fastify backend (min-instances=1 for pg-boss background jobs)
- `notipo-web` → `notipo.com/admin` — Admin UI (nginx, static Next.js export)
- `notipo-site` → `notipo.com` — Marketing site (separate `notipo-site` repo)
- `notipo-db` — Cloud SQL for PostgreSQL (db-f1-micro, Postgres 17)
- `notipo-uploads` — GCS bucket for user-uploaded category images (private, signed URLs)
- Cloudflare Worker (`notipo-router`) routes `notipo.com/*` to the correct Cloud Run service
- Cloud Run connects to Cloud SQL via built-in Unix socket proxy (`--add-cloudsql-instances`)
- Secrets stored in Google Cloud Secret Manager
- CI/CD: push to main → CI → Cloud Build → Cloud Run deploy (`.github/workflows/deploy.yml`)
- Workload Identity Federation for keyless GitHub Actions auth
- Prisma migrations run via a Cloud Run job (`notipo-migrate`) before each API deploy

**Docker images (ghcr.io) — for self-hosters only:**
- `ghcr.io/kfuras/notipo-api` — API image
- `ghcr.io/kfuras/notipo-web` — Admin UI image
- Built on version tags (`v*`) via `.github/workflows/docker.yml`
- Used by self-hosters via `docker-compose.yml`

**Dev VPS:** `ssh dev`. Domain: `dev.notipo.com`.

Traefik routing:
- `/api/*`, `/health` → `app` container (Fastify, priority 20)
- Everything else → `web` container (Next.js/nginx, priority 10)

Deploy: `ssh dev "cd ~/notipo && docker compose pull && docker compose up -d"`

Logs: `ssh dev "docker logs notipo-app -f --tail 100"`
