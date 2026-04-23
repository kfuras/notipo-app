"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, useApiCall } from "@/hooks/use-api";
import { ApiError } from "@/lib/api-client";
import { capture } from "@/lib/posthog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bold, Italic, Strikethrough, Heading2, Heading3, Link as LinkIcon, Image, Code, SquareCode,
  List, ListOrdered, CheckSquare, Quote, Table, Minus, ChevronDown, ChevronRight, AlertTriangle,
  Eye, EyeOff, Clock, Copy, Pin, MessageSquare,
} from "lucide-react";
import Link from "next/link";
import type { ApiCategory, ApiTag, ApiPostTemplate, ApiListResponse } from "@notipo/shared";

interface SettingsData {
  data: {
    wordpress: { configured: boolean };
  };
}

const DRAFT_KEY = "notipo_write_draft";

interface DraftData {
  title: string;
  body: string;
  category: string;
  tags: string;
  slug: string;
  seoKeyword: string;
  seoDescription: string;
  imageTitle: string;
  excerpt: string;
  scheduledAt: string;
  sticky: boolean;
  commentStatus: string;
  pingStatus: string;
  savedAt: number;
}

// Slash command definitions
const slashCommands = [
  { label: "Heading 2", description: "Medium heading", prefix: "## ", icon: Heading2 },
  { label: "Heading 3", description: "Small heading", prefix: "### ", icon: Heading3 },
  { label: "Bullet List", description: "Unordered list", prefix: "- ", icon: List },
  { label: "Numbered List", description: "Ordered list", prefix: "1. ", icon: ListOrdered },
  { label: "Task List", description: "Checkboxes", prefix: "- [ ] ", icon: CheckSquare },
  { label: "Quote", description: "Blockquote", prefix: "> ", icon: Quote },
  { label: "Code Block", description: "Fenced code", block: "```\n\n```", icon: SquareCode },
  { label: "Divider", description: "Horizontal rule", block: "\n---\n\n", icon: Minus },
  { label: "Table", description: "Markdown table", block: "\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| cell | cell | cell |\n", icon: Table },
  { label: "Image", description: "Image link", block: "![alt](url)", icon: Image },
];

// List continuation patterns
const listPatterns: Array<{ regex: RegExp; next: (m: RegExpMatchArray) => string }> = [
  { regex: /^(\s*)(\d+)\.\s/, next: (m) => `${m[1]}${Number(m[2]) + 1}. ` },
  { regex: /^(\s*)-\s\[[ x]\]\s/, next: (m) => `${m[1]}- [ ] ` },
  { regex: /^(\s*)[-*]\s/, next: (m) => `${m[0]}` },
  { regex: /^(\s*)>\s/, next: (m) => `${m[0]}` },
];

// Platform-aware modifier key label
const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd" : "Ctrl";

export default function WritePageWrapper() {
  return (
    <Suspense fallback={null}>
      <WritePage />
    </Suspense>
  );
}

function WritePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const { call, upload } = useApiCall();
  const { data: settings, loading: settingsLoading } = useApi<SettingsData>("/api/settings");
  const { data: categoriesData } = useApi<ApiListResponse<ApiCategory>>("/api/categories");
  const { data: tagsData } = useApi<ApiListResponse<ApiTag>>("/api/tags");
  const { data: templatesData, refetch: refetchTemplates } = useApi<ApiListResponse<ApiPostTemplate>>("/api/templates");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [slug, setSlug] = useState("");
  const [seoKeyword, setSeoKeyword] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [imageTitle, setImageTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sticky, setSticky] = useState(false);
  const [commentStatus, setCommentStatus] = useState("open");
  const [pingStatus, setPingStatus] = useState("open");
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editLoading, setEditLoading] = useState(!!editId);
  const [editLoaded, setEditLoaded] = useState(false);

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const slashStart = useRef<number | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const tracked = useRef(false);
  const submitted = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Load post data in edit mode ---
  useEffect(() => {
    if (!editId) return;
    setEditLoading(true);
    call<{ data: { title: string; markdownContent: string | null; slug: string | null; seoKeyword: string | null; seoDescription: string | null; featuredImageTitle: string | null; excerpt: string | null; scheduledAt: string | null; sticky: boolean; commentStatus: string; pingStatus: string; tags: string[]; category: { name: string } | null; notionPageId: string | null } }>(`/api/posts/${editId}`)
      .then((res) => {
        const p = res.data;
        setTitle(p.title || "");
        setBody(p.markdownContent || "");
        setSlug(p.slug || "");
        setSeoKeyword(p.seoKeyword || "");
        setSeoDescription(p.seoDescription || "");
        setImageTitle(p.featuredImageTitle || "");
        setExcerpt(p.excerpt || "");
        if (p.scheduledAt) setScheduledAt(p.scheduledAt.slice(0, 16)); // datetime-local format
        setSticky(p.sticky ?? false);
        setCommentStatus(p.commentStatus || "open");
        setPingStatus(p.pingStatus || "open");
        if (p.tags?.length) setTags(p.tags.join(", "));
        if (p.category?.name) setCategory(p.category.name);
        setEditLoaded(true);
      })
      .catch(() => {
        toast.error("Failed to load post");
        router.push("/admin/posts");
      })
      .finally(() => setEditLoading(false));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Restore draft from localStorage on mount (skip in edit mode) ---
  useEffect(() => {
    if (editId) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft: DraftData = JSON.parse(raw);
      if (Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      if (!draft.title && !draft.body) return;
      setTitle(draft.title || "");
      setBody(draft.body || "");
      setCategory(draft.category || "");
      setTags(draft.tags || "");
      setSlug(draft.slug || "");
      setSeoKeyword(draft.seoKeyword || "");
      setSeoDescription(draft.seoDescription || "");
      setImageTitle(draft.imageTitle || "");
      setExcerpt(draft.excerpt || "");
      if (draft.scheduledAt) setScheduledAt(draft.scheduledAt);
      if (draft.sticky) setSticky(draft.sticky);
      if (draft.commentStatus) setCommentStatus(draft.commentStatus);
      if (draft.pingStatus) setPingStatus(draft.pingStatus);
      setDraftRestored(true);
    } catch {
      // Ignore parse errors
    }
  }, [editId]);

  // --- Auto-save to localStorage (debounced, skip in edit mode) ---
  useEffect(() => {
    if (editId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!title && !body) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const draft: DraftData = {
        title, body, category, tags, slug, seoKeyword, seoDescription, imageTitle,
        excerpt, scheduledAt, sticky, commentStatus, pingStatus,
        savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [editId, title, body, category, tags, slug, seoKeyword, seoDescription, imageTitle, excerpt, scheduledAt, sticky, commentStatus, pingStatus]);

  // --- beforeunload guard ---
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ((title || body) && !submitted.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [title, body]);

  useEffect(() => {
    if (!tracked.current) {
      capture("write_page_viewed");
      tracked.current = true;
    }
  }, []);

  // --- Auto-grow textareas ---
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 300)}px`;
  }, [body]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // --- Close slash menu on click outside ---
  useEffect(() => {
    if (!slashOpen) return;
    const handler = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setSlashOpen(false);
        slashStart.current = null;
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [slashOpen]);

  // --- Image upload helper (shared by paste and drag-drop) ---

  const uploadImage = useCallback(
    async (file: File) => {
      const el = bodyRef.current;
      const pos = el?.selectionStart ?? body.length;

      const id = Date.now();
      const placeholder = `![Uploading image...](uploading-${id})`;
      setBody((prev) => prev.slice(0, pos) + placeholder + prev.slice(pos));
      setUploading(true);

      try {
        const res = await upload<{ data: { url: string } }>("/api/uploads/image", file);
        const imageMarkdown = `![image](${res.data.url})`;
        setBody((current) => current.replace(placeholder, imageMarkdown));
        toast.success("Image uploaded");
      } catch (err) {
        setBody((current) => current.replace(placeholder, ""));
        toast.error(err instanceof ApiError ? err.message : "Image upload failed");
      } finally {
        setUploading(false);
      }
    },
    [body.length, upload],
  );

  // --- Image paste handler ---

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) return;
          e.preventDefault();
          uploadImage(file);
          return;
        }
      }
    },
    [uploadImage],
  );

  // --- Drag and drop handler ---

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);

      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      for (const file of files) {
        uploadImage(file);
      }
    },
    [uploadImage],
  );

  // --- Formatting helpers ---

  const wrapSelection = useCallback(
    (before: string, after: string) => {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = body.slice(start, end);

      const outerStart = start - before.length;
      const outerEnd = end + after.length;
      if (
        outerStart >= 0 && outerEnd <= body.length &&
        body.slice(outerStart, start) === before &&
        body.slice(end, outerEnd) === after
      ) {
        const next = body.slice(0, outerStart) + selected + body.slice(outerEnd);
        setBody(next);
        requestAnimationFrame(() => { el.focus(); el.selectionStart = outerStart; el.selectionEnd = outerStart + selected.length; });
        return;
      }

      const replacement = `${before}${selected || "text"}${after}`;
      const next = body.slice(0, start) + replacement + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => { el.focus(); el.selectionStart = start + before.length; el.selectionEnd = start + before.length + (selected || "text").length; });
    },
    [body],
  );

  const insertBlock = useCallback(
    (beforeLine: string, afterLine: string, placeholder: string) => {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = body.slice(start, end);

      if (beforeLine && afterLine) {
        const bLen = beforeLine.length + 1;
        const aLen = afterLine.length + 1;
        const outerStart = start - bLen;
        const outerEnd = end + aLen;
        if (
          outerStart >= 0 && outerEnd <= body.length &&
          body.slice(outerStart, outerStart + beforeLine.length) === beforeLine &&
          body[outerStart + beforeLine.length] === "\n" &&
          body.slice(end + 1, end + 1 + afterLine.length) === afterLine &&
          body[end] === "\n"
        ) {
          const next = body.slice(0, outerStart) + selected + body.slice(outerEnd);
          setBody(next);
          requestAnimationFrame(() => { el.focus(); el.selectionStart = outerStart; el.selectionEnd = outerStart + selected.length; });
          return;
        }
      }

      const content = selected || placeholder;
      const needsNewlineBefore = start > 0 && body[start - 1] !== "\n" ? "\n" : "";
      const needsNewlineAfter = end < body.length && body[end] !== "\n" ? "\n" : "";
      const block = beforeLine
        ? `${needsNewlineBefore}${beforeLine}\n${content}\n${afterLine}${needsNewlineAfter}`
        : `${needsNewlineBefore}${content}${needsNewlineAfter}`;
      const next = body.slice(0, start) + block + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        const contentStart = start + needsNewlineBefore.length + (beforeLine ? beforeLine.length + 1 : 0);
        el.selectionStart = contentStart;
        el.selectionEnd = contentStart + content.length;
      });
    },
    [body],
  );

  const insertAtLine = useCallback(
    (prefix: string) => {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const lineStart = body.lastIndexOf("\n", start - 1) + 1;

      if (body.slice(lineStart, lineStart + prefix.length) === prefix) {
        const next = body.slice(0, lineStart) + body.slice(lineStart + prefix.length);
        setBody(next);
        requestAnimationFrame(() => { el.focus(); el.selectionStart = Math.max(lineStart, start - prefix.length); el.selectionEnd = Math.max(lineStart, end - prefix.length); });
        return;
      }

      const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
      setBody(next);
      requestAnimationFrame(() => { el.focus(); el.selectionStart = start + prefix.length; el.selectionEnd = end + prefix.length; });
    },
    [body],
  );

  // --- Slash commands ---

  const filteredCommands = slashCommands.filter(
    (c) => c.label.toLowerCase().includes(slashFilter.toLowerCase()),
  );

  const applySlashCommand = useCallback(
    (cmd: (typeof slashCommands)[number]) => {
      const el = bodyRef.current;
      if (!el || slashStart.current === null) return;
      const insertAt = slashStart.current;
      const cursorEnd = el.selectionStart;
      const before = body.slice(0, insertAt);
      const after = body.slice(cursorEnd);

      if (cmd.block) {
        const next = before + cmd.block + after;
        setBody(next);
        requestAnimationFrame(() => {
          el.focus();
          const cursorPos = insertAt + cmd.block.indexOf("\n\n") + 1;
          el.selectionStart = el.selectionEnd = cursorPos >= insertAt ? cursorPos : insertAt + cmd.block.length;
        });
      } else if (cmd.prefix) {
        const next = before + cmd.prefix + after;
        setBody(next);
        requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = insertAt + cmd.prefix.length; });
      }
      setSlashOpen(false);
      slashStart.current = null;
    },
    [body],
  );

  const getCaretCoords = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return { top: 0, left: 0 };
    const div = document.createElement("div");
    const style = window.getComputedStyle(el);
    const props = [
      "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
      "paddingTop", "paddingLeft", "paddingRight", "paddingBottom",
      "borderTopWidth", "borderLeftWidth", "whiteSpace", "wordWrap", "overflowWrap",
    ] as const;
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordWrap = "break-word";
    div.style.width = `${el.clientWidth}px`;
    for (const p of props) div.style.setProperty(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), style.getPropertyValue(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)));
    const text = el.value.slice(0, el.selectionStart);
    div.textContent = text;
    const span = document.createElement("span");
    span.textContent = "|";
    div.appendChild(span);
    document.body.appendChild(div);
    const rect = el.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    document.body.removeChild(div);
    // Clamp to viewport
    const top = Math.min(
      rect.top + (spanRect.top - divRect.top) - el.scrollTop + 24,
      window.innerHeight - 300,
    );
    const left = Math.min(
      rect.left + (spanRect.left - divRect.left),
      window.innerWidth - 280,
    );
    return { top: Math.max(0, top), left: Math.max(0, left) };
  }, []);

  // --- Keyboard handling ---

  const handleBodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.metaKey || e.ctrlKey;

      if (slashOpen) {
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (filteredCommands[slashIndex]) applySlashCommand(filteredCommands[slashIndex]); return; }
        if (e.key === "Escape") { e.preventDefault(); setSlashOpen(false); slashStart.current = null; return; }
      }

      // List continuation on Enter
      if (e.key === "Enter" && !mod && !e.shiftKey) {
        const el = e.currentTarget;
        const pos = el.selectionStart;
        const lineStart = body.lastIndexOf("\n", pos - 1) + 1;
        const currentLine = body.slice(lineStart, pos);

        for (const pattern of listPatterns) {
          const match = currentLine.match(pattern.regex);
          if (match) {
            const prefixOnly = currentLine.replace(pattern.regex, "").trim() === "";
            if (prefixOnly) {
              e.preventDefault();
              const next = body.slice(0, lineStart) + "\n" + body.slice(pos);
              setBody(next);
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = lineStart + 1; });
              return;
            }
            e.preventDefault();
            const nextPrefix = pattern.next(match);
            const insertion = "\n" + nextPrefix;
            const next = body.slice(0, pos) + insertion + body.slice(pos);
            setBody(next);
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = pos + insertion.length; });
            return;
          }
        }
      }

      // Tab indentation
      if (e.key === "Tab") {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const lineStart = body.lastIndexOf("\n", start - 1) + 1;
        if (e.shiftKey) {
          if (body.slice(lineStart, lineStart + 2) === "  ") {
            const next = body.slice(0, lineStart) + body.slice(lineStart + 2);
            setBody(next);
            requestAnimationFrame(() => { el.selectionStart = Math.max(lineStart, start - 2); el.selectionEnd = Math.max(lineStart, end - 2); });
          }
        } else {
          const next = body.slice(0, lineStart) + "  " + body.slice(lineStart);
          setBody(next);
          requestAnimationFrame(() => { el.selectionStart = start + 2; el.selectionEnd = end + 2; });
        }
        return;
      }

      if (mod && e.key === "b") { e.preventDefault(); wrapSelection("**", "**"); }
      else if (mod && e.key === "i") { e.preventDefault(); wrapSelection("*", "*"); }
      else if (mod && e.key === "k") { e.preventDefault(); wrapSelection("[", "](url)"); }
    },
    [slashOpen, filteredCommands, slashIndex, applySlashCommand, wrapSelection, body],
  );

  const handleBodyChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setBody(val);

      const pos = e.target.selectionStart;
      const charBefore = val[pos - 1];

      if (charBefore === "/") {
        const twoBack = pos >= 2 ? val[pos - 2] : "\n";
        if (twoBack === "\n" || twoBack === undefined || twoBack === " ") {
          slashStart.current = pos - 1;
          setSlashFilter("");
          setSlashIndex(0);
          setSlashOpen(true);
          setSlashPos(getCaretCoords());
          return;
        }
      }

      if (slashOpen && slashStart.current !== null) {
        if (pos <= slashStart.current) {
          setSlashOpen(false);
          slashStart.current = null;
        } else {
          const filter = val.slice(slashStart.current + 1, pos);
          if (filter.includes(" ") || filter.includes("\n")) {
            setSlashOpen(false);
            slashStart.current = null;
          } else {
            setSlashFilter(filter);
            setSlashIndex(0);
          }
        }
      }
    },
    [slashOpen, getCaretCoords],
  );

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); }
  };

  // --- Toolbar ---

  const toolbarActions = [
    { icon: Bold, label: `Bold (${modKey}+B)`, action: () => wrapSelection("**", "**") },
    { icon: Italic, label: `Italic (${modKey}+I)`, action: () => wrapSelection("*", "*") },
    { icon: Strikethrough, label: "Strikethrough", action: () => wrapSelection("~~", "~~") },
    { sep: true },
    { icon: Heading2, label: "Heading 2", action: () => insertAtLine("## ") },
    { icon: Heading3, label: "Heading 3", action: () => insertAtLine("### ") },
    { sep: true },
    { icon: LinkIcon, label: `Link (${modKey}+K)`, action: () => wrapSelection("[", "](url)") },
    { icon: Image, label: "Image", action: () => wrapSelection("![", "](url)") },
    { sep: true },
    { icon: Code, label: "Inline code", action: () => wrapSelection("`", "`") },
    { icon: SquareCode, label: "Code block", action: () => insertBlock("```", "```", "code here") },
    { sep: true },
    { icon: List, label: "Bullet list", action: () => insertAtLine("- ") },
    { icon: ListOrdered, label: "Numbered list", action: () => insertAtLine("1. ") },
    { icon: CheckSquare, label: "Task list", action: () => insertAtLine("- [ ] ") },
    { icon: Quote, label: "Blockquote", action: () => insertAtLine("> ") },
    { icon: Table, label: "Table", action: () => insertBlock("", "", "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| cell | cell | cell |") },
    { icon: Minus, label: "Divider", action: () => {
      const el = bodyRef.current;
      if (!el) return;
      const pos = el.selectionStart;
      const before = pos > 0 && body[pos - 1] !== "\n" ? "\n" : "";
      const next = body.slice(0, pos) + `${before}\n---\n\n` + body.slice(pos);
      setBody(next);
      requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = pos + before.length + 6; });
    }},
  ] as const;

  const categories = categoriesData?.data ?? [];
  const availableTags = tagsData?.data ?? [];
  const templates = templatesData?.data ?? [];
  const wpConnected = settings?.data?.wordpress?.configured;

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setDraftRestored(false);
  }

  function discardDraft() {
    setTitle(""); setBody(""); setCategory(""); setTags(""); setSlug("");
    setSeoKeyword(""); setSeoDescription(""); setImageTitle(""); setExcerpt("");
    setScheduledAt(""); setSticky(false); setCommentStatus("open"); setPingStatus("open");
    clearDraft();
    toast.success("Draft discarded");
  }

  async function handleSubmit(publish: boolean) {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required");
      return;
    }
    const isScheduling = !publish && !!scheduledAt;
    setSubmitting(true);
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

      const payload = {
        title: title.trim(),
        body: body.trim(),
        ...(category && { category }),
        ...(tagList.length > 0 && { tags: tagList }),
        ...(slug.trim() && { slug: slug.trim() }),
        ...(seoKeyword.trim() && { seoKeyword: seoKeyword.trim() }),
        ...(seoDescription.trim() && { seoDescription: seoDescription.trim() }),
        ...(imageTitle.trim() && { imageTitle: imageTitle.trim() }),
        ...(excerpt.trim() && { excerpt: excerpt.trim() }),
        ...(scheduledAt && { scheduledAt: new Date(scheduledAt).toISOString() }),
        ...(sticky && { sticky: true }),
        ...(commentStatus !== "open" && { commentStatus: commentStatus as "open" | "closed" }),
        ...(pingStatus !== "open" && { pingStatus: pingStatus as "open" | "closed" }),
        publish,
      };

      if (editId) {
        await call(`/api/posts/${editId}`, { method: "PATCH", body: payload });
        capture("post_updated_from_editor", { publish });
        toast.success(publish ? "Post update queued for publishing" : "Post update queued");
      } else {
        await call("/api/posts/direct", { method: "POST", body: payload });
        capture("post_created_from_editor", { publish });
        toast.success(
          isScheduling ? "Post scheduled" : publish ? "Post queued for publishing" : "Draft queued for sync",
        );
      }

      submitted.current = true;
      clearDraft();
      router.push("/admin/posts");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save post");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveTemplate() {
    const name = prompt("Template name:");
    if (!name?.trim()) return;
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      await call("/api/templates", {
        method: "POST",
        body: {
          name: name.trim(),
          body: body.trim(),
          ...(category && { category }),
          ...(tagList.length > 0 && { tags: tagList }),
        },
      });
      toast.success("Template saved");
      refetchTemplates();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save template");
    }
  }

  function applyTemplate(template: ApiPostTemplate) {
    setBody(template.body);
    if (template.category) setCategory(template.category);
    if (template.tags?.length) setTags(template.tags.join(", "));
    toast.success(`Template "${template.name}" applied`);
  }

  if (settingsLoading || editLoading) return null;

  return (
    <div
      className="pb-28 md:pb-6"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* WordPress not connected warning */}
      {!wpConnected && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-200">
            WordPress is not connected. You can write, but publishing requires a WordPress connection.{" "}
            <Link href="/admin/settings" className="underline hover:text-amber-100">Connect in Settings</Link>
          </p>
        </div>
      )}

      {/* Draft restored notice */}
      {draftRestored && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2 mb-4">
          <p className="text-sm text-muted-foreground">Draft restored from your last session.</p>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={discardDraft}>
            Discard
          </Button>
        </div>
      )}

      {/* Drag overlay */}
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="rounded-xl border-2 border-dashed border-violet-500 bg-violet-500/10 px-12 py-8">
            <p className="text-lg font-medium text-violet-400">Drop image to upload</p>
          </div>
        </div>
      )}

      {/* Borderless title */}
      <textarea
        ref={titleRef}
        placeholder="Post title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        rows={1}
        className="w-full text-3xl font-bold bg-transparent border-0 outline-none resize-none placeholder:text-muted-foreground/50 py-6 leading-tight"
      />

      {/* Sticky formatting toolbar */}
      <TooltipProvider delayDuration={300}>
        <div className="sticky top-0 z-30 -mx-1 px-1 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/50 mb-4">
          <div className="flex items-center gap-0.5 flex-wrap">
            {toolbarActions.map((item, i) =>
              "sep" in item ? (
                <div key={i} className="w-px h-5 bg-border mx-0.5 hidden sm:block" />
              ) : (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={item.action}
                      aria-label={item.label}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <item.icon className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ),
            )}
            <div className="w-px h-5 bg-border mx-0.5 hidden sm:block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  aria-label={showPreview ? "Hide preview" : "Show preview"}
                  className={`p-1.5 rounded transition-colors ${showPreview ? "bg-violet-500/20 text-violet-400" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {showPreview ? "Hide preview" : "Preview"}
              </TooltipContent>
            </Tooltip>
            {uploading && (
              <span className="text-xs text-muted-foreground ml-2 animate-pulse">Uploading image...</span>
            )}
            {/* Template controls */}
            {templates.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <select
                  onChange={(e) => {
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t) applyTemplate(t);
                    e.target.value = "";
                  }}
                  className="h-7 text-xs rounded border border-input bg-transparent px-2 text-muted-foreground"
                  defaultValue=""
                >
                  <option value="" disabled>Templates...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>

      {/* Writing area + preview */}
      <div className={`relative ${showPreview ? "grid grid-cols-1 md:grid-cols-2 gap-4" : ""}`}>
        <div className="relative">
          <textarea
            ref={bodyRef}
            placeholder="Start writing, or type / for commands..."
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleBodyKeyDown}
            onPaste={handlePaste}
            className="w-full min-h-[400px] text-[15px] leading-relaxed bg-transparent border-0 outline-none resize-none placeholder:text-muted-foreground/40"
          />

          {/* Slash command menu */}
          {slashOpen && filteredCommands.length > 0 && slashPos && (
            <div
              ref={slashMenuRef}
              role="listbox"
              className="fixed z-50 w-64 max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-lg"
              style={{ top: slashPos.top, left: slashPos.left }}
            >
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.label}
                  type="button"
                  role="option"
                  aria-selected={i === slashIndex}
                  className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors ${
                    i === slashIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                  onMouseDown={(e) => { e.preventDefault(); applySlashCommand(cmd); }}
                  onMouseEnter={() => setSlashIndex(i)}
                >
                  <cmd.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">{cmd.label}</div>
                    <div className="text-xs text-muted-foreground">{cmd.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Markdown preview */}
        {showPreview && (
          <div className="hidden md:block border-l pl-4 min-h-[400px] overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Preview</p>
            <div className="prose prose-invert prose-sm max-w-none">
              <MarkdownPreview content={body} />
            </div>
          </div>
        )}
      </div>

      {/* Post settings */}
      <div className="mt-8 border-t pt-6">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSettings ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Post settings
        </button>

        {showSettings && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="category" className="text-xs text-muted-foreground">Category</Label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tags" className="text-xs text-muted-foreground">Tags</Label>
                <Input id="tags" placeholder={availableTags.length > 0 ? availableTags.slice(0, 3).map((t) => t.name).join(", ") : "tag1, tag2, ..."} value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="imageTitle" className="text-xs text-muted-foreground">Featured image title</Label>
                <Input id="imageTitle" placeholder="Leave blank for no image" value={imageTitle} onChange={(e) => setImageTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug" className="text-xs text-muted-foreground">Slug</Label>
                <Input id="slug" placeholder="auto-generated-from-title" value={slug} onChange={(e) => setSlug(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="excerpt" className="text-xs text-muted-foreground">Custom excerpt</Label>
              <Textarea id="excerpt" placeholder="Custom excerpt for search results (leave blank for auto-generated)" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="resize-none h-16" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="seoKeyword" className="text-xs text-muted-foreground">Focus keyword</Label>
                <Input id="seoKeyword" placeholder="Primary SEO keyword" value={seoKeyword} onChange={(e) => setSeoKeyword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seoDescription" className="text-xs text-muted-foreground">Meta description ({seoDescription.length}/160)</Label>
                <Textarea id="seoDescription" placeholder="Brief description for search engines" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value.slice(0, 160))} className="resize-none h-20" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="scheduledAt" className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Schedule publish
                </Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="text-sm"
                />
                {scheduledAt && (
                  <button type="button" onClick={() => setScheduledAt("")} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear schedule
                  </button>
                )}
              </div>
              <div className="space-y-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sticky} onChange={(e) => setSticky(e.target.checked)} className="rounded border-input" />
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Pin className="w-3.5 h-3.5" /> Sticky post (pin to top)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={commentStatus === "closed"} onChange={(e) => setCommentStatus(e.target.checked ? "closed" : "open")} className="rounded border-input" />
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> Disable comments
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={pingStatus === "closed"} onChange={(e) => setPingStatus(e.target.checked ? "closed" : "open")} className="rounded border-input" />
                  <span className="text-xs text-muted-foreground">Disable pingbacks</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="fixed bottom-14 left-0 right-0 md:static md:bottom-auto border-t md:border-0 bg-background/95 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none p-3 md:p-0 md:mt-6 flex gap-2 justify-end z-40">
        {!editId && body.trim() && (
          <Button variant="ghost" size="sm" disabled={submitting} onClick={handleSaveTemplate} className="mr-auto text-xs text-muted-foreground">
            <Copy className="w-3.5 h-3.5 mr-1" /> Save as template
          </Button>
        )}
        <Button variant="outline" disabled={submitting || uploading} onClick={() => handleSubmit(false)}>
          {submitting ? "Saving..." : scheduledAt ? "Schedule" : editId ? "Update Draft" : "Save as Draft"}
        </Button>
        {!scheduledAt && (
          <Button disabled={submitting || uploading} onClick={() => handleSubmit(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
            {submitting ? "Publishing..." : editId ? "Update & Publish" : "Publish"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Simple client-side markdown to HTML renderer for preview.
 *  Content is the user's own editor input — HTML-escaped before processing. */
function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => {
    if (!content) return "";
    let out = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks (must be before inline processing)
    out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre class="bg-muted/50 rounded p-3 text-xs overflow-x-auto"><code>${code.trim()}</code></pre>`);

    // Headings
    out = out.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>");
    out = out.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>");
    out = out.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
    out = out.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    out = out.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
    out = out.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

    // Horizontal rules
    out = out.replace(/^---$/gm, "<hr />");

    // Images
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="rounded max-w-full" />');

    // Links
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-violet-400 underline">$1</a>');

    // Bold and italic
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
    out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
    out = out.replace(/`([^`]+)`/g, '<code class="bg-muted/50 rounded px-1 text-xs">$1</code>');

    // Lists
    out = out.replace(/^\s*[-*+]\s+(.*)$/gm, "<li>$1</li>");
    out = out.replace(/^\s*\d+\.\s+(.*)$/gm, "<li>$1</li>");

    // Blockquotes
    out = out.replace(/^&gt;\s?(.*)$/gm, '<blockquote class="border-l-2 border-muted-foreground/30 pl-3 italic">$1</blockquote>');

    // Paragraphs — wrap non-tag lines
    out = out.replace(/^(?!<[a-z/])(.+)$/gm, "<p>$1</p>");

    // Clean up double line breaks
    out = out.replace(/\n{2,}/g, "\n");

    return out;
  }, [content]);

  // Content is user's own editor input, HTML-escaped above before any processing
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
