"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, useApiCall } from "@/hooks/use-api";
import { ApiError } from "@/lib/api-client";
import { capture } from "@/lib/posthog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown, ChevronRight, AlertTriangle,
  Clock, Copy, Pin, MessageSquare,
} from "lucide-react";
import Link from "next/link";
import type { ApiCategory, ApiTag, ApiPostTemplate, ApiListResponse } from "@notipo/shared";
import dynamic from "next/dynamic";

const BlockEditor = dynamic(
  () => import("@/components/admin/block-editor").then((m) => m.BlockEditor),
  { ssr: false },
);

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
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [editLoading, setEditLoading] = useState(!!editId);
  const [initialMarkdown, setInitialMarkdown] = useState<string | undefined>(undefined);
  const [editorReady, setEditorReady] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
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
        setInitialMarkdown(p.markdownContent || "");
        setSlug(p.slug || "");
        setSeoKeyword(p.seoKeyword || "");
        setSeoDescription(p.seoDescription || "");
        setImageTitle(p.featuredImageTitle || "");
        setExcerpt(p.excerpt || "");
        if (p.scheduledAt) setScheduledAt(p.scheduledAt.slice(0, 16));
        setSticky(p.sticky ?? false);
        setCommentStatus(p.commentStatus || "open");
        setPingStatus(p.pingStatus || "open");
        if (p.tags?.length) setTags(p.tags.join(", "));
        if (p.category?.name) setCategory(p.category.name);
        setEditorReady(true);
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
      if (!raw) {
        setEditorReady(true);
        return;
      }
      const draft: DraftData = JSON.parse(raw);
      if (Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(DRAFT_KEY);
        setEditorReady(true);
        return;
      }
      if (!draft.title && !draft.body) {
        setEditorReady(true);
        return;
      }
      setTitle(draft.title || "");
      setBody(draft.body || "");
      setInitialMarkdown(draft.body || "");
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
      setEditorReady(true);
    } catch {
      setEditorReady(true);
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

  // --- Auto-grow title textarea ---
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // --- Image upload for BlockNote ---
  const handleUploadFile = useCallback(
    async (file: File): Promise<string> => {
      const res = await upload<{ data: { url: string } }>("/api/uploads/image", file);
      return res.data.url;
    },
    [upload],
  );

  // --- Title Enter key → focus editor ---
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Focus the BlockNote editor
      const editorEl = document.querySelector(".bn-editor") as HTMLElement | null;
      editorEl?.focus();
    }
  }, []);

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
    setInitialMarkdown("");
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
    setInitialMarkdown(template.body);
    if (template.category) setCategory(template.category);
    if (template.tags?.length) setTags(template.tags.join(", "));
    toast.success(`Template "${template.name}" applied`);
  }

  if (settingsLoading || editLoading) return null;

  return (
    <div className="pb-28 md:pb-6">
      {/* WordPress not connected warning */}
      {!wpConnected && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-purple/30 bg-accent-purple/5 px-4 py-3 mb-4">
          <AlertTriangle className="w-4 h-4 text-accent-purple shrink-0" />
          <p className="text-sm text-text-secondary">
            WordPress is not connected. You can write, but publishing requires a WordPress connection.{" "}
            <Link href="/admin/settings" className="underline text-accent-purple hover:opacity-80">Connect in Settings</Link>
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

      {/* Template selector */}
      {templates.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
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

      {/* BlockNote editor */}
      {editorReady && (
        <BlockEditor
          initialMarkdown={initialMarkdown}
          onChange={setBody}
          uploadFile={handleUploadFile}
        />
      )}

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
        <Button variant="outline" disabled={submitting} onClick={() => handleSubmit(false)}>
          {submitting ? "Saving..." : scheduledAt ? "Schedule" : editId ? "Update Draft" : "Save as Draft"}
        </Button>
        {!scheduledAt && (
          <Button disabled={submitting} onClick={() => handleSubmit(true)} className="bg-accent-purple hover:bg-purple-600 text-white">
            {submitting ? "Publishing..." : editId ? "Update & Publish" : "Publish"}
          </Button>
        )}
      </div>
    </div>
  );
}
