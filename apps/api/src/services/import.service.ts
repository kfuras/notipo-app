/**
 * Import service: WordPress → Markdown → Notion.
 * Reverse of sync.service.ts.
 */

import type { PrismaClient } from "@prisma/client";
import { CredentialService } from "./credential.service.js";
import { WordPressService } from "./wordpress.service.js";
import { NotionService } from "./notion.service.js";
import { convertGutenbergToMarkdown } from "./gutenberg-to-markdown.js";
import { logger } from "../lib/logger.js";

export interface ImportResult {
  postId: string;
  notionPageId: string;
  title: string;
  skipped?: boolean;
}

export class ImportService {
  constructor(private prisma: PrismaClient) {}

  async importPost(
    tenantId: string,
    wpPostId: number,
    overwrite: boolean,
    onStep?: (step: string) => void,
    wpCategoryMap?: Record<number, string>,
    wpTagMap?: Record<number, string>,
  ): Promise<ImportResult> {
    // 1. Check for existing import
    const existing = await this.prisma.post.findFirst({
      where: { tenantId, wpPostId },
    });

    if (existing && !overwrite) {
      return {
        postId: existing.id,
        notionPageId: existing.notionPageId || "",
        title: existing.title,
        skipped: true,
      };
    }

    // 2. Get credentials
    const credService = new CredentialService(this.prisma);
    const wpCreds = await credService.getWordPressCredentials(tenantId);
    if (!wpCreds) throw new Error("WordPress not connected");
    const notionCreds = await credService.getNotionCredentials(tenantId);
    if (!notionCreds) throw new Error("Notion not connected");

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { notionDatabaseId: true, wpSeoPlugin: true },
    });
    if (!tenant.notionDatabaseId) throw new Error("Notion database not configured");

    const wp = new WordPressService(wpCreds);
    const notion = new NotionService(notionCreds.accessToken);

    // 3. Fetch WP post
    onStep?.("Fetching WordPress post…");
    const wpPost = await wp.getPost(wpPostId);
    const title = this.decodeHtmlEntities(wpPost.title.rendered);

    // 4. Resolve category/tag names
    onStep?.("Resolving categories and tags…");
    let catMap = wpCategoryMap;
    let tagMap = wpTagMap;
    if (!catMap || !tagMap) {
      const [cats, tags] = await Promise.all([
        wp.listCategories(),
        wp.listTags(),
      ]);
      if (!catMap) catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
      if (!tagMap) tagMap = Object.fromEntries(tags.map((t) => [t.id, t.name]));
    }

    const categoryName = wpPost.categories?.length
      ? catMap[wpPost.categories[0]] || undefined
      : undefined;
    const tagNames = (wpPost.tags || [])
      .map((id: number) => tagMap![id])
      .filter(Boolean) as string[];

    // 5. Extract SEO keyword from WP post meta (Rank Math, Yoast, SEOPress)
    const meta = wpPost.meta as Record<string, unknown> | undefined;
    let seoKeyword = (
      meta?.rank_math_focus_keyword ||
      meta?.["_yoast_wpseo_focuskw"] ||
      meta?.["_seopress_analysis_target_kw"]
    ) as string | undefined || undefined;

    // If meta didn't have the keyword (context=edit may have fallen back), try plugin-specific API
    if (!seoKeyword && tenant.wpSeoPlugin === "rankmath") {
      seoKeyword = await wp.getRankMathFocusKeyword(wpPostId);
    }

    logger.info({ tenantId, wpPostId, slug: wpPost.slug, metaKeys: Object.keys(meta || {}), seoKeyword, wpPostKeys: Object.keys(wpPost) }, "WP post SEO fields");

    // 6. Convert HTML to markdown
    onStep?.("Converting content to markdown…");
    const markdown = convertGutenbergToMarkdown(wpPost.content.rendered);

    // 6. Sync Notion database options for category/tags
    if (categoryName || tagNames.length) {
      onStep?.("Syncing Notion database options…");
      await notion.syncDatabaseOptions(
        tenant.notionDatabaseId,
        categoryName ? [categoryName] : [],
        tagNames,
      );
    }

    // 7. Create or update Notion page
    const notionStatus = wpPost.status === "publish" ? "Published" : "Ready to Review";
    let notionPageId: string;

    if (existing && overwrite && existing.notionPageId) {
      onStep?.("Updating Notion page…");
      // Archive the old page and create a new one (Notion API doesn't support full content replacement)
      try {
        await notion.updatePageStatus(existing.notionPageId, "Archived");
      } catch {
        // Page may already be deleted
      }
      notionPageId = await notion.createPage(tenant.notionDatabaseId, {
        title,
        status: notionStatus,
        category: categoryName,
        tags: tagNames,
        body: markdown,
      });
    } else {
      onStep?.("Creating Notion page…");
      notionPageId = await notion.createPage(tenant.notionDatabaseId, {
        title,
        status: notionStatus,
        category: categoryName,
        tags: tagNames,
        body: markdown,
      });
    }

    // Set SEO Keyword and Slug separately so failures don't break the import
    await notion.updatePageSeoFields(notionPageId, {
      seoKeyword: seoKeyword || undefined,
      slug: wpPost.slug || undefined,
    }).catch((err: unknown) => {
      logger.warn({ tenantId, wpPostId, notionPageId, err: err instanceof Error ? err.message : String(err) }, "Could not set SEO/Slug fields on Notion page");
    });

    // Set WordPress Link URL on the Notion page
    const wpUrl = wpPost.status === "publish"
      ? wpPost.link
      : `${wpCreds.siteUrl}/wp-admin/post.php?post=${wpPostId}&action=edit`;
    await notion.updatePageStatus(notionPageId, notionStatus, wpUrl);

    // 8. Resolve local category record
    let categoryId: string | undefined;
    if (categoryName) {
      const cat = await this.prisma.category.findUnique({
        where: { tenantId_name: { tenantId, name: categoryName } },
      });
      categoryId = cat?.id;
    }

    // 9. Upsert Post record
    onStep?.("Saving post record…");
    const postStatus = wpPost.status === "publish" ? "PUBLISHED" : "SYNCED";

    const postData = {
      title,
      slug: wpPost.slug || undefined,
      markdownContent: markdown,
      wpContent: wpPost.content.rendered,
      notionPageId,
      wpUrl,
      categoryId: categoryId || null,
      tags: tagNames,
      status: postStatus as "PUBLISHED" | "SYNCED",
      syncedAt: new Date(),
      ...(wpPost.status === "publish" && { publishedAt: new Date() }),
    };

    let post;
    if (existing) {
      post = await this.prisma.post.update({
        where: { id: existing.id },
        data: postData,
      });
    } else {
      post = await this.prisma.post.create({
        data: {
          tenantId,
          wpPostId,
          ...postData,
        },
      });
    }

    logger.info({ tenantId, wpPostId, postId: post.id, notionPageId }, "WordPress post imported to Notion");

    return { postId: post.id, notionPageId, title };
  }

  private decodeHtmlEntities(s: string): string {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#8217;/g, "\u2019")
      .replace(/&#8216;/g, "\u2018")
      .replace(/&#8220;/g, "\u201C")
      .replace(/&#8221;/g, "\u201D")
      .replace(/&#8211;/g, "\u2013")
      .replace(/&#8212;/g, "\u2014")
      .replace(/&#8230;/g, "\u2026")
      .replace(/&nbsp;/g, " ");
  }
}
