"use client";

import { useState } from "react";
import { useApi, useApiCall } from "@/hooks/use-api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiPost, ApiListResponse, PostStatus } from "@notipo/shared";
import { Copy, Trash2, Send } from "lucide-react";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PUBLISHED: "default",
  SYNCED: "secondary",
  FAILED: "destructive",
  IMAGES_PROCESSING: "outline",
  PUBLISHING: "outline",
  UPDATE_PENDING: "outline",
};

const filters: Array<{ label: string; value: PostStatus | "ALL" }> = [
  { label: "All", value: "ALL" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Synced", value: "SYNCED" },
  { label: "Failed", value: "FAILED" },
];

export default function PostsPage() {
  const [filter, setFilter] = useState<PostStatus | "ALL">("ALL");
  const [deleteTarget, setDeleteTarget] = useState<ApiPost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState(false);
  const { data, loading, refetch } = useApi<ApiListResponse<ApiPost>>("/api/posts");
  const { call } = useApiCall();

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await call(`/api/posts/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Post deleted");
      setDeleteTarget(null);
      refetch();
    } catch {
      toast.error("Failed to delete post");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDuplicate(postId: string) {
    try {
      await call(`/api/posts/${postId}/duplicate`, { method: "POST" });
      toast.success("Post duplicated");
      refetch();
    } catch {
      toast.error("Failed to duplicate post");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === posts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(posts.map((p) => p.id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setBulkAction(true);
    try {
      await call("/api/posts/bulk-delete", { method: "POST", body: { ids: [...selected] } });
      toast.success(`${selected.size} post(s) deleted`);
      setSelected(new Set());
      refetch();
    } catch {
      toast.error("Failed to delete posts");
    } finally {
      setBulkAction(false);
    }
  }

  async function handleBulkPublish() {
    if (selected.size === 0) return;
    setBulkAction(true);
    try {
      await call("/api/posts/bulk-publish", { method: "POST", body: { ids: [...selected] } });
      toast.success(`${selected.size} post(s) queued for publishing`);
      setSelected(new Set());
      refetch();
    } catch {
      toast.error("Failed to publish posts");
    } finally {
      setBulkAction(false);
    }
  }

  const posts = (data?.data ?? []).filter(
    (p) => filter === "ALL" || p.status === filter,
  );

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Posts</h1>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <div className="flex gap-1">
          {filters.map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto border rounded-md px-2 py-1 bg-muted/30">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={bulkAction} onClick={handleBulkPublish}>
              <Send className="w-3.5 h-3.5 mr-1" /> Publish
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300" disabled={bulkAction} onClick={handleBulkDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-1">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm text-muted-foreground">No posts yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Posts will appear here after syncing from Notion</p>
          </div>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="rounded-md border p-3 space-y-1">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(post.id)}
                  onChange={() => toggleSelect(post.id)}
                  className="mt-1 rounded border-input shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm leading-snug">{post.title}</p>
                    <Badge variant={statusVariant[post.status] ?? "secondary"} className="shrink-0">
                      {post.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                    <span>{post.category?.name ?? "No category"}</span>
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/write?id=${post.id}`} className="text-accent-purple hover:underline">
                        Edit
                      </Link>
                      <button onClick={() => handleDuplicate(post.id)} className="text-accent-purple hover:underline">
                        Duplicate
                      </button>
                      {post.wpUrl && (
                        <a href={post.wpUrl} target="_blank" rel="noopener noreferrer" className="text-accent-purple hover:underline">
                          View on WP
                        </a>
                      )}
                      <button
                        onClick={() => setDeleteTarget(post)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={posts.length > 0 && selected.size === posts.length}
                  onChange={toggleSelectAll}
                  className="rounded border-input"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>WP Link</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : posts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <svg className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-muted-foreground">No posts yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Posts will appear here after syncing from Notion</p>
                </TableCell>
              </TableRow>
            ) : (
              posts.map((post) => (
                <TableRow key={post.id} className={selected.has(post.id) ? "bg-muted/30" : ""}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(post.id)}
                      onChange={() => toggleSelect(post.id)}
                      className="rounded border-input"
                    />
                  </TableCell>
                  <TableCell className="font-medium">{post.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {post.category?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[post.status] ?? "secondary"}>
                      {post.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {post.wpUrl ? (
                      <a
                        href={post.wpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-accent-purple hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-3 whitespace-nowrap">
                    <Link
                      href={`/admin/write?id=${post.id}`}
                      className="text-sm text-accent-purple hover:underline"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDuplicate(post.id)}
                      className="text-sm text-accent-purple hover:underline"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() => setDeleteTarget(post)}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete post</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? This will also remove it from WordPress.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
