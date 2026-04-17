/**
 * Converts Markdown to WordPress Gutenberg block HTML.
 * Ported from n8n workflow Y6O8LzWsujHZz3G5,
 * node "Convert Markdown to WP Blocks (Prismatic)".
 *
 * Line-based state machine parser supporting:
 * - Paragraphs, headings (h1-h6), ordered/unordered lists
 * - Fenced code blocks (any length ``` or ~~~) with language detection
 * - Tables, blockquotes, images, horizontal rules
 * - Inline: bold, italic, strikethrough, inline code, links
 *
 * Code block output format is configurable per tenant:
 * - PRISMATIC: <!-- wp:prismatic/blocks --> (requires Prismatic WP plugin)
 * - WP_CODE: <!-- wp:code --> (built-in, no plugin needed)
 * - HIGHLIGHT_JS: <!-- wp:code --> with hljs classes
 * - PRISM_JS: <!-- wp:code --> with language- classes
 */

import type { CodeHighlighter } from "@prisma/client";
import type { GutenbergOptions } from "../types/index.js";

// Map common shorthand -> canonical language name
const LANG_MAP: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  py: "python",
  md: "markdown",
  ps1: "powershell",
  pwsh: "powershell",
};

function normalizeLang(lang: string): string {
  const l = (lang || "text").trim().toLowerCase();
  return LANG_MAP[l] || l || "text";
}

function escHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMdToHtml(s: string): string {
  let out = escHtml(s);

  // links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // bold: **text**
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // strikethrough: ~~text~~
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // italic: *text* or _text_ (conservative so it won't eat **bold**)
  out = out.replace(/(^|\W)\*(?!\*)([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|\W)_([^_]+)_/g, "$1<em>$2</em>");

  // inline code: `code`
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  return out;
}

function paragraphBlock(text: string): string {
  const html = inlineMdToHtml(text).replace(/\n/g, "<br />");
  return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;
}

function headingBlock(level: number, text: string): string {
  const tag = `h${level}`;
  return `<!-- wp:heading {"level":${level}} -->\n<${tag}>${inlineMdToHtml(text)}</${tag}>\n<!-- /wp:heading -->`;
}

function listBlock(items: string[], ordered = false): string {
  const tag = ordered ? "ol" : "ul";
  const lis = items.map((i) => `<li>${inlineMdToHtml(i)}</li>`).join("");
  const attrs = ordered ? ' {"ordered":true}' : "";
  return `<!-- wp:list${attrs} -->\n<${tag}>${lis}</${tag}>\n<!-- /wp:list -->`;
}

function quoteBlock(lines: string[]): string {
  const html = lines.map((l) => inlineMdToHtml(l)).join("<br />");
  return `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${html}</p></blockquote>\n<!-- /wp:quote -->`;
}

function separatorBlock(): string {
  return `<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->`;
}

interface FaqItem {
  question: string;
  answer: string;
}

function faqBlock(items: FaqItem[], seoPlugin?: string | null): string {
  if (seoPlugin === "rankmath") {
    // RichText.Content renders the title/content values as raw HTML,
    // so the JSON attributes must contain the same HTML as the inner markup.
    const questions = items.map((item, i) => ({
      id: `faq-q${i + 1}`,
      title: escHtml(item.question),
      content: inlineMdToHtml(item.answer),
      visible: true,
    }));
    const attrs = JSON.stringify({ questions });
    const inner = questions
      .map(
        (q) =>
          `<div class="rank-math-faq-item"><h3 class="rank-math-question">${q.title}</h3><div class="rank-math-answer">${q.content}</div></div>`,
      )
      .join("");
    return `<!-- wp:rank-math/faq-block ${attrs} -->\n<div class="wp-block-rank-math-faq-block">${inner}</div>\n<!-- /wp:rank-math/faq-block -->`;
  }

  if (seoPlugin === "yoast") {
    // Same principle as Rank Math: Yoast's save() renders jsonQuestion/jsonAnswer
    // as raw HTML, so the JSON attributes must match the inner markup exactly.
    const questions = items.map((item, i) => ({
      id: `faq-q${i + 1}`,
      jsonQuestion: escHtml(item.question),
      jsonAnswer: inlineMdToHtml(item.answer),
    }));
    const attrs = JSON.stringify({ questions });
    const inner = questions
      .map(
        (q) =>
          `<div class="schema-faq-section"><strong class="schema-faq-question">${q.jsonQuestion}</strong><p class="schema-faq-answer">${q.jsonAnswer}</p></div>`,
      )
      .join("");
    return `<!-- wp:yoast-seo/faq-block ${attrs} -->\n<div class="schema-faq wp-block-yoast-faq-block">${inner}</div>\n<!-- /wp:yoast-seo/faq-block -->`;
  }

  // No SEO plugin: core/details blocks for visual accordion + JSON-LD FAQPage schema for Google
  const detailsBlocks = items
    .map(
      (item) =>
        `<!-- wp:details -->\n<details class="wp-block-details"><summary>${escHtml(item.question)}</summary><!-- wp:paragraph -->\n<p>${inlineMdToHtml(item.answer)}</p>\n<!-- /wp:paragraph --></details>\n<!-- /wp:details -->`,
    )
    .join("\n\n");

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  const schemaBlock = `<!-- wp:html -->\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>\n<!-- /wp:html -->`;

  return detailsBlocks + "\n\n" + schemaBlock;
}

function codeBlock(lang: string, code: string, highlighter: CodeHighlighter): string {
  const safeLang = normalizeLang(lang);
  const safeCode = escHtml(code || "");

  switch (highlighter) {
    case "PRISMATIC":
      return `<!-- wp:prismatic/blocks {"language":"${safeLang}"} -->\n<pre class="wp-block-prismatic-blocks language-${safeLang}"><code class="language-${safeLang}">${safeCode}</code></pre>\n<!-- /wp:prismatic/blocks -->`;
    case "HIGHLIGHT_JS":
      return `<!-- wp:html -->\n<pre><code class="language-${safeLang}">${safeCode}</code></pre>\n<!-- /wp:html -->`;
    case "PRISM_JS":
      return `<!-- wp:html -->\n<pre><code class="language-${safeLang}">${safeCode}</code></pre>\n<!-- /wp:html -->`;
    case "WP_CODE":
    default:
      return `<!-- wp:code -->\n<pre class="wp-block-code"><code>${safeCode}</code></pre>\n<!-- /wp:code -->`;
  }
}

function imageBlock(url: string, alt = ""): string {
  const safeUrl = escHtml(url);
  const safeAlt = escHtml(alt);
  return `<!-- wp:image -->\n<figure class="wp-block-image"><img src="${safeUrl}" alt="${safeAlt}"/></figure>\n<!-- /wp:image -->`;
}

function parseTableRow(line: string): string[] {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return raw.split("|").map((c) => c.trim());
}

function isTableDivider(line: string): boolean {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const parts = t.split("|").map((p) => p.trim());
  return parts.length >= 2 && parts.every((p) => /^:?-{3,}:?$/.test(p));
}

function tableBlock(headerCells: string[], bodyRows: string[][]): string {
  const thead =
    "<thead><tr>" +
    headerCells.map((c) => `<th>${inlineMdToHtml(c)}</th>`).join("") +
    "</tr></thead>";

  const tbody =
    "<tbody>" +
    bodyRows
      .map(
        (row) =>
          "<tr>" +
          row.map((c) => `<td>${inlineMdToHtml(c)}</td>`).join("") +
          "</tr>",
      )
      .join("") +
    "</tbody>";

  return `<!-- wp:table -->\n<figure class="wp-block-table"><table>${thead}${tbody}</table></figure>\n<!-- /wp:table -->`;
}

/**
 * Convert markdown string to WordPress Gutenberg block HTML.
 */
export function convertMarkdownToGutenberg(
  md: string,
  options: GutenbergOptions = { highlighter: "PRISMATIC" },
): string {
  // Strip category/tags metadata from post body
  let content = md
    .replace(/^\s*\*\*Category:\*\*\s*`[^`]*`\s*\n?/i, "")
    .replace(/^\s*\*\*Tags:\*\*\s*`[^`]*`\s*\n?/i, "")
    .replace(/^\s*Category:\s*.+\n?/im, "")
    .replace(/^\s*Tags:\s*.+\n?/im, "")
    .replace(/^\s*\n+/, "");

  // Normalize newlines
  content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = content.split("\n");
  const blocks: string[] = [];

  let para: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];
  let quote: string[] = [];

  let inCode = false;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let codeLang = "text";
  let codeLines: string[] = [];
  let inFaq = false;
  let faqItems: FaqItem[] = [];

  function flushPara() {
    const t = para.join("\n").trim();
    if (t) blocks.push(paragraphBlock(t));
    para = [];
  }

  function flushLists() {
    if (ul.length) blocks.push(listBlock(ul, false));
    if (ol.length) blocks.push(listBlock(ol, true));
    ul = [];
    ol = [];
  }

  function flushQuote() {
    if (quote.length) blocks.push(quoteBlock(quote));
    quote = [];
  }

  function flushAllTextish() {
    flushPara();
    flushLists();
    flushQuote();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- code fences (``` or ~~~, any length >= 3) ---
    const fenceMatch = line.match(/^(\s*)([`~]{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const char = marker[0];
      const len = marker.length;
      const rest = (fenceMatch[3] || "").trim();

      if (!inCode) {
        flushAllTextish();
        inCode = true;
        fenceChar = char;
        fenceLen = len;
        codeLang = rest || "text";
        codeLines = [];
      } else {
        if (char === fenceChar && len >= fenceLen) {
          blocks.push(codeBlock(codeLang, codeLines.join("\n"), options.highlighter));
          inCode = false;
          fenceChar = null;
          fenceLen = 0;
          codeLang = "text";
          codeLines = [];
        } else {
          codeLines.push(line);
        }
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // --- image as its own line: ![alt](url) ---
    const imgMatch = line
      .trim()
      .match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (imgMatch) {
      flushAllTextish();
      blocks.push(imageBlock(imgMatch[2], imgMatch[1]));
      continue;
    }

    // --- horizontal rule ---
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      flushAllTextish();
      // Flush FAQ items before separator (FAQ section ends here)
      if (inFaq && faqItems.length) {
        blocks.push(faqBlock(faqItems, options.seoPlugin));
        faqItems = [];
        inFaq = false;
      }
      blocks.push(separatorBlock());
      continue;
    }

    // --- blockquote ---
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushPara();
      flushLists();
      quote.push(q[1] || "");
      continue;
    } else {
      flushQuote();
    }

    // --- headings ---
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      // Flush any collected FAQ items before leaving the FAQ section
      if (inFaq && faqItems.length && !(/^faq$/i.test(hm[2].trim()) || /^frequently asked/i.test(hm[2].trim()))) {
        blocks.push(faqBlock(faqItems, options.seoPlugin));
        faqItems = [];
        inFaq = false;
      }
      flushAllTextish();
      const headingText = hm[2].trim();
      blocks.push(headingBlock(hm[1].length, headingText));
      // Track FAQ section for structured FAQ block conversion
      if (/^faq$/i.test(headingText) || /^frequently asked/i.test(headingText)) {
        inFaq = true;
        faqItems = [];
      }
      continue;
    }

    // --- FAQ: bold question followed by answer paragraph ---
    if (inFaq) {
      const boldQ = line.match(/^\*\*(.+?)\*\*\s*$/);
      if (boldQ) {
        flushAllTextish();
        const question = boldQ[1];
        // Collect answer lines until next bold question, heading, or separator
        const answerLines: string[] = [];
        while (
          i + 1 < lines.length &&
          !lines[i + 1].match(/^\*\*(.+?)\*\*\s*$/) &&
          !lines[i + 1].match(/^#{1,6}\s/) &&
          !lines[i + 1].match(/^\s*([-*_])\1\1+\s*$/)
        ) {
          i++;
          if (lines[i].trim()) answerLines.push(lines[i]);
        }
        if (answerLines.length) {
          faqItems.push({ question, answer: answerLines.join(" ") });
        }
        continue;
      }
    }

    // --- tables (header row + divider row) ---
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableDivider(lines[i + 1])
    ) {
      flushAllTextish();

      const header = parseTableRow(line);
      i += 1; // skip divider

      const body: string[][] = [];
      while (
        i + 1 < lines.length &&
        lines[i + 1].includes("|") &&
        lines[i + 1].trim() !== ""
      ) {
        body.push(parseTableRow(lines[i + 1]));
        i += 1;
      }

      blocks.push(tableBlock(header, body));
      continue;
    }

    // --- unordered list ---
    const ulm = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulm) {
      flushPara();
      if (ol.length) {
        blocks.push(listBlock(ol, true));
        ol = [];
      }
      ul.push(ulm[1].trim());
      continue;
    }

    // --- ordered list ---
    const olm = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olm) {
      flushPara();
      if (ul.length) {
        blocks.push(listBlock(ul, false));
        ul = [];
      }
      ol.push(olm[1].trim());
      continue;
    }

    // --- blank line ---
    if (line.trim() === "") {
      flushAllTextish();
      continue;
    }

    // otherwise, paragraph text
    para.push(line);
  }

  flushAllTextish();

  // Flush any remaining FAQ items at end of file
  if (faqItems.length) {
    blocks.push(faqBlock(faqItems, options.seoPlugin));
  }

  return blocks.join("\n\n");
}
