# Notipo Migration: GCP → Fly + Neon

Status: **In Progress** (started 2026-07-04)

## Target architecture

| Component | Before (GCP) | After (Fly + Neon) |
|-----------|--------------|--------------------|
| API | Cloud Run `notipo-api` (europe-west4) | Fly `notipo-prod-api` (ams) |
| Web (admin UI) | Cloud Run `notipo-web` | Fly `notipo-prod-web` (ams) |
| Site (marketing) | Cloud Run `notipo-site` | Fly `notipo-prod-site` (ams) |
| Database | Cloud SQL Postgres 17 | Neon Postgres |
| Uploads (category images) | GCS `notipo-uploads` | **Keep on GCS** (no cost benefit to move) |
| Secrets | Google Secret Manager | Fly secrets |
| Domain routing | Cloudflare Worker `notipo-router` → Cloud Run | Cloudflare Worker → Fly apps |
| CI/CD | GitHub Actions → Cloud Build | GitHub Actions → `flyctl deploy` |

## What's done

- [x] Fly apps created (`notipo-prod-api`, `notipo-prod-web`, `notipo-prod-site`) under `furas-digital` org
- [x] `fly.prod-api.toml`, `fly.prod-web.toml` (in notipo-app repo)
- [x] `fly.prod-site.toml` (in notipo-site repo)

## What you need to do (interactive)

### 1. Authenticate Neon CLI

```bash
neonctl auth
# Opens browser → login with Neon account
```

### 2. Create Neon project

```bash
neonctl projects create --name notipo --region-id aws-eu-central-1
# Returns project ID + connection strings. Save both.
```

Get connection string:

```bash
neonctl connection-string --project-id <project-id> --database-name notipo
# Copy this — it's the DATABASE_URL for Fly
```

### 3. Export Cloud SQL data

Requires gcloud auth:

```bash
gcloud auth login
gcloud config set project notipo-prod

# Get DB name (from Cloud SQL console or:)
gcloud sql databases list --instance=notipo-db

# Export to GCS bucket
gcloud sql export sql notipo-db gs://notipo-uploads/backup/pre-fly-migration.sql \
  --database=notipo

# Download locally
gsutil cp gs://notipo-uploads/backup/pre-fly-migration.sql /tmp/notipo-dump.sql
```

### 4. Restore to Neon

```bash
# From dump file to Neon
psql "postgresql://user:pass@ep-...neon.tech/notipo" -f /tmp/notipo-dump.sql

# Verify row counts match Cloud SQL:
psql "postgresql://user:pass@ep-...neon.tech/notipo" \
  -c "SELECT 'tenants', COUNT(*) FROM \"Tenant\"
      UNION ALL SELECT 'users', COUNT(*) FROM \"User\"
      UNION ALL SELECT 'posts', COUNT(*) FROM \"Post\"
      UNION ALL SELECT 'jobs', COUNT(*) FROM \"Job\";"
```

## What I'll do after your Neon setup

Once you give me the Neon `DATABASE_URL`, I will:

### 5. Set Fly secrets

Migrate all secrets from Google Secret Manager to Fly. Requires listing existing secrets first (needs gcloud auth), then:

```bash
# Example — will scale to all secrets
flyctl secrets set \
  DATABASE_URL="postgresql://...neon.tech/notipo" \
  ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=notipo-encryption-key)" \
  API_KEY="$(gcloud secrets versions access latest --secret=notipo-api-key)" \
  RESEND_API_KEY="$(gcloud secrets versions access latest --secret=notipo-resend-api-key)" \
  --app notipo-prod-api
```

Full secrets list from CLAUDE.md:
- `DATABASE_URL` (Neon)
- `ENCRYPTION_KEY` (64-char hex)
- `API_KEY` (admin API key)
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL`
- `GEMINI_API_KEY` (for AI featured images)
- `UNSPLASH_ACCESS_KEY`
- `GCS_BUCKET` + GCS service-account JSON (keeps working from Fly)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRO_PRICE_ID`
- `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET`
- `NOTION_WEBHOOK_SECRET`
- `ADMIN_NOTIFY_EMAIL`

### 6. Deploy to Fly

```bash
cd ~/code/notipo-app
flyctl deploy -c fly.prod-api.toml --remote-only
flyctl deploy -c fly.prod-web.toml --remote-only

cd ~/code/notipo-site
flyctl deploy -c fly.prod-site.toml --remote-only
```

### 7. Verify

```bash
# API health
curl https://notipo-prod-api.fly.dev/health

# Web loads
curl -I https://notipo-prod-web.fly.dev

# DB migrations up-to-date
flyctl ssh console --app notipo-prod-api -C "cd apps/api && npx prisma migrate deploy"
```

### 8. Cloudflare Worker DNS-cutover

Update `notipo-router` Worker to route to Fly instead of Cloud Run:

```javascript
// Old routes: /api/* → notipo-api.run.app, /* → notipo-site.run.app
// New: /api/* → notipo-prod-api.fly.dev, /admin/* → notipo-prod-web.fly.dev, /* → notipo-prod-site.fly.dev
```

### 9. CI/CD update

Replace `.github/workflows/ci.yml` Cloud Run deploy step with Fly deploy step:

```yaml
- uses: superfly/flyctl-actions/setup-flyctl@master
- run: flyctl deploy -c fly.prod-api.toml --remote-only
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 10. Cleanup GCP (after 72h stability)

```bash
gcloud run services delete notipo-api --region europe-west4
gcloud run services delete notipo-web --region europe-west4
gcloud run services delete notipo-site --region europe-west4
gcloud sql instances delete notipo-db     # KEEP dump backup somewhere first
# Keep GCS bucket for uploads
```

## Realistisk kostnad etter migrasjon

- Fly API (min 1 machine, 512mb): ~$3.20/mnd
- Fly Web (scale-to-zero, 256mb): ~$0.50/mnd
- Fly Site (scale-to-zero, 256mb): ~$0.50/mnd
- Neon Free tier (512mb DB): $0/mnd
- GCS uploads bucket: ~$1-3/mnd
- Cloudflare Worker: $0/mnd (already free tier)
- **Total: ~$5-7/mnd** vs. GCP current ~$50-150/mnd

Break-even instant.
