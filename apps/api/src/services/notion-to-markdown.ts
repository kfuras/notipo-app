/**
 * Converts Notion block array to Markdown string.
 * Ported from n8n workflow ojxkaTVjMVFmj9IA, node "Convert to Markdown" (convert-001).
 *
 * Handles: paragraphs, headings (h1-h3), bulleted/numbered lists,
 * code blocks (with language), images, quotes, dividers,
 * and rich text annotations (bold, italic, code, links).
 */

import type { NotionConversionResult, ImageRef } from "../types/index.js";

interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
  };
  href?: string | null;
}

interface NotionBlock {
  id?: string;
  type?: string;
  [key: string]: unknown;
}

interface NotionPageProperties {
  Name?: { title?: Array<{ plain_text?: string }> };
  Category?: { select?: { name?: string } };
  Tags?: { multi_select?: Array<{ name?: string }> };
  "Featured Image Title"?: { rich_text?: Array<{ plain_text?: string }> };
  "SEO Keyword"?: { rich_text?: Array<{ plain_text?: string }> };
  "SEO Description"?: { rich_text?: Array<{ plain_text?: string }> };
  Slug?: { rich_text?: Array<{ plain_text?: string }> };
  Status?: { select?: { name?: string } };
}

function getRichText(blockData: Record<string, unknown>): string {
  const textArray = (blockData?.text || blockData?.rich_text) as NotionRichText[] | undefined;
  if (!Array.isArray(textArray)) return "";

  return textArray
    .map((t) => {
      let text = t.plain_text || t.text?.content || "";
      if (t.annotations) {
        if (t.annotations.bold) text = `**${text}**`;
        if (t.annotations.italic) text = `*${text}*`;
        if (t.annotations.code) text = `\`${text}\``;
      }
      if (t.href) text = `[${text}](${t.href})`;
      return text;
    })
    .join("");
}

export function convertNotionBlocksToMarkdown(
  blocks: NotionBlock[],
  pageProperties: NotionPageProperties,
  notionPageId: string,
): NotionConversionResult {
  // Join all rich_text segments — Notion can split a property value into multiple
  // runs (different formatting, copy-paste artefacts), so [0] alone would miss them.
  const joinText = (arr?: Array<{ plain_text?: string }>) =>
    (arr ?? []).map((t) => t.plain_text ?? "").join("") || undefined;

  const title = joinText(pageProperties.Name?.title) ?? "";
  const category = pageProperties.Category?.select?.name || "";
  const tags = (pageProperties.Tags?.multi_select ?? [])
    .map((t) => t.name)
    .filter((n): n is string => Boolean(n));
  const featuredImageTitle =
    joinText(pageProperties["Featured Image Title"]?.rich_text) ?? title;
  const seoKeyword = joinText(pageProperties["SEO Keyword"]?.rich_text);
  const seoDescription = joinText(pageProperties["SEO Description"]?.rich_text);
  const slug = joinText(pageProperties.Slug?.rich_text);

  let markdown = "";
  let prevType: string | null = null;

  for (const block of blocks) {
    if (!block.type) continue;
    const blockData = block[block.type] as Record<string, unknown> | undefined;
    if (!blockData) continue;

    const isListItem = block.type === "bulleted_list_item" || block.type === "numbered_list_item";
    const wasListItem =
      prevType === "bulleted_list_item" || prevType === "numbered_list_item";

    if (wasListItem && !isListItem) {
      markdown += "\n";
    }

    switch (block.type) {
      case "paragraph": {
        const text = getRichText(blockData);
        if (text) markdown += text + "\n\n";
        break;
      }
      case "heading_1":
        markdown += "# " + getRichText(blockData) + "\n\n";
        break;
      case "heading_2":
        markdown += "## " + getRichText(blockData) + "\n\n";
        break;
      case "heading_3":
        markdown += "### " + getRichText(blockData) + "\n\n";
        break;
      case "bulleted_list_item":
        markdown += "- " + getRichText(blockData) + "\n";
        break;
      case "numbered_list_item":
        markdown += "1. " + getRichText(blockData) + "\n";
        break;
      case "code": {
        const code = getRichText(blockData);
        const language = (blockData.language as string) || "";
        markdown += "```" + language + "\n" + code + "\n```\n\n";
        break;
      }
      case "image": {
        const fileData = blockData.file as Record<string, unknown> | undefined;
        const externalData = blockData.external as Record<string, unknown> | undefined;
        const url = (fileData?.url || externalData?.url || "") as string;
        const captionArr = blockData.caption as NotionRichText[] | undefined;
        const caption =
          captionArr && captionArr.length > 0
            ? getRichText({ text: captionArr } as Record<string, unknown>)
            : "Image";
        if (url) markdown += `![${caption}](${url})\n\n`;
        break;
      }
      case "quote":
        markdown += "> " + getRichText(blockData) + "\n\n";
        break;
      case "divider":
        markdown += "---\n\n";
        break;
    }

    prevType = block.type;
  }

  // Extract image references
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const images: ImageRef[] = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const url = match[2];
    const isNotionS3 =
      url.includes("prod-files-secure.s3") || url.includes("s3.us-west-2.amazonaws.com");
    if (isNotionS3) {
      images.push({ alt: match[1], url, fullMatch: match[0] });
    }
  }

  return {
    markdown: markdown.trim(),
    metadata: {
      title,
      category,
      featuredImageTitle,
      notionId: notionPageId,
      seoKeyword,
      seoDescription,
      slug,
      tags: tags.length > 0 ? tags : undefined,
    },
    images,
  };
}
