import type { ImageRef } from "../types/index.js";

/**
 * Extract image references from markdown that need uploading to WordPress.
 * Matches ![alt](url) patterns with http(s) or data: URIs.
 * Skips images inside fenced code blocks and images already hosted on the tenant's WordPress site.
 */
export function extractImageRefs(markdown: string, wpSiteUrl?: string): ImageRef[] {
  // Strip fenced code blocks before extracting images
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");

  const imageRegex = /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^)]+)\)/g;
  const images: ImageRef[] = [];
  let match;
  while ((match = imageRegex.exec(withoutCode)) !== null) {
    const url = match[2];
    // Skip images already on the user's WordPress site
    if (wpSiteUrl && url.startsWith(wpSiteUrl)) continue;
    images.push({ alt: match[1], url, fullMatch: match[0] });
  }
  return images;
}
