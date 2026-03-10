import type { CodeHighlighter } from "@prisma/client";

// Notion block conversion output
export interface NotionConversionResult {
  markdown: string;
  metadata: {
    title: string;
    category: string;
    featuredImageTitle: string;
    notionId: string;
    seoKeyword?: string;
    slug?: string;
    tags?: string[];
  };
  images: ImageRef[];
}

export interface ImageRef {
  alt: string;
  url: string;
  fullMatch: string;
}

// Image pipeline
export interface ImageMapping {
  notionImageUrl: string;
  wpImageUrl: string;
  wpMediaId: number;
  filename: string;
}

export interface ProcessedImages {
  urlMap: Record<string, string>;
  mappingIds: string[];
  processedContent: string;
}

// WordPress
export interface WPPostPayload {
  title: string;
  content: string;
  status: "draft" | "publish";
  slug?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}

export interface WPMediaUpload {
  id: number;
  source_url: string;
  title: { rendered: string };
  alt_text: string;
}

export interface SeoPayload {
  keyword: string;
  title: string;
  description: string;
}

// Featured image generation
export interface FeaturedImageRequest {
  title: string;
  category: string;
  backgroundImageUrl?: string;
}

export interface UnsplashAttribution {
  photographerName: string;
  photographerUrl: string;
}

export interface FeaturedImageResult {
  buffer: Buffer;
  unsplashAttribution?: UnsplashAttribution;
}

// Gutenberg conversion
export interface GutenbergOptions {
  highlighter: CodeHighlighter;
}
