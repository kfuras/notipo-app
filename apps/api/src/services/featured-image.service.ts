/**
 * Featured image generator — in-process Node.js replacement for the Python sidecar.
 * Uses sharp for background resize/crop and @napi-rs/canvas for text compositing
 * with a bundled DejaVu Sans Bold font for consistent rendering across all environments.
 */

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import axios from "axios";
import { isPrivateUrl } from "../lib/url-validation.js";
import { downloadFile } from "../lib/storage.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { GeminiImageService } from "./gemini-image.service.js";
import type { FeaturedImageRequest, FeaturedImageResult, UnsplashAttribution } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 1200;
const HEIGHT = 628;
const FONT_SIZE = 50;
const SMALL_FONT_SIZE = 24;
const LINE_HEIGHT = FONT_SIZE + 14;
const FONT_NAME = "DejaVuSans";

// Lazy-load @napi-rs/canvas — its prebuilt binary requires modern CPU instructions
// (SSE4/AVX) that older/basic KVM virtual CPUs may not support.
let canvasModule: typeof import("@napi-rs/canvas") | null = null;
let fontRegistered = false;

async function getCanvas() {
  if (!canvasModule) {
    canvasModule = await import("@napi-rs/canvas");
  }
  if (!fontRegistered) {
    canvasModule.GlobalFonts.registerFromPath(
      path.join(__dirname, "../../public/fonts/DejaVuSans-Bold.ttf"),
      FONT_NAME,
    );
    fontRegistered = true;
  }
  return canvasModule;
}

function wrapText(
  ctx: { measureText: (text: string) => { width: number } },
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

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

    // Compose overlay and text on canvas
    const { createCanvas, loadImage } = await getCanvas();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    // Draw background
    ctx.drawImage(await loadImage(resized), 0, 0, WIDTH, HEIGHT);

    // Dark overlay — rgba(0,0,0,100/255) matches the Python service's opacity
    ctx.fillStyle = "rgba(0,0,0,0.39)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Category label — top left
    ctx.font = `${SMALL_FONT_SIZE}px ${FONT_NAME}`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(params.category, 40, 30 + SMALL_FONT_SIZE);

    // Title — word-wrapped using exact pixel measurement, vertically centered
    ctx.font = `${FONT_SIZE}px ${FONT_NAME}`;
    const lines = wrapText(ctx, params.title, WIDTH - 100);
    const yStart = Math.floor((HEIGHT - lines.length * LINE_HEIGHT) / 2);

    for (let i = 0; i < lines.length; i++) {
      const x = (WIDTH - ctx.measureText(lines[i]).width) / 2;
      const y = yStart + i * LINE_HEIGHT + FONT_SIZE;
      // Drop shadow at 2px offset (matches Python)
      ctx.fillStyle = "black";
      ctx.fillText(lines[i], x + 2, y + 2);
      // White title text
      ctx.fillStyle = "white";
      ctx.fillText(lines[i], x, y);
    }

    return { buffer: canvas.toBuffer("image/png") as Buffer, unsplashAttribution };
  }
}
