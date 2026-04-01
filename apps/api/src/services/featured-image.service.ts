/**
 * Featured image generator.
 * Uses sharp for background resize/crop. Background sources: uploaded image,
 * Unsplash search, or gradient fallback. AI mode delegates to Gemini.
 */

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import axios from "axios";
import { isPrivateUrl } from "../lib/url-validation.js";
import { downloadFile } from "../lib/storage.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { GeminiImageService } from "./gemini-image.service.js";
import type { FeaturedImageRequest, FeaturedImageResult, UnsplashAttribution } from "../types/index.js";

const WIDTH = 1200;
const HEIGHT = 628;

// Gradient color pairs for fallback backgrounds when no image is set.
// Deterministically selected by category name for visual consistency.
const GRADIENTS: [string, string][] = [
  ["#1a1a2e", "#16213e"], // deep navy
  ["#0f3460", "#533483"], // navy → purple
  ["#2d3436", "#636e72"], // charcoal
  ["#1b1b2f", "#162447"], // midnight
  ["#0a3d62", "#3c6382"], // ocean blue
  ["#6a0572", "#ab83a1"], // plum
  ["#1e3a5f", "#4a8db7"], // steel blue
  ["#2c3e50", "#3498db"], // dark → bright blue
];

// In-memory cache for Unsplash search results (metadata only, not image bytes).
interface UnsplashSearchResult {
  id: string;
  url: string;
  downloadLocation: string;
  photographerName: string;
  photographerUrl: string;
}
const unsplashSearchCache = new Map<string, UnsplashSearchResult[]>();

/** Simple string hash for deterministic photo selection. */
function hashString(str: string): number {
  let hash = 0;
  for (const ch of str) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

interface UnsplashResult {
  buffer: Buffer;
  attribution: UnsplashAttribution;
}

export class FeaturedImageService {
  /**
   * Fetch a landscape photo from Unsplash for a category.
   * Searches by category name (cached), picks a photo by hashing the post title
   * so each post gets a different but deterministic background.
   * Only downloads the selected photo (not all results).
   */
  private async fetchUnsplashBackground(category: string, title: string): Promise<UnsplashResult | null> {
    if (!config.UNSPLASH_ACCESS_KEY) return null;

    let results = unsplashSearchCache.get(category);

    if (!results) {
      try {
        const search = await axios.get<{
          results: Array<{
            id: string;
            urls: { regular: string };
            links: { download_location: string };
            user: { name: string; links: { html: string } };
          }>;
        }>("https://api.unsplash.com/search/photos", {
          params: { query: category, orientation: "landscape", per_page: 30 },
          headers: { Authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}` },
          timeout: 10_000,
        });

        if (!search.data.results.length) return null;

        results = search.data.results.map((photo) => ({
          id: photo.id,
          url: photo.urls.regular,
          downloadLocation: photo.links.download_location,
          photographerName: photo.user.name,
          photographerUrl: photo.user.links.html,
        }));

        unsplashSearchCache.set(category, results);
        logger.info({ category, count: results.length }, "Cached Unsplash search results for category");
      } catch (err) {
        logger.warn({ err, category }, "Unsplash fetch failed — falling back to gradient");
        return null;
      }
    }

    // Pick a photo deterministically based on post title
    const index = hashString(title) % results.length;
    const photo = results[index];

    try {
      // Trigger download tracking (required by Unsplash ToS)
      axios.get(photo.downloadLocation, {
        headers: { Authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}` },
        timeout: 5_000,
      }).catch(() => {});

      const img = await axios.get<ArrayBuffer>(photo.url, {
        responseType: "arraybuffer",
        timeout: 15_000,
      });

      logger.info({ category, title, photoId: photo.id, index, photographer: photo.photographerName }, "Selected Unsplash background");
      return {
        buffer: Buffer.from(img.data),
        attribution: {
          photographerName: photo.photographerName,
          photographerUrl: photo.photographerUrl,
        },
      };
    } catch (err) {
      logger.warn({ err, category, photoId: photo.id }, "Unsplash image download failed — falling back to gradient");
      return null;
    }
  }

  /** Generate a gradient background when no image is configured. */
  private async generateGradientBackground(categoryName: string): Promise<Buffer> {
    let hash = 0;
    for (const ch of categoryName) hash = (hash + ch.charCodeAt(0)) % GRADIENTS.length;
    const [color1, color2] = GRADIENTS[hash];

    const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${color1}" />
          <stop offset="100%" stop-color="${color2}" />
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)" />
    </svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /** Generate a featured image and return PNG bytes with optional Unsplash attribution. */
  async generate(params: FeaturedImageRequest): Promise<FeaturedImageResult> {
    // AI-generated mode: delegate to Gemini, skip the standard sharp/canvas pipeline
    if (params.mode === "AI_GENERATED" && config.GEMINI_API_KEY) {
      const gemini = new GeminiImageService();
      const buffer = await gemini.generate({
        title: params.title,
        category: params.category,
        style: params.aiImageStyle || "minimalist",
        tags: params.tags,
      });
      return { buffer };
    }

    let resized: Buffer;
    let unsplashAttribution: UnsplashAttribution | undefined;

    if (params.backgroundImageUrl) {
      // Load background — gcs:/upload: ref from storage, URL via HTTP, plain filename from bundled assets
      let bgBuffer: Buffer;
      const bg = params.backgroundImageUrl;
      if (bg.startsWith("gcs:") || bg.startsWith("upload:")) {
        bgBuffer = await downloadFile(bg);
      } else if (bg.startsWith("http://") || bg.startsWith("https://")) {
        if (await isPrivateUrl(bg)) {
          throw new Error("Background image URL points to a private/internal address");
        }
        const res = await axios.get<ArrayBuffer>(bg, {
          responseType: "arraybuffer",
          timeout: 30_000,
          maxRedirects: 0,
        });
        bgBuffer = Buffer.from(res.data);
      } else {
        const localPath = path.join(
          process.cwd(),
          "public",
          "category-images",
          path.basename(bg),
        );
        bgBuffer = await fs.readFile(localPath);
      }

      // Resize background with attention-based smart crop
      resized = await sharp(bgBuffer)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
        .png()
        .toBuffer();
    } else {
      // No background image configured — try Unsplash, then gradient fallback
      const unsplashResult = await this.fetchUnsplashBackground(params.category, params.title);
      if (unsplashResult) {
        resized = await sharp(unsplashResult.buffer)
          .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
          .png()
          .toBuffer();
        unsplashAttribution = unsplashResult.attribution;
      } else {
        resized = await this.generateGradientBackground(params.category);
      }
    }

    return { buffer: resized, unsplashAttribution };
  }
}
