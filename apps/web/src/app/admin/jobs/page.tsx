"use client";

import { useCallback, useState } from "react";
import { useApi } from "@/hooks/use-api";
import { useEventSource } from "@/hooks/use-event-source";
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
import { toast } from "sonner";
import type { JobStatus } from "@notipo/shared";

interface JobRow {
  id: string;
  type: string;
  status: string;
  postId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  post: { title: string } | null;
}

interface JobUpdateEvent {
  jobId: string;
  type: string;
  status: string;
  step?: string;
}

interface LiveStep {
  steps: string[];
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  COMPLETED: "default",
  RUNNING: "outline",
  PENDING: "secondary",
  FAILED: "destructive",
  CANCELLED: "secondary",
};

const filters: Array<{ label: string; value: JobStatus | "ALL" }> = [
  { label: "All", value: "ALL" },
  { label: "Running", value: "RUNNING" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Failed", value: "FAILED" },
];

function jobTypeLabel(type: string) {
  switch (type) {
    case "SYNC_POST": return "Sync";
    case "PUBLISH_POST": return "Publish";
    case "NOTION_POLL": return "Poll";
    default: return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export default function JobsPage() {
  const [filter, setFilter] = useState<JobStatus | "ALL">("ALL");
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [liveSteps, setLiveSteps] = useState<Map<string, LiveStep>>(new Map());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  function toggleExpanded(jobId: string) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  const queryFilter = filter === "ALL" ? "" : `&status=${filter}`;
  const { data, loading, refetch } = useApi<{ data: JobRow[]; total: number }>(
    `/api/jobs?limit=${limit}&offset=${offset}${queryFilter}`,
  );

  const onEvent = useCallback((_event: string, eventData: unknown) => {
    const payload = eventData as JobUpdateEvent;
    if (payload?.jobId && payload.status === "RUNNING" && payload.step) {
      setLiveSteps((prev) => {
        const next = new Map(prev);
        const existing = next.get(payload.jobId);
        const steps = existing?.steps ? [...existing.steps] : [];
        if (!steps.includes(payload.step!)) {
          steps.push(payload.step!);
        }
        next.set(payload.jobId, { steps });
        return next;
      });
    } else if (payload?.jobId && payload.status === "FAILED") {
      setLiveSteps((prev) => {
        const next = new Map(prev);
        next.delete(payload.jobId);
        return next;
      });
      toast.error(`Job failed: ${jobTypeLabel(payload.type)}`, {
        description: "Check the jobs page for details",
      });
    } else if (payload?.jobId && payload.status !== "RUNNING") {
      setLiveSteps((prev) => {
        const next = new Map(prev);
        next.delete(payload.jobId);
        return next;
      });
    }
    refetch();
  }, [refetch]);

  useEventSource(onEvent);

  const jobs = data?.data ?? [];
  const total = data?.total ?? 0;

  function timeAgo(iso: string) {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function getJobSteps(job: JobRow): string[] {
    // Live steps from SSE take priority
    const live = liveSteps.get(job.id);
    if (live?.steps.length) return live.steps;
    // Persisted steps from API result
    if (job.result && typeof job.result === "object" && "steps" in job.result && Array.isArray(job.result.steps)) {
      return job.result.steps as string[];
    }
    // Fallback: single step
    if (job.result && typeof job.result === "object" && "step" in job.result) {
      return [job.result.step as string];
    }
    return [];
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Jobs</h1>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {filters.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setFilter(f.value);
              setOffset(0);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            <p className="text-sm text-muted-foreground">No jobs yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Jobs are created when posts sync from Notion</p>
          </div>
        ) : (
          jobs.map((job) => {
            const steps = getJobSteps(job);
            return (
              <div key={job.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {job.status === "RUNNING" && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                      </span>
                    )}
                    <span className="text-xs font-medium">{jobTypeLabel(job.type)}</span>
                  </div>
                  <Badge variant={statusVariant[job.status] ?? "secondary"} className={`shrink-0 ${job.status === "RUNNING" ? "text-violet-400 border-violet-500/30" : ""}`}>
                    {job.status}
                  </Badge>
                </div>
                {job.post && (
                  <p className="text-sm truncate">{job.post.title}</p>
                )}
                {steps.length > 0 && (
                  job.status === "RUNNING" ? (
                    <div className="space-y-1 pt-1">
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span className="text-xs text-muted-foreground">{s}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pt-1">
                      <button onClick={() => toggleExpanded(job.id)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <svg className={`w-3 h-3 transition-transform ${expandedJobs.has(job.id) ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                        {steps.length} step{steps.length === 1 ? "" : "s"}
                      </button>
                      {expandedJobs.has(job.id) && (
                        <div className="space-y-1 mt-1">
                          {steps.map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              <span className="text-xs text-muted-foreground">{s}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{timeAgo(job.createdAt)}</span>
                </div>
                {job.error && (
                  <p className="text-xs text-destructive">{job.error}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Post</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <svg className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                  <p className="text-sm text-muted-foreground">No jobs yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Jobs are created when posts sync from Notion</p>
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => {
                  const steps = getJobSteps(job);
                  return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {job.status === "RUNNING" && (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                          </span>
                        )}
                        <span className="text-xs font-medium">{jobTypeLabel(job.type)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <div className="text-sm truncate">{job.post?.title ?? "\u2014"}</div>
                      {steps.length > 0 && (
                        job.status === "RUNNING" ? (
                          <div className="space-y-0.5 mt-1">
                            {steps.map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <svg className="w-3 h-3 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                <span className="text-xs text-muted-foreground">{s}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1">
                            <button onClick={() => toggleExpanded(job.id)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                              <svg className={`w-3 h-3 transition-transform ${expandedJobs.has(job.id) ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                              {steps.length} step{steps.length === 1 ? "" : "s"}
                            </button>
                            {expandedJobs.has(job.id) && (
                              <div className="space-y-0.5 mt-1">
                                {steps.map((s, i) => (
                                  <div key={i} className="flex items-center gap-1.5">
                                    <svg className="w-3 h-3 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                    <span className="text-xs text-muted-foreground">{s}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[job.status] ?? "secondary"} className={job.status === "RUNNING" ? "text-violet-400 border-violet-500/30" : ""}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(job.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-destructive truncate max-w-[200px]">
                      {job.error ?? ""}
                    </TableCell>
                  </TableRow>
                  );
                })

            )}
          </TableBody>
        </Table>
      </div>

      {total > limit && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">
            Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
