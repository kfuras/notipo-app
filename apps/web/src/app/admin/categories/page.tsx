"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useApi, useApiCall } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, Trash2 } from "lucide-react";
import type { ApiCategory, ApiTag, ApiListResponse } from "@notipo/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getPreviewUrl(category: ApiCategory): string | null {
  if (category.previewUrl) return category.previewUrl;
  const bg = category.backgroundImage;
  if (!bg) return null;
  if (bg.startsWith("http://") || bg.startsWith("https://")) return bg;
  // Default bundled image (bare filename like "automation.png")
  return `${API_BASE}/api/default-category-images/${bg}`;
}

function CategoryImageCell({
  category,
  onUpdate,
}: {
  category: ApiCategory;
  onUpdate: () => void;
}) {
  const { call, upload } = useApiCall();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = getPreviewUrl(category);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await upload(`/api/categories/${category.id}/background-image`, file);
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    try {
      await call(`/api/categories/${category.id}/background-image`, {
        method: "DELETE",
      });
      onUpdate();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  }

  return (
    <>
      {previewUrl ? (
        <button onClick={() => setOpen(true)} className="group relative block">
          <img
            src={previewUrl}
            alt={`${category.name} background`}
            className="h-8 w-16 rounded object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
            <Upload className="size-3 text-white" />
          </span>
        </button>
      ) : (
        <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
          <Upload className="size-3" />
          Upload
        </Button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleUpload}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{category.name}</DialogTitle>
            <DialogDescription>Background image for featured image generation</DialogDescription>
          </DialogHeader>

          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${category.name} background`}
              className="w-full rounded aspect-[1200/628] object-cover"
            />
          ) : (
            <div className="flex items-center justify-center rounded-md border border-dashed p-8 text-sm text-muted-foreground">
              No image set
            </div>
          )}

          <DialogFooter>
            {category.backgroundImage && (
              <Button variant="destructive" size="sm" onClick={handleRemove}>
                <Trash2 className="size-3" />
                Remove
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3" />
              {uploading ? "Uploading..." : category.backgroundImage ? "Replace" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function CategoriesPage() {
  const { call } = useApiCall();
  const { data: catData, loading, refetch } = useApi<ApiListResponse<ApiCategory>>("/api/categories");
  const { data: tagData } = useApi<ApiListResponse<ApiTag>>("/api/tags");
  const [syncing, setSyncing] = useState(false);

  const categories = catData?.data ?? [];
  const tags = tagData?.data ?? [];

  async function syncFromWP() {
    setSyncing(true);
    try {
      await call("/api/categories/sync", { method: "POST" });
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categories & Tags</h1>
        <Button variant="outline" size="sm" onClick={syncFromWP} disabled={syncing}>
          {syncing ? "Syncing..." : "Sync from WordPress"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Imported automatically from WordPress. Upload background images for featured image generation.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold mb-2">Categories</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>WP ID</TableHead>
                  <TableHead>Background</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-16 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : categories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No categories</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Click &ldquo;Sync from WordPress&rdquo; to import</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {cat.wpCategoryId ?? "\u2014"}
                      </TableCell>
                      <TableCell>
                        <CategoryImageCell
                          category={cat}
                          onUpdate={refetch}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2">Tags</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>WP ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No tags</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Click &ldquo;Sync from WordPress&rdquo; to import</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  tags.map((tag) => (
                    <TableRow key={tag.id}>
                      <TableCell className="font-medium">{tag.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {tag.wpTagId ?? "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
