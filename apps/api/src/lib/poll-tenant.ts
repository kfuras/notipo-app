import type PgBoss from "pg-boss";
import type { PrismaClient, Tenant } from "@prisma/client";
import { NotionService } from "../services/notion.service.js";
import { CredentialService } from "../services/credential.service.js";
import { WordPressService } from "../services/wordpress.service.js";
import { syncWpCategories } from "./sync-wp-categories.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "poll-tenant" });

/** Poll a single tenant's Notion database and enqueue sync/publish jobs as needed. */
export async function pollTenant(boss: PgBoss, prisma: PrismaClient, tenant: Tenant) {
  const credService = new CredentialService(prisma);
  const creds = await credService.getNotionCredentials(tenant.id);
  if (!creds || !tenant.notionDatabaseId) return;

  const notion = new NotionService(creds.accessToken);

  // Auto-sync WP categories so new ones are picked up (and push to Notion)
  const wpCreds = await credService.getWordPressCredentials(tenant.id);
  if (wpCreds) {
    try {
      const wp = new WordPressService(wpCreds);
      await syncWpCategories(prisma, tenant.id, wp, notion, tenant.notionDatabaseId ?? undefined);
    } catch (e) {
      log.warn({ tenantId: tenant.id, err: e }, "Failed to sync WP categories");
    }
  }

  // ── 1. "Post to Wordpress" → sync only (creates WP draft, waits for Publish) ──
  const syncPages = await notion.getReadyPosts(
    tenant.notionDatabaseId,
    tenant.notionTriggerStatus,
    5,
  );
  for (const page of syncPages) {
    const pageId = (page as { id: string }).id;

    // "Post to Wordpress" is for new posts — if already synced, check WP post still exists
    const existingPost = await prisma.post.findUnique({
      where: { tenantId_notionPageId: { tenantId: tenant.id, notionPageId: pageId } },
      select: { id: true, wpPostId: true, wpFeaturedMediaId: true, status: true },
    });
    if (existingPost?.wpPostId) {
      // Verify the WP post still exists — if deleted, clear stale data and allow re-sync
      let wpPostAlive = true;
      if (wpCreds) {
        try {
          const wp = new WordPressService(wpCreds);
          const wpPost = await wp.getPost(existingPost.wpPostId);
          if (wpPost?.status === "trash") wpPostAlive = false;
        } catch {
          wpPostAlive = false; // 404 or other error — treat as deleted
        }
      }
      if (wpPostAlive) {
        log.warn({ tenantId: tenant.id, pageId, wpPostId: existingPost.wpPostId }, "Post already synced to WP — use 'Update Wordpress' instead, resetting Notion status");
        const resetStatus = existingPost.status === "PUBLISHED" ? "Published" : "Ready to Review";
        await notion.updatePageStatus(pageId, resetStatus);
        continue;
      }
      // WP post was deleted — clean up old featured media and clear stale data
      log.info({ tenantId: tenant.id, pageId, wpPostId: existingPost.wpPostId }, "WP post deleted, clearing stale data for re-sync");
      if (existingPost.wpFeaturedMediaId && wpCreds) {
        const wp = new WordPressService(wpCreds);
        wp.deleteMedia(existingPost.wpFeaturedMediaId).catch((e) => log.warn({ err: e }, "Failed to delete old featured media"));
      }
      await prisma.post.update({
        where: { id: existingPost.id },
        data: { wpPostId: null, wpFeaturedMediaId: null, wpContent: null, wpUrl: null },
      });
    }

    // Skip if there's already a running sync job for this page
    const runningJob = await prisma.job.findFirst({
      where: { tenantId: tenant.id, type: "SYNC_POST", status: "RUNNING", payload: { path: ["notionPageId"], equals: pageId } },
    });
    if (runningJob) {
      log.debug({ tenantId: tenant.id, pageId }, "Sync already running, skipping");
      continue;
    }

    log.info({ tenantId: tenant.id, pageId }, "Found post to sync, enqueuing sync-post");
    await boss.send(
      "sync-post",
      { tenantId: tenant.id, notionPageId: pageId },
      { singletonKey: `sync:${pageId}` },
    );
  }

  // ── 2. "Publish" → always re-sync from Notion then publish ──
  const publishPages = await notion.getReadyPosts(
    tenant.notionDatabaseId,
    tenant.notionPublishTriggerStatus,
    5,
  );
  for (const page of publishPages) {
    const pageId = (page as { id: string }).id;

    const runningPublishJob = await prisma.job.findFirst({
      where: { tenantId: tenant.id, type: "SYNC_POST", status: "RUNNING", payload: { path: ["notionPageId"], equals: pageId } },
    });
    if (runningPublishJob) {
      log.debug({ tenantId: tenant.id, pageId }, "Sync already running, skipping publish");
      continue;
    }

    log.info({ tenantId: tenant.id, pageId }, "Found post to publish, enqueuing sync-then-publish");
    await boss.send(
      "sync-post",
      { tenantId: tenant.id, notionPageId: pageId, thenPublish: true },
      { singletonKey: `sync:${pageId}` },
    );
  }

  // ── 3. "Update Wordpress" → re-sync content then auto-publish ──
  const updatePages = await notion.getReadyPosts(
    tenant.notionDatabaseId,
    tenant.notionUpdateTriggerStatus,
    5,
  );
  for (const page of updatePages) {
    const pageId = (page as { id: string }).id;

    const runningUpdateJob = await prisma.job.findFirst({
      where: { tenantId: tenant.id, type: "SYNC_POST", status: "RUNNING", payload: { path: ["notionPageId"], equals: pageId } },
    });
    if (runningUpdateJob) {
      log.debug({ tenantId: tenant.id, pageId }, "Sync already running, skipping update");
      continue;
    }

    log.info({ tenantId: tenant.id, pageId }, "Found post to update, enqueuing sync-post (with publish)");
    await boss.send(
      "sync-post",
      { tenantId: tenant.id, notionPageId: pageId, thenPublish: true },
      { singletonKey: `sync:${pageId}` },
    );
  }
}
