/**
 * Gemini AI image generation service.
 * Calls the Gemini REST API to generate featured images from text prompts.
 */

import sharp from "sharp";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const GEMINI_MODEL = "gemini-2.5-flash-image";
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
      signal: AbortSignal.timeout(120_000),
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

  private static readonly STYLE_GUIDANCE: Record<string, string> = {
    "comic book": "Bold ink outlines, vibrant flat colors, dynamic action poses, halftone dot shading, dramatic angles like a graphic novel splash page.",
    "watercolor": "Soft translucent washes, visible brush strokes, bleeding edges, dreamy organic feel with rich pigment pools.",
    "3d render": "Clean glossy surfaces, volumetric lighting, soft shadows, Pixar/Blender aesthetic with depth of field.",
    "photorealistic": "Looks like a real photograph — natural lighting, shallow depth of field, realistic materials and textures, cinematic color grading.",
    "cyberpunk": "Neon-soaked dark cityscape aesthetic, glowing purple/cyan/magenta, rain-slicked surfaces, holographic displays, dystopian tech noir.",
    "retro": "Vintage 80s/90s aesthetic, synthwave colors, CRT scan lines, pixel art influences, nostalgic warm tones.",
  };

  private buildPrompt(params: GeminiImageRequest): string {
    const tagContext = params.tags?.length
      ? `\nRelated topics: ${params.tags.join(", ")}.`
      : "";

    const styleLower = params.style.toLowerCase();
    const styleGuide = GeminiImageService.STYLE_GUIDANCE[styleLower] || "";

    return [
      `Generate a wide 16:9 landscape blog featured image.`,
      ``,
      `Post title: "${params.title}"`,
      `Category: ${params.category}${tagContext}`,
      ``,
      `Style: ${params.style}`,
      styleGuide ? `Style details: ${styleGuide}` : "",
      ``,
      `INSTRUCTIONS:`,
      `First, analyze the post title and tags to identify the specific tools, platforms, and technologies the post is about.`,
      ``,
      `Then create a scene that ILLUSTRATES what the post is about by including:`,
      `- Recognizable visual representations of the actual tools and platforms mentioned (e.g. their logos, icons, or UI screens)`,
      `- A central character, mascot, or focal element that ties the scene together`,
      `- Visual storytelling that shows the WORKFLOW or CONCEPT — how the tools connect or interact`,
      ``,
      `The image should look like a custom illustration made specifically for this post, not a generic stock image that could be used for any tech article.`,
      ``,
      `- Use dramatic lighting and cinematic composition.`,
      `- Make it visually striking and bold — the kind of image that stops you mid-scroll.`,
      `- Do NOT include any readable text, titles, words, or watermarks in the image. Logos and icons are OK.`,
      `- AVOID: generic abstract backgrounds, boring gradients, bland corporate art, vague "tech" imagery.`,
    ].join("\n");
  }
}
