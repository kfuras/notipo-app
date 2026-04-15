import type { ImageRef } from "../types/index.js";

/**
 * Extract image references from markdown that need uploading to WordPress.
 * Matches ![alt](url) patterns with http(s) or data: URIs.
 * Skips images already hosted on the tenant's WordPress site.
 */
export function extractImageRefs(markdown: string, wpSiteUrl?: string): ImageRef[] {
  const imageRegex = /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^)]+)\)/g;
  const images: ImageRef[] = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const url = match[2];
    // Skip images already on the user's WordPress site
    if (wpSiteUrl && url.startsWith(wpSiteUrl)) continue;
    images.push({ alt: match[1], url, fullMatch: match[0] });
  }
  return images;
}
