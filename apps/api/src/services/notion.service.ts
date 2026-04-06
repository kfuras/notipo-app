/**
 * Notion API client for polling databases and fetching page content.
 * Uses @notionhq/client under the hood.
 */

import { Client } from "@notionhq/client";

// ---------------------------------------------------------------------------
// Markdown → Notion block helpers (used by createPage)
// ---------------------------------------------------------------------------

/** Notion limits each rich_text content string to 2000 characters. */
const NOTION_TEXT_LIMIT = 2000;

/** Split a long string into ≤2000-char plain text rich_text segments. */
function chunkPlainText(content: string, annotations?: Record<string, unknown>): unknown[] {
  const chunks: unknown[] = [];
  for (let i = 0; i < content.length; i += NOTION_TEXT_LIMIT) {
    const seg: Record<string, unknown> = { type: "text", text: { content: content.slice(i, i + NOTION_TEXT_LIMIT) } };
    if (annotations) seg.annotations = annotations;
    chunks.push(seg);
  }
  return chunks.length ? chunks : [{ type: "text", text: { content: "" } }];
}

/** Parse inline markdown into Notion rich_text objects, respecting the 2000-char limit. */
function parseInlineMarkdown(text: string): unknown[] {
  if (!text) return [{ type: "text", text: { content: "" } }];
  const decoded = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  const result: unknown[] = [];
  const pattern = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(decoded)) !== null) {
    if (m.index > last) result.push(...chunkPlainText(decoded.slice(last, m.index)));
    if (m[2]) result.push(...chunkPlainText(m[2], { bold: true, italic: true }));
    else if (m[3]) result.push(...chunkPlainText(m[3], { bold: true }));
    else if (m[4]) result.push(...chunkPlainText(m[4], { italic: true }));
    else if (m[5]) result.push(...chunkPlainText(m[5], { code: true }));
    else if (m[6] && m[7]) result.push({ type: "text", text: { content: m[6].slice(0, NOTION_TEXT_LIMIT), link: { url: m[7] } } });
    last = m.index + m[0].length;
  }
  if (last < decoded.length) result.push(...chunkPlainText(decoded.slice(last)));
  return result.length ? result : [{ type: "text", text: { content: decoded.slice(0, NOTION_TEXT_LIMIT) } }];
}

/** Map common language aliases to Notion-supported code block languages. */
function normalizeCodeLang(lang: string): string {
  const map: Record<string, string> = {
    js: "javascript", ts: "typescript", py: "python", rb: "ruby",
    sh: "bash", shell: "bash", zsh: "bash", yml: "yaml",
    html: "html", css: "css", sql: "sql", json: "json",
    xml: "xml", php: "php", java: "java", go: "go",
    rust: "rust", cpp: "c++", "c++": "c++", c: "c",
    cs: "c#", csharp: "c#", swift: "swift", kotlin: "kotlin",
    scala: "scala", r: "r", dockerfile: "dockerfile", diff: "diff",
    markdown: "markdown", md: "markdown", graphql: "graphql",
  };
  return map[lang.toLowerCase()] ?? "plain text";
}

/** Convert markdown to an array of Notion block objects. */
function markdownToNotionBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim().toLowerCase() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++; // skip closing ```
      blocks.push({ object: "block", type: "code", code: { rich_text: chunkPlainText(codeLines.join("\n")), language: normalizeCodeLang(lang) } });
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h3) { blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: parseInlineMarkdown(h3[1]) } }); i++; continue; }
    if (h2) { blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: parseInlineMarkdown(h2[1]) } }); i++; continue; }
    if (h1) { blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: parseInlineMarkdown(h1[1]) } }); i++; continue; }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(line.trim())) { blocks.push({ object: "block", type: "divider", divider: {} }); i++; continue; }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i].startsWith("> ") ? lines[i].slice(2) : ""); i++;
      }
      blocks.push({ object: "block", type: "quote", quote: { rich_text: parseInlineMarkdown(quoteLines.join("\n")) } });
      continue;
    }

    // Image
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) {
      blocks.push({ object: "block", type: "image", image: { type: "external", external: { url: img[2] }, ...(img[1] && { caption: [{ type: "text", text: { content: img[1] } }] }) } });
      i++; continue;
    }

    // Bullet list
    if (/^[-*] /.test(line)) {
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: parseInlineMarkdown(lines[i].slice(2)) } }); i++;
      }
      continue;
    }

    // Numbered list
    if (/^\d+\. /.test(line)) {
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: parseInlineMarkdown(lines[i].replace(/^\d+\. /, "")) } }); i++;
      }
      continue;
    }

    // Table
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) { tableLines.push(lines[i]); i++; }
      const dataRows = tableLines.filter((l) => !/^\|[-:| ]+\|$/.test(l));
      if (dataRows.length > 0) {
        const parsedRows = dataRows.map((row) =>
          row.split("|").slice(1, -1).map((c) => parseInlineMarkdown(c.trim())),
        );
        const tableWidth = Math.max(...parsedRows.map((r) => r.length));
        blocks.push({
          object: "block", type: "table",
          table: {
            table_width: tableWidth, has_column_header: true, has_row_header: false,
            children: parsedRows.map((cells) => ({ object: "block", type: "table_row", table_row: { cells } })),
          },
        });
      }
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith("```") && !lines[i].match(/^#{1,6} /) &&
      !/^[-*]{3,}$/.test(lines[i].trim()) && !lines[i].startsWith("> ") &&
      !lines[i].startsWith("![") && !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) && !lines[i].startsWith("|")
    ) { paragraphLines.push(lines[i]); i++; }
    if (paragraphLines.length) {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: parseInlineMarkdown(paragraphLines.join(" ")) } });
    }
  }

  return blocks;
}

export class NotionService {
  private client: Client;

  constructor(accessToken: string) {
    this.client = new Client({ auth: accessToken });
  }

  /** Query a Notion database for pages matching a status filter. */
  async getReadyPosts(databaseId: string, triggerStatus: string, limit = 1) {
    const response = await this.client.databases.query({
      database_id: databaseId,
      filter: {
        property: "Status",
        select: { equals: triggerStatus },
      },
      page_size: limit,
    });
    return response.results;
  }

  /** Get all blocks (content) from a Notion page. */
  async getPageBlocks(pageId: string) {
    const blocks: unknown[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return blocks;
  }

  /** Update a Notion page's status property and optionally set the WordPress Link URL. */
  async updatePageStatus(pageId: string, status: string, wpUrl?: string) {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        Status: { select: { name: status } },
        ...(wpUrl && { "WordPress Link": { url: wpUrl } }),
      },
    });
  }

  /** Get a page's properties. */
  async getPageProperties(pageId: string) {
    return this.client.pages.retrieve({ page_id: pageId });
  }

  /** Update a Notion database's Category select and Tags multi-select options. */
  async syncDatabaseOptions(databaseId: string, categories: string[], tags: string[]) {
    const COLORS = ["blue", "green", "orange", "red", "purple", "pink", "yellow", "brown", "gray"] as const;

    // Fetch existing options so we don't try to change their colors (Notion API rejects that)
    const db = await this.client.databases.retrieve({ database_id: databaseId });
    const props = (db as { properties: Record<string, { select?: { options: Array<{ name: string }> }; multi_select?: { options: Array<{ name: string }> } }> }).properties;
    const existingCategories = new Set((props.Category?.select?.options ?? []).map((o) => o.name));
    const existingTags = new Set((props.Tags?.multi_select?.options ?? []).map((o) => o.name));

    const catOptions = categories.map((name, i) =>
      existingCategories.has(name) ? { name } : { name, color: COLORS[i % COLORS.length] },
    );
    const tagOptions = tags.map((name, i) =>
      existingTags.has(name) ? { name } : { name, color: COLORS[i % COLORS.length] },
    );

    await this.client.databases.update({
      database_id: databaseId,
      properties: {
        Category: { select: { options: catOptions } },
        Tags: { multi_select: { options: tagOptions } },
      },
    });
  }

  /** Create a new page in a Notion database. */
  async createPage(databaseId: string, params: {
    title: string;
    status: string;
    category?: string;
    tags?: string[];
    seoKeyword?: string;
    slug?: string;
    imageTitle?: string;
    body?: string;
  }): Promise<string> {
    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: params.title } }] },
      Status: { select: { name: params.status } },
      ...(params.category && { Category: { select: { name: params.category } } }),
      ...(params.tags?.length && { Tags: { multi_select: params.tags.map((t) => ({ name: t })) } }),
      ...(params.seoKeyword && { "SEO Keyword": { rich_text: [{ text: { content: params.seoKeyword.slice(0, 2000) } }] } }),
      ...(params.slug && { Slug: { rich_text: [{ text: { content: params.slug.slice(0, 2000) } }] } }),
      ...(params.imageTitle && { "Featured Image Title": { rich_text: [{ text: { content: params.imageTitle } }] } }),
    };

    const children: unknown[] = params.body ? markdownToNotionBlocks(params.body) : [];

    // Notion API limits page creation to 100 children at a time.
    // Create the page with the first 100, then append the rest in chunks.
    const firstBatch = children.slice(0, 100);
    const remaining = children.slice(100);

    const page = await this.client.pages.create({
      parent: { database_id: databaseId },
      properties: properties as Parameters<typeof this.client.pages.create>[0]["properties"],
      children: firstBatch as Parameters<typeof this.client.pages.create>[0]["children"],
    });

    for (let i = 0; i < remaining.length; i += 100) {
      const chunk = remaining.slice(i, i + 100);
      await this.client.blocks.children.append({
        block_id: page.id,
        children: chunk as Parameters<typeof this.client.blocks.children.append>[0]["children"],
      });
    }

    return page.id;
  }

  /** Get a page's Status select value (returns null if not set). */
  async getPageStatus(pageId: string): Promise<string | null> {
    const page = await this.getPageProperties(pageId);
    const props = (page as { properties?: Record<string, unknown> }).properties;
    const status = props?.["Status"] as { select?: { name?: string } } | undefined;
    return status?.select?.name ?? null;
  }
}
