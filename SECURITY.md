# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Notipo, **please do not open a public GitHub issue**. Instead, email:

**security@notipo.com**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (or a proof-of-concept)
- Your name / handle if you'd like to be credited
- Whether you'd prefer coordinated disclosure (we recommend this)

We aim to respond within **3 business days** and to ship a fix or mitigation within **14 days** for critical issues. For non-critical issues, we'll provide an estimated timeline.

## Supported versions

Notipo is shipped from `main`. The hosted product at [notipo.com](https://notipo.com) always runs the latest version. Self-hosted users should track `main` and follow [DEVELOPMENT.md](DEVELOPMENT.md) for upgrade instructions.

| Version | Supported |
|---------|-----------|
| `main` (current) | ✅ |
| Older Docker tags | ❌ — please upgrade |

## Scope

In scope:
- The `apps/api` Fastify backend (REST API + MCP server)
- The `apps/web` Next.js admin UI
- The `notipo` CLI npm package
- The `notipo-seo` WordPress plugin
- The `notipo` Docker image

Out of scope:
- Vulnerabilities in dependencies (please report to the upstream project; we'll patch when they release)
- Issues caused by misconfiguration in self-hosted deployments (e.g., exposing the database to the internet)
- Self-hosted instances that have been modified beyond the published code
- Third-party services Notipo integrates with (Notion, WordPress, Stripe, Resend, Gemini) — report directly to those vendors

## What counts as a vulnerability

Examples of in-scope issues:
- Authentication or authorization bypass (e.g., one tenant accessing another's data)
- SQL injection, command injection, server-side request forgery
- Cryptographic issues (e.g., weak encryption of stored Notion/WordPress credentials)
- Cross-site scripting (XSS) in the admin UI
- Cross-site request forgery (CSRF) on state-changing endpoints
- Server-side template injection or path traversal
- Sensitive data exposure in API responses or logs
- Insecure deserialization

Examples of issues that are **not** vulnerabilities:
- Lack of rate limiting on read-only endpoints (we use `@fastify/rate-limit` where appropriate, but not everywhere)
- Best-practice deviations without an exploitable consequence (e.g., "you should use Argon2 instead of bcrypt")
- Issues requiring physical access to the user's machine
- Self-XSS that requires the victim to paste JavaScript into the browser console
- Reports from automated scanners without a working PoC

## Hall of fame

We'll maintain a list of researchers who have responsibly disclosed vulnerabilities. If you'd like to be credited, mention it in your report.

*(none yet — be the first!)*

## Encryption keys & secrets

If you're self-hosting and your `ENCRYPTION_KEY` or database is exposed, rotate it immediately. The encryption key is used for AES-256-GCM encryption of stored Notion and WordPress credentials. Rotating the key requires re-entering credentials for all tenants — there's currently no automated migration tool.

For the hosted product, all secrets are stored in Google Cloud Secret Manager; only the operating service account has access.
