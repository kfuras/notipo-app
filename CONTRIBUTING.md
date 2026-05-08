# Contributing to Notipo

Thanks for considering a contribution! This is a solo-maintained project at the moment, so here's the practical version of "how to contribute without your PR getting stuck in limbo."

## Before you start

- **For bugs**: Open an issue first with reproduction steps. Many "bugs" are configuration issues that get resolved without a PR.
- **For features**: Open an issue describing the use case before writing code. The hosted product has a roadmap; not every feature fits the project's direction. Better to align before writing 500 lines.
- **For typos / docs / small fixes**: Just open the PR. No issue needed.
- **For security issues**: See [SECURITY.md](SECURITY.md) — please don't open public issues for vulnerabilities.

## Development setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full local setup. The short version:

```bash
docker compose -f docker-compose.dev.yml up    # Postgres
npm install
npm run migrate -w @notipo/api                  # Apply Prisma migrations
turbo dev                                       # API on :3000, web on :3001
```

## Coding standards

- **TypeScript strict mode**. No `any` unless there's a real reason.
- **Run tests before opening a PR**: `turbo test`.
- **Match existing style**. Prettier + ESLint configs are in the repo — your editor should pick them up.
- **No commented-out code**. If it's not used, delete it.
- **No `console.log` in committed code**. Use the existing `logger` (Pino) in the API and `console.error` is fine for the CLI.

## Commit messages

Conventional Commits style:

```
feat(api): add direct_publish MCP tool
fix(cli): accept --help and -h aliases
docs(readme): update tech stack list
chore(deps): bump prisma to 7.5
```

Use `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `test`, `ci`. Do **not** use `chore:` for new features or fixes — pick the right type. Do **not** add `Co-Authored-By` lines.

## Pull request guidelines

- **One concern per PR.** If your branch fixes a bug AND refactors a service, split into two PRs.
- **Keep PRs small.** A 500-line PR is reviewable in 30 minutes; a 5,000-line PR sits for weeks.
- **Update tests.** New behavior → new tests. Bug fix → regression test.
- **Update docs.** If you change an API contract, update the relevant page under `notipo-site` (separate repo).
- **Don't bump dependencies in unrelated PRs.** A bug fix PR should only contain the fix; lockfile changes should not appear unless they're the point of the PR.

## License of contributions

By contributing to this repository, you agree that your contribution is licensed under the **AGPL-3.0** (the project license). You retain copyright on your contributions but grant a license consistent with the project.

If you copy code from another open-source project, you must include the original copyright notice and ensure the license is compatible with AGPL-3.0.

## Things that won't get merged

- **PRs that change core architecture** (e.g., switching from Fastify to NestJS) without prior discussion in an issue.
- **PRs that add tracking/telemetry** to the self-hosted version.
- **PRs that add proprietary or anti-features** (e.g., "phone home" checks, time-bombed features).
- **PRs that violate the AGPL license** (e.g., adding code under an incompatible license).
- **PRs that break feature parity** with the hosted product (the goal is one codebase, two deployment options).

## What to work on if you want to help

Easy starting points:
- Documentation improvements (typos, missing examples, clarifications)
- New SEO plugin support (Slim SEO, The SEO Framework, etc.)
- Additional test coverage for edge cases in `markdown-to-gutenberg.ts`
- New CLI commands that wrap existing API endpoints
- Translations / i18n (not yet supported but welcomed)

Harder work that's genuinely useful:
- New publishing destinations (Ghost, Hashnode, dev.to)
- Webhook signature verification helpers
- Additional MCP tools that surface existing functionality

## Getting help

Open an issue or reach out via [Twitter/X](https://x.com/kjetilfuras).
