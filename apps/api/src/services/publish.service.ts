/**
 * Publish orchestrator: Database → WordPress.
 * Replaces the "Publish to Wordpress" n8n workflow.
 *
 * The sync service already creates the WP draft with correct content,
 * categories, tags, featured image, and SEO metadata. This service
 * just flips the draft to "publish" and updates Notion.
 */

import type { PrismaClient } from "@prisma/client";
import { WordPressService } from "./wordpress.service.js";
import { FeaturedImageService } from "./featured-image.service.js";
import { CredentialService } from "./credential.service.js";
import { NotionService } from "./notion.service.js";
import { convertMarkdownToGutenberg } from "./markdown-to-gutenberg.js";
import { logger } from "../lib/logger.js";

export class PublishService {
  constructor(private prisma: PrismaClient) {}

  /** Publish a post from the database to WordPress. */
  async publishPost(tenantId: string, postId: string, onStep?: (step: string) => void) {
    const credService = new CredentialService(this.prisma);

    // Load post with relations
    const post = await this.prisma.post.findFirst({
      where: { id: postId, tenantId },
      include: { category: true, tenant: true },
    });
    if (!post) throw new Error("Post not found");
    if (!post.markdownContent) throw new Error("Post has no content");

    // Get credentials
    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) throw new Error("WordPress credentials not configured");

    const wp = new WordPressService(wpCreds);

    // Update status
    await this.prisma.post.update({
      where: { id: postId },
      data: { status: "PUBLISHING" },
    });

    logger.info({ tenantId, postId }, "Publishing post to WordPress");

    // Update Notion status so the user sees immediate feedback
    const notionCreds = await credService.getNotionCredentials(tenantId);
    if (notionCreds && post.notionPageId) {
      const notion = new NotionService(notionCreds.accessToken);
      await notion.updatePageStatus(post.notionPageId, "Publishing");
    }

    // Check if the WP post still exists before attempting to publish
    if (post.wpPostId) {
      try {
        const currentWpPost = await wp.getPost(post.wpPostId);
        if (currentWpPost?.status === "trash") {
          logger.warn({ wpPostId: post.wpPostId }, "WP post is trashed, will re-create from scratch");
          await this.prisma.post.update({
            where: { id: postId },
            data: { wpPostId: null, wpFeaturedMediaId: null },
          });
          post.wpPostId = null;
          post.wpFeaturedMediaId = null;
        }
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) {
          logger.warn({ wpPostId: post.wpPostId }, "WP post deleted, will re-create from scratch");
          await this.prisma.post.update({
            where: { id: postId },
            data: { wpPostId: null, wpFeaturedMediaId: null },
          });
          post.wpPostId = null;
          post.wpFeaturedMediaId = null;
        } else {
          throw err;
        }
      }
    }

    if (post.wpPostId) {
      // Normal path: WP draft already exists from sync — just publish it
      onStep?.("Publishing…");
      const published = await wp.publishPost(post.wpPostId);

      // Apply/refresh Rank Math SEO meta
      onStep?.("Setting SEO metadata…");
      let seoDescription = post.seoDescription;
      if (post.seoKeyword) {
        if (!seoDescription) {
          // Derive description from WP-generated excerpt on first publish
          const excerpt = published.excerpt?.rendered || "";
          const clean = excerpt.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (clean) {
            seoDescription = clean.length > 160 ? clean.slice(0, 159).trimEnd() + "..." : clean;
          }
        }
        await wp.updateSeo(post.wpPostId, {
          keyword: post.seoKeyword,
          title: "%title%",
          description: seoDescription ?? "",
        }, post.tenant.wpSeoPlugin);
        logger.info({ wpPostId: post.wpPostId, seoKeyword: post.seoKeyword }, "SEO meta applied");
      } else {
        logger.warn({ postId }, "seoKeyword not set — skipping SEO (set 'SEO Keyword' in Notion)");
      }

      await this.prisma.post.update({
        where: { id: postId },
        data: {
          wpUrl: published.link ?? post.wpUrl,
          seoDescription: seoDescription ?? undefined,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });
    } else {
      // Fallback: no WP draft yet — create one from scratch and publish
      onStep?.("Converting to Gutenberg…");
      let wpContent = convertMarkdownToGutenberg(post.markdownContent, {
        highlighter: post.tenant.codeHighlighter,
      });

      // Generate featured image if needed
      let wpFeaturedMediaId: number | undefined = post.wpFeaturedMediaId ?? undefined;
      if (!wpFeaturedMediaId && post.featuredImageTitle) {
        onStep?.("Generating featured image…");
        const imgService = new FeaturedImageService();
        const { buffer: imageBuffer, unsplashAttribution } = await imgService.generate({
          title: post.featuredImageTitle,
          category: post.category?.name || "Blog",
          backgroundImageUrl: post.category?.backgroundImage || undefined,
        });
        const slug = post.slug || post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const media = await wp.uploadMedia(imageBuffer, `${slug}-featured.png`);
        await wp.updateMediaMeta(media.id, {
          alt_text: post.featuredImageTitle,
          title: post.featuredImageTitle,
        });
        wpFeaturedMediaId = media.id;

        if (unsplashAttribution) {
          const { photographerName, photographerUrl } = unsplashAttribution;
          wpContent += `\n\n<!-- wp:paragraph {"className":"unsplash-credit","style":{"typography":{"fontSize":"14px"}}} -->\n<p class="unsplash-credit" style="font-size:14px">Photo by <a href="${photographerUrl}?utm_source=notipo&amp;utm_medium=referral">${photographerName}</a> on <a href="https://unsplash.com?utm_source=notipo&amp;utm_medium=referral">Unsplash</a></p>\n<!-- /wp:paragraph -->`;
        }
      }

      // Resolve tags
      let tagIds: number[] = [];
      try {
        tagIds = post.tags.length > 0
          ? await wp.resolveTagIds(post.tags)
          : (post.category?.wpTagIds ?? []);
      } catch (err) {
        logger.warn({ err }, "Failed to resolve tag IDs — skipping tags");
      }

      onStep?.("Creating WP draft…");
      const wpPost = await wp.createDraft({
        title: post.title,
        content: wpContent,
        status: "draft",
        slug: post.slug ?? undefined,
        categories: post.category?.wpCategoryId ? [post.category.wpCategoryId] : undefined,
        tags: tagIds.length ? tagIds : undefined,
        featured_media: wpFeaturedMediaId,
      });

      onStep?.("Publishing…");
      const published = await wp.publishPost(wpPost.id);

      // Apply Rank Math SEO meta
      onStep?.("Setting SEO metadata…");
      let seoDescription: string | undefined;
      if (post.seoKeyword) {
        const excerpt = published.excerpt?.rendered || "";
        const clean = excerpt.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (clean) {
          seoDescription = clean.length > 160 ? clean.slice(0, 159).trimEnd() + "..." : clean;
        }
        await wp.updateSeo(wpPost.id, {
          keyword: post.seoKeyword,
          title: "%title%",
          description: seoDescription ?? "",
        }, post.tenant.wpSeoPlugin);
        logger.info({ wpPostId: wpPost.id, seoKeyword: post.seoKeyword }, "SEO meta applied");
      } else {
        logger.warn({ postId }, "seoKeyword not set — skipping SEO (set 'SEO Keyword' in Notion)");
      }

      await this.prisma.post.update({
        where: { id: postId },
        data: {
          wpPostId: wpPost.id,
          wpUrl: published.link ?? wpPost.link,
          wpContent,
          wpFeaturedMediaId: wpFeaturedMediaId ?? undefined,
          seoDescription: seoDescription ?? undefined,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });
    }

    // Update Notion status with the published WP URL
    onStep?.("Updating Notion status…");
    if (notionCreds && post.notionPageId) {
      const updatedPost = await this.prisma.post.findUnique({ where: { id: postId }, select: { wpUrl: true } });
      const notion = new NotionService(notionCreds.accessToken);
      await notion.updatePageStatus(post.notionPageId, "Published", updatedPost?.wpUrl ?? undefined);
    }

    logger.info({ tenantId, postId, wpPostId: post.wpPostId }, "Post published");
  }
}
