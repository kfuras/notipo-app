/**
 * Image processing pipeline.
 * Ported from n8n workflow ojxkaTVjMVFmj9IA, F2 flow nodes.
 *
 * Extracts Notion S3 image URLs from markdown, checks PostgreSQL cache,
 * downloads new images, uploads to WordPress, stores mappings,
 * and replaces URLs in content.
 */

import type { PrismaClient } from "@prisma/client";
import type { WordPressService } from "./wordpress.service.js";
import type { ImageRef, ProcessedImages } from "../types/index.js";
import { createHash } from "node:crypto";
import axios from "axios";
import { logger } from "../lib/logger.js";

/** Strip query parameters from a URL for cache lookup. */
function baseUrl(url: string): string {
  if (url.startsWith("data:")) return dataUriCacheKey(url);
  return url.split("?")[0];
}

/** Generate a stable cache key for data URIs (too large to store as-is). */
function dataUriCacheKey(dataUri: string): string {
  const hash = createHash("sha256").update(dataUri.slice(0, 2000)).digest("hex").slice(0, 32);
  return `data:hash:${hash}`;
}

/** Extract MIME extension from a data URI or URL. */
function extractExtension(url: string): string {
  if (url.startsWith("data:")) {
    const mime = url.match(/^data:image\/(\w+)/)?.[1] ?? "png";
    return mime === "jpeg" ? "jpg" : mime;
  }
  return baseUrl(url).split(".").pop() || "png";
}

/** Generate a filename from post slug and index. */
function generateFilename(slug: string, index: number, url: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 60);
  const ext = extractExtension(url);
  return `${safe}-${String(index + 1).padStart(2, "0")}.${ext}`;
}

export class ImagePipelineService {
  constructor(
    private prisma: PrismaClient,
    private wp: WordPressService,
  ) {}

  /** Process all images in a post's markdown content. */
  async processImages(
    tenantId: string,
    postId: string,
    images: ImageRef[],
    originalContent: string,
    slug: string,
  ): Promise<ProcessedImages> {
    const urlMap: Record<string, string> = {};
    const mappingIds: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const base = baseUrl(img.url);
      const filename = generateFilename(slug, i, img.url);

      // Check cache
      const cached = await this.prisma.imageMapping.findUnique({
        where: { tenantId_notionImageUrl: { tenantId, notionImageUrl: base } },
      });

      if (cached) {
        urlMap[base] = cached.wpImageUrl;
        mappingIds.push(cached.id);
      } else {
        // Download image (supports HTTP URLs and base64 data URIs)
        let buffer: Buffer;
        if (img.url.startsWith("data:")) {
          const base64Data = img.url.split(",")[1];
          if (!base64Data) throw new Error(`Invalid data URI for image ${i}`);
          buffer = Buffer.from(base64Data, "base64");
        } else {
          const response = await axios.get(img.url, { responseType: "arraybuffer" });
          buffer = Buffer.from(response.data);
        }

        // Upload to WordPress
        const media = await this.wp.uploadMedia(buffer, filename);

        // Set alt text from markdown if available
        if (img.alt) {
          await this.wp.updateMediaMeta(media.id, { alt_text: img.alt }).catch((e) =>
            logger.warn({ wpMediaId: media.id, err: e }, "Failed to set alt text on uploaded image"),
          );
        }

        // Store mapping
        const mapping = await this.prisma.imageMapping.create({
          data: {
            tenantId,
            notionImageUrl: base,
            wpImageUrl: media.source_url,
            wpMediaId: media.id,
            filename,
            postId,
          },
        });

        urlMap[base] = media.source_url;
        mappingIds.push(mapping.id);
      }
    }

    // Replace all source image URLs with WordPress URLs in content.
    // For data URIs, replace the full match (regex on base64 is impractical).
    // For HTTP URLs, replace base URL + optional query params.
    let processedContent = originalContent;
    for (const img of images) {
      const wpUrl = urlMap[baseUrl(img.url)];
      if (!wpUrl) continue;
      if (img.url.startsWith("data:")) {
        processedContent = processedContent.replace(img.fullMatch, `![${img.alt}](${wpUrl})`);
      } else {
        const escapedBase = baseUrl(img.url).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escapedBase + "(\\?[^)\\s]*)?", "g");
        processedContent = processedContent.replace(regex, wpUrl);
      }
    }

    return { urlMap, mappingIds, processedContent };
  }

  /** Remove image mappings not in the current mapping list, deleting from WordPress too. */
  async cleanupOrphans(tenantId: string, postId: string, currentMappingIds: string[]) {
    const orphans = await this.prisma.imageMapping.findMany({
      where: { tenantId, postId, id: { notIn: currentMappingIds } },
      select: { id: true, wpMediaId: true },
    });

    if (orphans.length === 0) return;

    // Delete from WordPress (best-effort — don't fail sync if WP delete errors)
    const results = await Promise.allSettled(
      orphans.map((o) => this.wp.deleteMedia(o.wpMediaId)),
    );
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.warn({ wpMediaId: orphans[i].wpMediaId, err: r.reason }, "Failed to delete orphan WP media");
      }
    });

    // Delete from DB
    await this.prisma.imageMapping.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
  }
}
