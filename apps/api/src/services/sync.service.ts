/**
 * Sync orchestrator: Notion → Database → WordPress draft.
 * Replaces the entire "Notion to Airtable Sync" n8n workflow.
 */

import type { PrismaClient } from "@prisma/client";
import { NotionService } from "./notion.service.js";
import { convertNotionBlocksToMarkdown } from "./notion-to-markdown.js";
import { ImagePipelineService } from "./image-pipeline.service.js";
import { WordPressService } from "./wordpress.service.js";
import { CredentialService } from "./credential.service.js";
import { convertMarkdownToGutenberg } from "./markdown-to-gutenberg.js";
import { FeaturedImageService } from "./featured-image.service.js";
import { canGenerateFeaturedImage } from "../lib/plan-limits.js";
import { logger } from "../lib/logger.js";

export class SyncService {
  constructor(private prisma: PrismaClient) {}

  /** Sync a single Notion page to the database. Returns the post ID, WP status, and whether the post was previously published. */
  async syncPost(tenantId: string, notionPageId: string, onStep?: (step: string) => void): Promise<{ postId: string; wpStatus: string | null; wasPublished: boolean }> {
    const credService = new CredentialService(this.prisma);

    // Get tenant credentials
    const notionCreds = await credService.getNotionCredentials(tenantId);
    if (!notionCreds) throw new Error("Notion credentials not configured");

    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) throw new Error("WordPress credentials not configured");

    const notion = new NotionService(notionCreds.accessToken);
    const wp = new WordPressService(wpCreds);

    logger.info({ tenantId, notionPageId }, "Syncing post from Notion");

    // 0. Update Notion status so the user sees immediate feedback
    await notion.updatePageStatus(notionPageId, "Syncing");

    // 1. Get page properties and blocks
    onStep?.("Fetching from Notion…");
    const page = await notion.getPageProperties(notionPageId);
    const blocks = await notion.getPageBlocks(notionPageId);

    // Extract last_edited_time for change detection on future re-syncs
    const pageObj = page as Record<string, unknown>;
    const notionLastEdit = pageObj.last_edited_time
      ? new Date(pageObj.last_edited_time as string)
      : undefined;

    // 2. Convert to markdown
    onStep?.("Converting to markdown…");
    const result = convertNotionBlocksToMarkdown(
      blocks as Array<Record<string, unknown>>,
      pageObj.properties as Record<string, unknown>,
      notionPageId,
    );

    // 3. Resolve category
    const category = result.metadata.category
      ? await this.prisma.category.findUnique({
          where: { tenantId_name: { tenantId, name: result.metadata.category } },
        })
      : null;

    logger.info({ title: result.metadata.title, category: result.metadata.category, imageCount: result.images.length }, "Notion content parsed");

    // Determine final status: re-syncing a published post → UPDATE_PENDING
    const existing = await this.prisma.post.findUnique({
      where: { tenantId_notionPageId: { tenantId, notionPageId } },
      select: { wpPostId: true, status: true },
    });
    const isUpdate = existing?.wpPostId != null;
    const wasPublished = existing?.status === "PUBLISHED";
    const finalStatus = isUpdate ? "UPDATE_PENDING" : "SYNCED";
    logger.info({ isUpdate, wpPostId: existing?.wpPostId, wasPublished, finalStatus }, "Sync mode determined");

    // 4. Process images if any
    let postId: string;
    let finalMarkdown = result.markdown;

    if (result.images.length > 0) {
      onStep?.(`Processing ${result.images.length} image${result.images.length === 1 ? "" : "s"}…`);
      const pipeline = new ImagePipelineService(this.prisma, wp);

      // Upsert post first (need ID for image mapping) and mark as processing
      const post = await this.upsertPost(
        tenantId,
        notionPageId,
        result,
        category?.id,
        "IMAGES_PROCESSING",
        notionLastEdit,
      );
      postId = post.id;

      const imageResult = await pipeline.processImages(
        tenantId,
        post.id,
        result.images,
        result.markdown,
        result.metadata.slug || result.metadata.title,
      );

      finalMarkdown = imageResult.processedContent;

      // Update with processed content and final status
      await this.prisma.post.update({
        where: { id: post.id },
        data: {
          markdownContent: finalMarkdown,
          status: finalStatus,
          syncedAt: new Date(),
        },
      });

      await pipeline.cleanupOrphans(tenantId, post.id, imageResult.mappingIds);
    } else {
      const post = await this.upsertPost(
        tenantId,
        notionPageId,
        result,
        category?.id,
        finalStatus,
        notionLastEdit,
      );
      postId = post.id;
    }

    // 5. Create or update WordPress draft
    onStep?.(isUpdate ? "Updating WP post…" : "Creating WP draft…");
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codeHighlighter: true, plan: true, trialEndsAt: true, wpSeoPlugin: true },
    });
    const highlighter = tenant!.codeHighlighter;
    const featuredImagesAllowed = canGenerateFeaturedImage(tenant!.plan, tenant!.trialEndsAt);

    // Determine whether to update the existing WP post or create a new draft.
    // If the existing WP post was deleted, fall back to creating a new draft and
    // re-upload any images whose WP media was also deleted.
    let needsNewDraft = !isUpdate;
    let wpStatus: string | null = null;
    let wpUrl: string | undefined;
    if (isUpdate) {
      const wpContent = convertMarkdownToGutenberg(finalMarkdown, { highlighter });
      let wpPostGone = false;
      try {
        // Fetch current WP status before editing. Use our DB as source of truth:
        // if the post was previously published in our system, always preserve "publish"
        // status — a prior sync may have accidentally reverted WP to draft.
        const currentPost = await wp.getPost(existing!.wpPostId!);
        const preserveStatus = (wasPublished || currentPost?.status === "publish") ? "publish" : undefined;
        logger.info({ wpPostId: existing!.wpPostId, currentWpStatus: currentPost?.status, wasPublished, preserveStatus }, "WP post status before edit");

        const updated = await wp.editPost(existing!.wpPostId!, {
          title: result.metadata.title,
          content: wpContent,
          ...(preserveStatus && { status: preserveStatus }),
        });
        wpStatus = updated.status ?? null;
        wpUrl = updated.status === "publish"
          ? (updated.link ?? undefined)
          : `${wpCreds.siteUrl}/wp-admin/post.php?post=${existing!.wpPostId!}&action=edit`;
        // WP returns 200 even for trashed posts — treat trash the same as deleted
        if (updated.status === "trash") {
          logger.warn({ wpPostId: existing!.wpPostId }, "WP post is trashed, re-creating draft");
          wpPostGone = true;
        }

        // Apply/refresh SEO meta on the existing WP post
        if (result.metadata.seoKeyword && !wpPostGone) {
          onStep?.("Setting SEO metadata…");
          const seoDescription = this.deriveDescription(finalMarkdown);
          await wp.updateSeo(existing!.wpPostId!, {
            keyword: result.metadata.seoKeyword,
            title: "%title%",
            description: seoDescription,
          }, tenant!.wpSeoPlugin);
          await this.prisma.post.update({
            where: { id: postId },
            data: { seoDescription },
          });
          logger.info({ wpPostId: existing!.wpPostId, seoKeyword: result.metadata.seoKeyword }, "SEO meta updated");
        }
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) {
          logger.warn({ wpPostId: existing!.wpPostId }, "WP post not found (deleted?), re-creating draft");
          wpPostGone = true;
        } else {
          throw err;
        }
      }

      if (wpPostGone) {
        needsNewDraft = true;
        // Clear stale wpPostId/featured media so the new draft ID gets stored cleanly
        await this.prisma.post.update({
          where: { id: postId },
          data: { wpPostId: null, wpFeaturedMediaId: null },
        });
        // Clear stale image mappings so processImages re-uploads fresh copies
        if (result.images.length > 0) {
          await this.prisma.imageMapping.deleteMany({ where: { tenantId, postId } });
          const pipeline = new ImagePipelineService(this.prisma, wp);
          const imgSlug = result.metadata.slug || result.metadata.title;
          const reimageResult = await pipeline.processImages(
            tenantId, postId, result.images, result.markdown, imgSlug,
          );
          finalMarkdown = reimageResult.processedContent;
          await this.prisma.post.update({
            where: { id: postId },
            data: { markdownContent: finalMarkdown },
          });
        }
      }
    }

    if (needsNewDraft) {
      // Guard: re-check DB for existing wpPostId to prevent duplicate WP drafts.
      // A concurrent job or prior sync may have already created one.
      const freshPost = await this.prisma.post.findUnique({
        where: { tenantId_notionPageId: { tenantId, notionPageId } },
        select: { wpPostId: true },
      });
      if (freshPost?.wpPostId) {
        logger.warn({ tenantId, notionPageId, wpPostId: freshPost.wpPostId }, "Post already has a WP draft — aborting to prevent duplicate");
        onStep?.("Updating Notion status…");
        const existingWpUrl = `${wpCreds.siteUrl}/wp-admin/post.php?post=${freshPost.wpPostId}&action=edit`;
        await notion.updatePageStatus(notionPageId, "Ready to Review", existingWpUrl);
        return { postId, wpStatus: "draft", wasPublished: false };
      }

      // Re-convert markdown → Gutenberg using the (possibly refreshed) finalMarkdown
      let wpContent = convertMarkdownToGutenberg(finalMarkdown, { highlighter });

      // Resolve tag IDs (post tags take priority over category defaults)
      // Best-effort: some WP sites have /tags endpoint disabled (404)
      const tagNames = result.metadata.tags ?? [];
      let tagIds: number[] = [];
      try {
        tagIds = tagNames.length > 0
          ? await wp.resolveTagIds(tagNames)
          : (category?.wpTagIds ?? []);
      } catch (err) {
        logger.warn({ err }, "Failed to resolve tag IDs — skipping tags");
      }

      // Generate featured image (Pro/Trial only)
      let wpFeaturedMediaId: number | undefined;
      if (!featuredImagesAllowed) {
        logger.info({ tenantId }, "Featured image generation skipped — Free plan");
      } else if (!result.metadata.featuredImageTitle) {
        logger.warn("featuredImageTitle is empty — skipping featured image");
      }
      if (featuredImagesAllowed && result.metadata.featuredImageTitle) {
        onStep?.("Generating featured image…");
        const imgService = new FeaturedImageService();
        const slug = result.metadata.slug || result.metadata.title;
        const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 60);
        const { buffer: imageBuffer, unsplashAttribution } = await imgService.generate({
          title: result.metadata.featuredImageTitle,
          category: category?.name || result.metadata.category || "Blog",
          backgroundImageUrl: category?.backgroundImage || undefined,
        });
        const media = await wp.uploadMedia(imageBuffer, `${safeSlug}-featured.png`);
        await wp.updateMediaMeta(media.id, {
          alt_text: result.metadata.featuredImageTitle,
          title: result.metadata.featuredImageTitle,
        });
        wpFeaturedMediaId = media.id;
        logger.info({ wpFeaturedMediaId }, "Featured image uploaded to WP");

        if (unsplashAttribution) {
          const { photographerName, photographerUrl } = unsplashAttribution;
          wpContent += `\n\n<!-- wp:paragraph {"className":"unsplash-credit","style":{"typography":{"fontSize":"14px"}}} -->\n<p class="unsplash-credit" style="font-size:14px">Photo by <a href="${photographerUrl}?utm_source=notipo&amp;utm_medium=referral">${photographerName}</a> on <a href="https://unsplash.com?utm_source=notipo&amp;utm_medium=referral">Unsplash</a></p>\n<!-- /wp:paragraph -->`;
        }
      }

      // Create a new WP draft for review
      const wpPost = await wp.createDraft({
        title: result.metadata.title,
        content: wpContent,
        status: "draft",
        slug: result.metadata.slug ?? undefined,
        categories: category?.wpCategoryId ? [category.wpCategoryId] : undefined,
        tags: tagIds.length ? tagIds : undefined,
        featured_media: wpFeaturedMediaId,
      });
      wpUrl = `${wpCreds.siteUrl}/wp-admin/post.php?post=${wpPost.id}&action=edit`;
      logger.info({ wpPostId: wpPost.id, wpPostStatus: wpPost.status, wpUrl }, "WP draft created");
      await this.prisma.post.update({
        where: { id: postId },
        data: {
          wpPostId: wpPost.id,
          wpFeaturedMediaId: wpFeaturedMediaId ?? null,
          wpUrl: wpUrl,
          wpContent,
        },
      });

      // Apply SEO meta on the draft so it's visible during review
      if (result.metadata.seoKeyword) {
        onStep?.("Setting SEO metadata…");
        const seoDescription = this.deriveDescription(finalMarkdown);
        await wp.updateSeo(wpPost.id, {
          keyword: result.metadata.seoKeyword,
          title: "%title%",
          description: seoDescription,
        }, tenant!.wpSeoPlugin);
        await this.prisma.post.update({
          where: { id: postId },
          data: { seoDescription },
        });
        logger.info({ wpPostId: wpPost.id, seoKeyword: result.metadata.seoKeyword }, "SEO meta applied to draft");
      }
    }

    // 6. Update Notion status.
    // For updates to live WP posts, skip — the publish job will set "Published" + live URL.
    // Use both WP API status AND our DB status (wasPublished) as fallback in case
    // a prior sync accidentally reverted the WP post to draft.
    if (!(isUpdate && (wpStatus === "publish" || wasPublished))) {
      onStep?.("Updating Notion status…");
      await notion.updatePageStatus(notionPageId, "Ready to Review", wpUrl);
    }

    logger.info({ tenantId, notionPageId, postId }, "Post synced successfully");
    return { postId, wpStatus, wasPublished };
  }

  /** Strip markdown syntax and truncate to ~160 chars for SEO description. */
  private deriveDescription(markdown: string): string {
    const plain = markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")  // images
      .replace(/\[[^\]]*\]\([^)]*\)/g, "")   // links
      .replace(/[#*_`~>|-]/g, "")             // markdown syntax
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > 160 ? plain.slice(0, 159).trimEnd() + "..." : plain;
  }

  private async upsertPost(
    tenantId: string,
    notionPageId: string,
    result: ReturnType<typeof convertNotionBlocksToMarkdown>,
    categoryId?: string | null,
    status: "SYNCED" | "IMAGES_PROCESSING" | "UPDATE_PENDING" = "SYNCED",
    notionLastEdit?: Date,
  ) {
    const tags = result.metadata.tags ?? [];
    return this.prisma.post.upsert({
      where: { tenantId_notionPageId: { tenantId, notionPageId } },
      update: {
        title: result.metadata.title,
        slug: result.metadata.slug,
        markdownContent: result.markdown,
        seoKeyword: result.metadata.seoKeyword,
        featuredImageTitle: result.metadata.featuredImageTitle,
        categoryId: categoryId ?? undefined,
        tags,
        notionLastEdit,
        status,
        syncedAt: new Date(),
      },
      create: {
        tenantId,
        notionPageId,
        title: result.metadata.title,
        slug: result.metadata.slug,
        markdownContent: result.markdown,
        seoKeyword: result.metadata.seoKeyword,
        featuredImageTitle: result.metadata.featuredImageTitle,
        categoryId: categoryId ?? undefined,
        tags,
        notionLastEdit,
        status,
        syncedAt: new Date(),
      },
    });
  }
}
