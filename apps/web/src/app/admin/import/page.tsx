"use client";

import { useState, useCallback } from "react";
import { useApi, useApiCall } from "@/hooks/use-api";
import { useEventSource } from "@/hooks/use-event-source";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Download, Check, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { capture } from "@/lib/posthog";

interface WPPost {
  id: number;
  title: string;
  status: string;
  slug: string;
  date: string;
  link: string;
  categories: number[];
  tags: number[];
  imported: boolean;
}

interface WPPostsResponse {
  data: WPPost[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

interface BillingData {
  data: { effectivePlan: string };
}

interface LiveJob {
  jobId: string;
  type: string;
  status: string;
  steps: string[];
}

/** Decode HTML entities in WP post titles (e.g. &#8217; -> ') using textarea trick */
function decodeTitle(html: string): string {
  if (typeof document === "undefined") return html;
  const el = document.createElement("textarea");
  el.innerHTML = html; // safe: textarea interprets entities but doesn't execute scripts
  return el.value;
}

export default function ImportPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("any");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [liveJobs, setLiveJobs] = useState<Map<string, LiveJob>>(new Map());

  const { data: billing } = useApi<BillingData>("/api/billing");
  const { data, loading, refetch } = useApi<WPPostsResponse>(
    billing?.data?.effectivePlan !== "FREE"
      ? `/api/import/wp-posts?page=${page}&perPage=20&status=${statusFilter}`
      : null,
  );
  const { call } = useApiCall();

  const isPro = billing?.data?.effectivePlan === "PRO" || billing?.data?.effectivePlan === "TRIAL";

  // SSE for live job updates
  const onEvent = useCallback(
    (_event: string, eventData: unknown) => {
      const payload = eventData as {
        jobId: string;
        type: string;
        status: string;
        step?: string;
      };
      if (payload.type !== "IMPORT_POST") return;

      if (payload.status === "RUNNING") {
        setLiveJobs((prev) => {
          const next = new Map(prev);
          const existing = next.get(payload.jobId);
          const steps = existing?.steps ? [...existing.steps] : [];
          if (payload.step && !steps.includes(payload.step)) {
            steps.push(payload.step);
          }
          next.set(payload.jobId, {
            jobId: payload.jobId,
            type: payload.type,
            status: payload.status,
            steps,
          });
          return next;
        });
      } else if (payload.status === "COMPLETED" || payload.status === "FAILED") {
        setLiveJobs((prev) => {
          const next = new Map(prev);
          next.delete(payload.jobId);
          return next;
        });
        if (payload.status === "COMPLETED") {
          toast.success("Post imported successfully");
        } else {
          toast.error("Import failed");
        }
        refetch();
      }
    },
    [refetch],
  );
  useEventSource(onEvent);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!data?.data) return;
    const importable = data.data.filter((p) => !p.imported || overwrite);
    if (selected.size === importable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importable.map((p) => p.id)));
    }
  }

  async function importSelected() {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const wpPostIds = Array.from(selected);
      await call("/api/import/posts/bulk", {
        method: "POST",
        body: { wpPostIds, overwrite },
      });
      capture("import_started", { count: wpPostIds.length, overwrite });
      toast.success(`${wpPostIds.length} import job${wpPostIds.length === 1 ? "" : "s"} queued`);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start import");
    } finally {
      setImporting(false);
    }
  }

  async function importAll() {
    setImportingAll(true);
    try {
      const result = await call("/api/import/posts/all", {
        method: "POST",
        body: { status: statusFilter, overwrite },
      });
      const count = (result as { data?: { count?: number } })?.data?.count ?? 0;
      capture("import_started", { count, overwrite, all: true });
      toast.success(`${count} import job${count === 1 ? "" : "s"} queued`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start import");
    } finally {
      setImportingAll(false);
    }
  }

  async function importSingle(wpPostId: number) {
    try {
      await call("/api/import/posts", {
        method: "POST",
        body: { wpPostId, overwrite },
      });
      capture("import_started", { count: 1, overwrite });
      toast.success("Import job queued");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start import");
    }
  }

  const posts = data?.data ?? [];

  // Pro gate
  if (billing && !isPro) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Import from WordPress</h1>
        <div className="rounded-md border p-8 text-center">
          <Download className="mx-auto h-10 w-10 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium mb-2">Pro Feature</p>
          <p className="text-sm text-muted-foreground mb-4">
            Import your existing WordPress posts into Notion with a Pro plan.
          </p>
          <Button asChild>
            <a href="/admin/billing">Upgrade to Pro</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Import from WordPress</h1>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button onClick={importSelected} disabled={importing} size="sm">
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              Import {selected.size} post{selected.size === 1 ? "" : "s"}
            </Button>
          )}
          {data && data.total > 0 && (
            <Button onClick={importAll} disabled={importingAll} size="sm" variant="outline">
              {importingAll ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              Import All ({data.total})
            </Button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {[
            { label: "All", value: "any" },
            { label: "Published", value: "publish" },
            { label: "Draft", value: "draft" },
          ].map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? "default" : "ghost"}
              size="sm"
              onClick={() => { setStatusFilter(f.value); setPage(1); }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="rounded"
          />
          Overwrite existing
        </label>
      </div>

      {/* Live import jobs */}
      {liveJobs.size > 0 && (
        <div className="space-y-2">
          {Array.from(liveJobs.values()).map((job) => (
            <div key={job.jobId} className="rounded-md border border-accent-purple/30 bg-accent-purple/5 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-accent-purple" />
                <span className="font-medium">Importing…</span>
              </div>
              {job.steps.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {job.steps[job.steps.length - 1]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <Download className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No WordPress posts found</p>
          </div>
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              className="rounded-md border p-3 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.has(post.id)}
                    onChange={() => toggleSelect(post.id)}
                    disabled={post.imported && !overwrite}
                    className="mt-1 rounded"
                  />
                  <p className="font-medium text-sm leading-snug">
                    {decodeTitle(post.title)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {post.imported && (
                    <Badge variant="secondary">
                      <Check className="w-3 h-3 mr-1" />
                      Imported
                    </Badge>
                  )}
                  <Badge variant={post.status === "publish" ? "default" : "outline"}>
                    {post.status}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pl-6">
                <span>{new Date(post.date).toLocaleDateString()}</span>
                {(!post.imported || overwrite) && (
                  <button
                    onClick={() => importSingle(post.id)}
                    className="text-accent-purple hover:underline"
                  >
                    Import
                  </button>
                )}
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
              <TableHead className="w-[1%]">
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={
                    posts.length > 0 &&
                    posts.filter((p) => !p.imported || overwrite).length > 0 &&
                    selected.size === posts.filter((p) => !p.imported || overwrite).length
                  }
                  className="rounded"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Imported</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : posts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <Download className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">No WordPress posts found</p>
                </TableCell>
              </TableRow>
            ) : (
              posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(post.id)}
                      onChange={() => toggleSelect(post.id)}
                      disabled={post.imported && !overwrite}
                      className="rounded"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {decodeTitle(post.title)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={post.status === "publish" ? "default" : "outline"}>
                      {post.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(post.date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {post.imported && (
                      <Badge variant="secondary">
                        <Check className="w-3 h-3 mr-1" />
                        Imported
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(!post.imported || overwrite) && (
                      <button
                        onClick={() => importSingle(post.id)}
                        className="text-sm text-accent-purple hover:underline whitespace-nowrap"
                      >
                        Import
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} post{data.total === 1 ? "" : "s"} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-muted-foreground">
              {page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
