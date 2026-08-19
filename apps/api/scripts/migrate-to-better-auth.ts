/**
 * One-off migration from the legacy per-tenant `users` (x-api-key + bcrypt) model
 * to better-auth. Additive and idempotent — it never touches the legacy `users`
 * table, so it is safe to re-run and safe to run before the legacy columns are
 * dropped in a later destructive migration.
 *
 * Run AFTER the additive Prisma migration (authUser/member/api_keys tables) is
 * applied to the target database. Point DATABASE_URL at the target DB, e.g.:
 *
 *   # against prod (via `fly ssh console` on notipo-prod-api, which has DATABASE_URL):
 *   node --import tsx scripts/migrate-to-better-auth.ts report
 *   node --import tsx scripts/migrate-to-better-auth.ts migrate <tenantId>
 *   node --import tsx scripts/migrate-to-better-auth.ts delete <tenantId> [--force]
 *
 * Commands:
 *   report            List every blog with owner + activity signals (read-only).
 *   migrate <ids...>  For each tenant: create a better-auth user (no password,
 *                     emailVerified) linked to the EXISTING tenant via `member`,
 *                     and move the legacy `users.apiKey` into the `api_keys` table
 *                     so the CLI/MCP keep working with the same key. On first
 *                     Google sign-in the account links by verified email.
 *   delete <ids...>   Delete a blog + all its data (cascade). Refuses if the blog
 *                     has posts or connected Notion/WordPress credentials unless
 *                     --force is passed. Use only for confirmed dead accounts.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function report() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      notionCredentials: true,
      wordpressCredentials: true,
      _count: { select: { posts: true } },
      users: { select: { email: true, role: true, apiKey: true } },
      members: { select: { id: true } },
    },
  });

  console.log(`\n${tenants.length} blog(s):\n`);
  for (const t of tenants) {
    const owner = t.users.find((u) => u.role === "OWNER") ?? t.users[0];
    const hasNotion = t.notionCredentials !== null;
    const hasWp = t.wordpressCredentials !== null;
    const posts = t._count.posts;
    const migrated = t.members.length > 0;
    const dead = !hasNotion && !hasWp && posts === 0;
    console.log(
      [
        dead ? "💀 DEAD  " : "✅ LIVE  ",
        t.id,
        `${owner?.email ?? "(no user)"}`.padEnd(32),
        `notion:${hasNotion ? "Y" : "-"}`,
        `wp:${hasWp ? "Y" : "-"}`,
        `posts:${posts}`,
        `key:${owner?.apiKey ? "Y" : "-"}`,
        migrated ? "migrated" : "",
      ].join("  "),
    );
  }
  console.log(
    `\nLegend: DEAD = no Notion/WordPress and 0 posts (delete candidate). ` +
      `Run 'migrate <id>' for the ones to keep, 'delete <id>' for confirmed dead ones.\n`,
  );
}

async function migrate(tenantIds: string[]) {
  for (const tenantId of tenantIds) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, users: { select: { id: true, email: true, name: true, role: true, apiKey: true } } },
    });
    if (!tenant) {
      console.log(`✗ ${tenantId}: tenant not found`);
      continue;
    }
    const legacy = tenant.users.find((u) => u.role === "OWNER") ?? tenant.users[0];
    if (!legacy) {
      console.log(`✗ ${tenantId}: no legacy user to migrate`);
      continue;
    }

    // 1. better-auth user (idempotent by email).
    let authUser = await prisma.authUser.findUnique({ where: { email: legacy.email } });
    if (!authUser) {
      authUser = await prisma.authUser.create({
        data: {
          id: randomUUID(),
          email: legacy.email,
          name: legacy.name || legacy.email.split("@")[0],
          // SECURITY: only migrate accounts whose email is owner-controlled —
          // marking a self-asserted email as verified lets whoever controls that
          // mailbox/Google account claim the pre-created blog. In practice this
          // script is run only for the owner's own account (dead accounts are
          // deleted, not imported), so `true` is safe and is required so the
          // owner can sign in with Google and (if in ADMIN_EMAILS) be admin.
          emailVerified: true,
        },
      });
      console.log(`  + authUser ${authUser.email}`);
    } else {
      console.log(`  = authUser ${authUser.email} (exists)`);
    }

    // 2. Membership on the EXISTING tenant (idempotent).
    const existingMember = await prisma.member.findFirst({
      where: { organizationId: tenantId, userId: authUser.id },
      select: { id: true },
    });
    if (!existingMember) {
      await prisma.member.create({
        data: { id: randomUUID(), organizationId: tenantId, userId: authUser.id, role: "owner", createdAt: new Date() },
      });
      console.log(`  + member → ${tenant.name}`);
    } else {
      console.log(`  = member → ${tenant.name} (exists)`);
    }

    // 3. Move the legacy API key so CLI/MCP keep working (idempotent by key).
    if (legacy.apiKey) {
      const existingKey = await prisma.apiKey.findUnique({ where: { key: legacy.apiKey }, select: { id: true } });
      if (!existingKey) {
        await prisma.apiKey.create({
          data: { key: legacy.apiKey, tenantId, userId: authUser.id, name: "Default (migrated)" },
        });
        console.log(`  + api key moved to api_keys`);
      } else {
        console.log(`  = api key already in api_keys`);
      }
    } else {
      console.log(`  · no legacy api key to move`);
    }
    console.log(`✓ ${tenantId} migrated\n`);
  }
}

async function del(tenantIds: string[], force: boolean) {
  for (const tenantId of tenantIds) {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        notionCredentials: true,
        wordpressCredentials: true,
        _count: { select: { posts: true } },
        users: { select: { email: true } },
      },
    });
    if (!t) {
      console.log(`✗ ${tenantId}: not found`);
      continue;
    }
    const hasData = t.notionCredentials !== null || t.wordpressCredentials !== null || t._count.posts > 0;
    if (hasData && !force) {
      console.log(
        `⚠ ${tenantId} (${t.users[0]?.email ?? t.name}) has data ` +
          `(notion:${t.notionCredentials !== null} wp:${t.wordpressCredentials !== null} posts:${t._count.posts}) — ` +
          `refusing without --force`,
      );
      continue;
    }
    await prisma.tenant.delete({ where: { id: tenantId } });
    console.log(`🗑  deleted ${tenantId} (${t.users[0]?.email ?? t.name})`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes("--force");
  const ids = rest.filter((a) => !a.startsWith("--"));

  switch (cmd) {
    case "migrate":
      if (!ids.length) throw new Error("Usage: migrate <tenantId> [tenantId...]");
      await migrate(ids);
      break;
    case "delete":
      if (!ids.length) throw new Error("Usage: delete <tenantId> [tenantId...] [--force]");
      await del(ids, force);
      break;
    case "report":
    case undefined:
      await report();
      break;
    default:
      throw new Error(`Unknown command: ${cmd}. Use report | migrate | delete.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
