/**
 * Converts WordPress Gutenberg block HTML (or classic editor HTML) to Markdown.
 * Reverse of markdown-to-gutenberg.ts.
 *
 * Two-pass approach:
 * 1. If <!-- wp: --> block markers found, split into blocks and convert each
 * 2. If no markers (classic editor), parse raw HTML tags
 */

/**
 * Decode common HTML entities.
 * `&amp;` is replaced last so `&amp;lt;` round-trips to `&lt;` rather than
 * being double-decoded to `<`.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&#8230;/g, "\u2026")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Convert inline HTML tags to markdown equivalents */
function inlineHtmlToMd(s: string): string {
  let out = s;

  // Links: <a href="url">text</a>
  out = out.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Bold: <strong> or <b>
  out = out.replace(/<(strong|b)>(.*?)<\/\1>/gi, "**$2**");

  // Italic: <em> or <i>
  out = out.replace(/<(em|i)>(.*?)<\/\1>/gi, "*$2*");

  // Inline code: <code> (but not inside <pre>)
  out = out.replace(/<code>(.*?)<\/code>/gi, "`$1`");

  // Strikethrough: <del> or <s>
  out = out.replace(/<(del|s)>(.*?)<\/\1>/gi, "~~$2~~");

  // Line breaks
  out = out.replace(/<br\s*\/?>/gi, "\n");

  return decodeEntities(out);
}

/**
 * Strip all remaining HTML tags. Loops until stable so nested patterns
 * like `<scr<script>ipt>` (which a single pass would leave as `<script>`)
 * are fully removed.
 */
function stripTags(s: string): string {
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out.replace(/<[^>]+>/g, "");
  } while (out !== prev);
  return out;
}

/** Extract text content from HTML, converting inline formatting */
function extractText(html: string): string {
  return stripTags(inlineHtmlToMd(html)).trim();
}

/** Extract inner content between opening and closing tag */
function innerContent(html: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  return m ? m[1] : html;
}

// ── Gutenberg block handlers ──────────────────────────────────

function convertParagraph(inner: string): string {
  // Extract <p> content, handle multiple paragraphs
  const paragraphs: string[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(inner)) !== null) {
    const text = extractText(m[1]);
    if (text) paragraphs.push(text);
  }
  // If no <p> tags, treat whole content as text
  if (paragraphs.length === 0) {
    const text = extractText(inner);
    if (text) return text;
    return "";
  }
  return paragraphs.join("\n\n");
}

function convertHeading(inner: string): string {
  const hMatch = inner.match(/<h(\d)[^>]*>([\s\S]*?)<\/h\1>/i);
  if (!hMatch) return extractText(inner);
  const level = Number(hMatch[1]);
  const text = extractText(hMatch[2]);
  return "#".repeat(level) + " " + text;
}

function convertList(inner: string): string {
  const isOrdered = /<ol[\s>]/i.test(inner);
  const items: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  let idx = 1;
  while ((m = liRe.exec(inner)) !== null) {
    const text = extractText(m[1]);
    if (isOrdered) {
      items.push(`${idx}. ${text}`);
      idx++;
    } else {
      items.push(`- ${text}`);
    }
  }
  return items.join("\n");
}

function convertCode(inner: string): string {
  // Try to detect language from class
  const langMatch = inner.match(/class="[^"]*language-(\w+)[^"]*"/i);
  const lang = langMatch ? langMatch[1] : "";

  // Extract code content from <pre><code>...</code></pre> or <pre>...</pre>
  let code = "";
  const codeMatch = inner.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
  if (codeMatch) {
    code = codeMatch[1];
  } else {
    const preMatch = inner.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    code = preMatch ? preMatch[1] : inner;
  }

  // Decode entities and strip any remaining tags from code content.
  code = stripTags(decodeEntities(code)).trim();

  return "```" + lang + "\n" + code + "\n```";
}

function convertImage(inner: string): string {
  const srcMatch = inner.match(/<img[^>]+src="([^"]+)"/i);
  const altMatch = inner.match(/<img[^>]+alt="([^"]*)"/i);
  const src = srcMatch ? srcMatch[1] : "";
  const alt = altMatch ? altMatch[1] : "";
  if (!src) return "";
  return `![${decodeEntities(alt)}](${src})`;
}

function convertQuote(inner: string): string {
  const content = innerContent(inner, "blockquote");
  // Extract paragraphs within the quote
  const lines: string[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(content)) !== null) {
    lines.push(extractText(m[1]));
  }
  if (lines.length === 0) {
    const text = extractText(content);
    if (text) lines.push(text);
  }
  return lines.map((l) => `> ${l}`).join("\n");
}

function convertTable(inner: string): string {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(inner)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(extractText(cm[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";

  const header = rows[0];
  const divider = header.map(() => "---");
  const body = rows.slice(1);

  const lines = [
    "| " + header.join(" | ") + " |",
    "| " + divider.join(" | ") + " |",
    ...body.map((row) => "| " + row.join(" | ") + " |"),
  ];
  return lines.join("\n");
}

function convertEmbed(inner: string, attrs: string): string {
  // Try to get URL from attrs JSON or from inner content
  const urlMatch = attrs.match(/"url"\s*:\s*"([^"]+)"/);
  if (urlMatch) return urlMatch[1];
  const text = extractText(inner);
  if (text && /^https?:\/\//.test(text)) return text;
  return text || "";
}

function convertSeparator(): string {
  return "---";
}

// ── Main converter ────────────────────────────────────────────

interface GutenbergBlock {
  type: string;
  attrs: string;
  inner: string;
}

function parseGutenbergBlocks(html: string): GutenbergBlock[] {
  const blocks: GutenbergBlock[] = [];

  // Match self-closing blocks (like separator) and regular blocks
  const blockRe =
    /<!-- wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\s*({[^}]*})?\s*(?:\/-->|-->([\s\S]*?)<!-- \/wp:\1\s*-->)/g;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    blocks.push({
      type: m[1],
      attrs: m[2] || "",
      inner: m[3] || "",
    });
  }

  return blocks;
}

function convertBlock(block: GutenbergBlock): string {
  switch (block.type) {
    case "paragraph":
      return convertParagraph(block.inner);
    case "heading":
      return convertHeading(block.inner);
    case "list":
      return convertList(block.inner);
    case "code":
    case "prismatic/blocks":
    case "html":
      // wp:html is used for code blocks with Highlight.js/Prism.js
      if (block.type === "html" && !/<pre/i.test(block.inner)) {
        // Not a code block — raw HTML, extract text
        return extractText(block.inner);
      }
      return convertCode(block.inner);
    case "image":
      return convertImage(block.inner);
    case "quote":
      return convertQuote(block.inner);
    case "table":
      return convertTable(block.inner);
    case "separator":
      return convertSeparator();
    case "embed":
      return convertEmbed(block.inner, block.attrs);
    default:
      // Unknown block — best effort: extract text
      return extractText(block.inner);
  }
}

/** Convert classic editor HTML (no Gutenberg block markers) to markdown */
function convertClassicHtml(html: string): string {
  const lines: string[] = [];
  // Split on block-level tags
  const parts = html.split(/(?=<(?:p|h[1-6]|ul|ol|pre|blockquote|hr|img|table|figure)[\s>])/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Headings
    const hm = trimmed.match(/^<h(\d)[^>]*>([\s\S]*?)<\/h\1>/i);
    if (hm) {
      lines.push("#".repeat(Number(hm[1])) + " " + extractText(hm[2]));
      continue;
    }

    // Images
    const imgm = trimmed.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (imgm && /^<(?:img|figure)/i.test(trimmed)) {
      const altm = trimmed.match(/alt="([^"]*)"/i);
      lines.push(`![${decodeEntities(altm?.[1] || "")}](${imgm[1]})`);
      continue;
    }

    // HR
    if (/^<hr[\s/>]/i.test(trimmed)) {
      lines.push("---");
      continue;
    }

    // Lists
    if (/^<[ou]l[\s>]/i.test(trimmed)) {
      const isOrdered = /^<ol/i.test(trimmed);
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let m: RegExpExecArray | null;
      let idx = 1;
      while ((m = liRe.exec(trimmed)) !== null) {
        const text = extractText(m[1]);
        lines.push(isOrdered ? `${idx++}. ${text}` : `- ${text}`);
      }
      continue;
    }

    // Pre/code
    if (/^<pre[\s>]/i.test(trimmed)) {
      lines.push(convertCode(trimmed));
      continue;
    }

    // Blockquote
    if (/^<blockquote[\s>]/i.test(trimmed)) {
      lines.push(convertQuote(trimmed));
      continue;
    }

    // Table
    if (/^<table[\s>]/i.test(trimmed) || /^<figure[^>]*class="[^"]*wp-block-table/i.test(trimmed)) {
      lines.push(convertTable(trimmed));
      continue;
    }

    // Paragraph
    if (/^<p[\s>]/i.test(trimmed)) {
      const text = extractText(innerContent(trimmed, "p"));
      if (text) lines.push(text);
      continue;
    }

    // Fallback: extract text
    const text = extractText(trimmed);
    if (text) lines.push(text);
  }

  return lines.join("\n\n");
}

/**
 * Convert WordPress post content (Gutenberg blocks or classic HTML) to Markdown.
 */
export function convertGutenbergToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";

  const hasGutenbergBlocks = /<!-- wp:/.test(html);

  if (hasGutenbergBlocks) {
    const blocks = parseGutenbergBlocks(html);
    const parts = blocks.map(convertBlock).filter((s) => s.trim() !== "");
    return parts.join("\n\n");
  }

  return convertClassicHtml(html);
}
