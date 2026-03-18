/**
 * Gemini AI image generation service.
 * Calls the Gemini REST API to generate featured images from text prompts.
 */

import sharp from "sharp";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const WIDTH = 1200;
const HEIGHT = 628;

interface GeminiImageRequest {
  title: string;
  category: string;
  style: string;
  tags?: string[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
  }>;
}

export class GeminiImageService {
  /**
   * Generate a featured image using Gemini AI.
   * Returns a 1200x628 PNG buffer ready for WordPress upload.
   */
  async generate(params: GeminiImageRequest): Promise<Buffer> {
    if (!config.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const prompt = this.buildPrompt(params);
    logger.info({ title: params.title, style: params.style }, "Generating AI featured image");

    const response = await fetch(`${GEMINI_URL}?key=${config.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: "16:9",
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;

    // Extract the image from the response parts
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.mimeType?.startsWith("image/"),
    );

    if (!imagePart?.inlineData) {
      throw new Error("Gemini returned no image data");
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");

    // Resize to exact OG dimensions
    const resized = await sharp(imageBuffer)
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    logger.info({ title: params.title, size: resized.length }, "AI featured image generated");
    return resized;
  }

  private buildPrompt(params: GeminiImageRequest): string {
    const tagContext = params.tags?.length
      ? ` Related topics: ${params.tags.join(", ")}.`
      : "";

    return (
      `Create a blog featured image in ${params.style} style for a post titled "${params.title}" ` +
      `in the "${params.category}" category.${tagContext} ` +
      `The image should be a wide landscape illustration (16:9 aspect ratio) suitable as a blog header. ` +
      `Do NOT include any text, titles, or words in the image — only visual elements. ` +
      `Make it visually striking and professional.`
    );
  }
}
