"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useApi, useApiCall } from "@/hooks/use-api";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api-client";
import { capture } from "@/lib/posthog";
import { useEventSource } from "@/hooks/use-event-source";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiPost, ApiJob, ApiListResponse } from "@notipo/shared";

interface SettingsData {
  data: {
    notion: { configured: boolean; oauthAvailable: boolean; databaseId: string | null };
    wordpress: { configured: boolean };
    plan: string;
    effectivePlan: string;
    trialEndsAt: string | null;
  };
}

interface JobUpdateEvent {
  jobId: string;
  type: string;
  status: string;
  step?: string;
  postId?: string;
  notionPageId?: string;
}

interface LiveJob {
  jobId: string;
  type: string;
  status: string;
  steps: string[];
  postId?: string;
  notionPageId?: string;
}

export default function DashboardPage() {
  const { apiKey } = useAuth();
  const { call } = useApiCall();
  const { data: postsData, refetch: refetchPosts } = useApi<ApiListResponse<ApiPost>>("/api/posts");
  const { data: jobsData, refetch: refetchJobs } = useApi<{ data: ApiJob[]; total: number }>(
    "/api/jobs?limit=5",
  );
  const { data: settings, refetch: refetchSettings } = useApi<SettingsData>("/api/settings");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [liveJobs, setLiveJobs] = useState<Map<string, LiveJob>>(new Map());

  const onEvent = useCallback((_event: string, data: unknown) => {
    const payload = data as JobUpdateEvent;
    if (!payload?.jobId) {
      refetchJobs();
      refetchPosts();
      return;
    }

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
          postId: payload.postId,
          notionPageId: payload.notionPageId,
        });
        return next;
      });
    } else {
      // Job finished — remove from live tracking
      setLiveJobs((prev) => {
        const next = new Map(prev);
        next.delete(payload.jobId);
        return next;
      });

      if (payload.status === "COMPLETED") {
        const label = payload.type === "PUBLISH_POST" ? "Published" : "Synced";
        toast.success(`${label} successfully`);
        capture("job_completed", { type: payload.type });
      } else if (payload.status === "FAILED") {
        const label = payload.type === "PUBLISH_POST" ? "Publish" : "Sync";
        toast.error(`${label} failed — check Jobs for details`);
        capture("job_failed", { type: payload.type });
      }

      refetchJobs();
      refetchPosts();
    }
  }, [refetchJobs, refetchPosts]);

  useEventSource(onEvent);

  const posts = postsData?.data ?? [];
  const jobs = jobsData?.data ?? [];
  const notion = settings?.data?.notion;
  const wordpress = settings?.data?.wordpress;
  const effectivePlan = settings?.data?.effectivePlan;
  const canSyncNow = effectivePlan !== "FREE";

  const stats = {
    total: posts.length,
    published: posts.filter((p) => p.status === "PUBLISHED").length,
    synced: posts.filter((p) => p.status === "SYNCED").length,
    failed: posts.filter((p) => p.status === "FAILED").length,
  };

  const templateDone = typeof window !== "undefined" && !!apiKey && localStorage.getItem("notipo_template_done") === apiKey;
  const servicesConnected = !!notion?.configured && !!wordpress?.configured;
  const needsSetup = settings && !servicesConnected;
  const allSetUp = servicesConnected && templateDone;

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    capture("sync_now_clicked");
    try {
      await call("/api/sync-now", { method: "POST" });
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const jobTypeLabel = (type: string) => {
    switch (type) {
      case "SYNC_POST": return "Sync";
      case "PUBLISH_POST": return "Publish";
      default: return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    }
  };

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <OAuthResultHandler onSettingsUpdate={refetchSettings} />
      </Suspense>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {settings?.data?.plan === "TRIAL" && settings?.data?.trialEndsAt && (
          <Badge variant="secondary">
            Trial — {Math.max(0, Math.ceil((new Date(settings.data.trialEndsAt).getTime() - Date.now()) / 86400000))} days left
          </Badge>
        )}
        {settings?.data?.plan === "PRO" && (
          <Badge className="bg-primary text-primary-foreground">Pro</Badge>
        )}
        {effectivePlan === "FREE" && settings?.data?.plan !== "TRIAL" && (
          <Badge variant="outline">Free</Badge>
        )}
      </div>

      {needsSetup && settings && (
        <SetupCard settings={settings} onUpdate={refetchSettings} apiKey={apiKey} />
      )}
      {allSetUp && canSyncNow && (
        <SetupCompleteCard onSyncNow={handleSyncNow} syncing={syncing || liveJobs.size > 0} apiKey={apiKey} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Total Posts" value={stats.total} />
        <StatCard title="Published" value={stats.published} />
        <StatCard title="Synced" value={stats.synced} />
        <StatCard title="Failed" value={stats.failed} />
      </div>

      {/* Recent Posts — Notion-like property cards */}
      {posts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Recent Posts</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/posts">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {posts.slice(0, 4).map((post) => (
                <PostPropertyCard key={post.id} post={post} liveJobs={liveJobs} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Notion</span>
              <Badge variant={notion?.configured ? "default" : "secondary"}>
                {notion?.configured ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">WordPress</span>
              <Badge variant={wordpress?.configured ? "default" : "secondary"}>
                {wordpress?.configured ? "Connected" : "Not connected"}
              </Badge>
            </div>
            {notion?.configured && canSyncNow && (
              <div className="pt-2">
                <Button
                  size="sm"
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={syncing || liveJobs.size > 0}
                  onClick={handleSyncNow}
                >
                  {syncing
                    ? "Starting sync..."
                    : liveJobs.size > 0
                      ? (() => {
                          const latest = Array.from(liveJobs.values()).pop();
                          const step = latest?.steps[latest.steps.length - 1];
                          const fallback = latest?.type === "PUBLISH_POST" ? "Publishing..." : "Syncing...";
                          return step ?? fallback;
                        })()
                      : "Sync Now"}
                </Button>
                {syncError && (
                  <p className="text-xs text-destructive mt-1">{syncError}</p>
                )}
              </div>
            )}
            {notion?.configured && !canSyncNow && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground">
                  Instant sync is a Pro feature.{" "}
                  <Link href="/admin/billing" className="text-primary hover:underline">Upgrade</Link>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Live running jobs with step progress */}
            {Array.from(liveJobs.values()).map((lj) => (
              <div key={lj.jobId} className="mb-4 pb-4 border-b border-border last:border-0">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                    </span>
                    <span className="text-sm font-medium">{jobTypeLabel(lj.type)} Job</span>
                  </div>
                  <Badge variant="outline" className="text-xs text-violet-400 border-violet-500/30">Running</Badge>
                </div>
                <div className="space-y-1.5 ml-4">
                  {lj.steps.map((step) => (
                    <div key={step} className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <span className="text-xs text-muted-foreground">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Completed/failed jobs from API */}
            {jobs.length === 0 && liveJobs.size === 0 ? (
              <p className="text-sm text-muted-foreground">No recent jobs</p>
            ) : (
              <div className="space-y-2">
                {jobs.filter((j) => !liveJobs.has(j.id)).slice(0, liveJobs.size > 0 ? 3 : 5).map((job) => (
                  <div key={job.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 truncate mr-2">
                      {job.status === "COMPLETED" && (
                        <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </div>
                      )}
                      {job.status === "FAILED" && (
                        <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </div>
                      )}
                      {job.status !== "COMPLETED" && job.status !== "FAILED" && (
                        <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                        </div>
                      )}
                      <span className="truncate">{jobTypeLabel(job.type)}</span>
                    </div>
                    <Badge
                      variant={
                        job.status === "COMPLETED"
                          ? "default"
                          : job.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs shrink-0"
                    >
                      {job.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const postStatusStyle: Record<string, string> = {
  PUBLISHED: "bg-green-500/15 text-green-500",
  SYNCED: "bg-blue-500/15 text-blue-400",
  FAILED: "bg-red-500/15 text-red-400",
  IMAGES_PROCESSING: "bg-yellow-500/15 text-yellow-400",
  PUBLISHING: "bg-violet-500/15 text-violet-400",
  UPDATE_PENDING: "bg-orange-500/15 text-orange-400",
};

function PostPropertyCard({ post, liveJobs }: { post: ApiPost; liveJobs: Map<string, LiveJob> }) {
  // Check if a live job is running for this post
  const liveJob = Array.from(liveJobs.values()).find(
    (lj) => lj.notionPageId === post.notionPageId || lj.postId === post.id,
  );
  const liveStatus = liveJob
    ? liveJob.type === "PUBLISH_POST" ? "Publishing" : "Syncing"
    : null;

  return (
    <div className="rounded-xl border bg-card p-4 md:p-5">
      {/* Title header */}
      <div className="flex items-center gap-2 mb-3 pb-2.5 border-b">
        <div className="w-5 h-5 rounded bg-violet-500/15 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
        </div>
        <span className="text-sm font-medium truncate">{post.title}</span>
      </div>

      {/* Property rows — matches landing page mockup layout */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Status</span>
          {liveStatus ? (
            <span className="text-xs font-medium rounded-md px-3 py-0.5 bg-violet-500/15 text-violet-400 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
              </span>
              {liveStatus}
            </span>
          ) : (
            <span className={`text-xs font-medium rounded-md px-3 py-0.5 ${postStatusStyle[post.status] ?? "bg-muted text-muted-foreground"}`}>
              {post.status === "IMAGES_PROCESSING" ? "Processing" : post.status === "UPDATE_PENDING" ? "Updating" : post.status.charAt(0) + post.status.slice(1).toLowerCase()}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Category</span>
          <span className="text-xs text-foreground/70 bg-muted px-3 py-0.5 rounded-md">
            {post.category?.name ?? "Uncategorized"}
          </span>
        </div>
        {post.wpUrl && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">WordPress</span>
            <a
              href={post.wpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-400 hover:underline truncate max-w-[180px]"
            >
              {post.wpUrl.replace(/^https?:\/\//, "")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function OAuthResultHandler({ onSettingsUpdate }: { onSettingsUpdate: () => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const result = searchParams.get("notion_oauth");
    if (result) {
      if (result === "success") {
        toast.success("Notion connected successfully");
        capture("onboarding_step_completed", { step: "notion", method: "oauth" });
        capture("notion_connected", { method: "oauth" });
        onSettingsUpdate();
      } else {
        const reason = searchParams.get("reason")?.replace(/_/g, " ") ?? "unknown error";
        toast.error(`Notion connection failed: ${reason}`);
      }
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("notion_oauth");
    url.searchParams.delete("reason");
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, "", url.toString());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function SetupCard({
  settings,
  onUpdate,
  apiKey,
}: {
  settings: SettingsData;
  onUpdate: () => void;
  apiKey: string | null;
}) {
  const notion = settings.data.notion;
  const wordpress = settings.data.wordpress;
  const [templateDone, setTemplateDone] = useState(
    () => typeof window !== "undefined" && !!apiKey && localStorage.getItem("notipo_template_done") === apiKey,
  );

  function markTemplateDone() {
    if (apiKey) localStorage.setItem("notipo_template_done", apiKey);
    setTemplateDone(true);
    capture("onboarding_step_completed", { step: "template" });
  }

  const activeStep = !templateDone ? 1 : !notion.configured ? 2 : !wordpress.configured ? 3 : 0;

  const steps = [
    { n: 1, done: templateDone },
    { n: 2, done: notion.configured },
    { n: 3, done: wordpress.configured },
  ];

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Get Started</CardTitle>
        <CardDescription>
          Connect your services to start publishing from Notion to WordPress.
        </CardDescription>
        <div className="flex gap-1 mt-2">
          {steps.map(({ n, done }) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${
                done ? "bg-primary" : n === activeStep ? "bg-primary/40" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <SetupStepRow number={1} title="Duplicate Notion template" done={templateDone} active={activeStep === 1}>
          <TemplateStepContent onDone={markTemplateDone} />
        </SetupStepRow>
        <SetupStepRow number={2} title="Connect Notion" done={notion.configured} active={activeStep === 2}>
          <NotionStepContent cfg={notion} onDone={onUpdate} />
        </SetupStepRow>
        <SetupStepRow number={3} title="Connect WordPress" done={wordpress.configured} active={activeStep === 3}>
          <WordPressStepContent onDone={onUpdate} />
        </SetupStepRow>
      </CardContent>
    </Card>
  );
}

function SetupStepRow({
  number,
  title,
  done,
  active,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg ${active ? "bg-muted/40 p-3" : "py-2"}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
            done
              ? "bg-primary text-primary-foreground"
              : active
                ? "border-2 border-primary text-primary"
                : "border border-muted-foreground text-muted-foreground"
          }`}
        >
          {done ? "\u2713" : number}
        </span>
        <span className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
          {title}
        </span>
        {done && (
          <Badge variant="outline" className="ml-auto text-xs text-green-500 border-green-500/30">
            Done
          </Badge>
        )}
      </div>
      {active && <div className="mt-3 ml-9">{children}</div>}
    </div>
  );
}

function TemplateStepContent({ onDone }: { onDone: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Notipo uses a Notion database with specific properties (Status, Category, Tags, SEO Keyword, etc.)
        to sync and publish your posts. Duplicate our template into your workspace to get started.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <a
            href="https://free-dentist-6b2.notion.site/30d842af972f8091a104eb8773fbf390?v=30d842af972f803dab87000cdbd5d9b6"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open template
          </a>
        </Button>
        <Button size="sm" onClick={onDone}>
          I&apos;ve duplicated it
        </Button>
      </div>
    </div>
  );
}

function NotionStepContent({
  cfg,
  onDone,
}: {
  cfg: SettingsData["data"]["notion"];
  onDone: () => void;
}) {
  const { call } = useApiCall();
  const [showManual, setShowManual] = useState(!cfg.oauthAvailable);
  const [token, setToken] = useState("");
  const [dbId, setDbId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectOAuth() {
    const res = await call<{ data: { url: string } }>("/api/notion/oauth/authorize");
    window.location.href = res.data.url;
  }

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call("/api/settings/notion", {
        method: "PUT",
        body: { accessToken: token, databaseId: dbId || undefined },
      });
      capture("onboarding_step_completed", { step: "notion", method: "manual" });
      capture("notion_connected", { method: "manual" });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {cfg.oauthAvailable && (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed">
            When prompted, select the database you just duplicated to grant Notipo access.
          </p>
          <Button size="sm" onClick={connectOAuth}>
            Connect to Notion
          </Button>
        </>
      )}
      {cfg.oauthAvailable && (
        <button
          type="button"
          className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowManual((v) => !v)}
        >
          {showManual ? "Hide manual entry" : "Use manual token instead"}
        </button>
      )}
      {showManual && (
        <form onSubmit={saveManual} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Integration Token</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="secret_..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Database ID <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={dbId}
              onChange={(e) => setDbId(e.target.value)}
              placeholder="32-character Notion page ID"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}

function WordPressStepContent({
  onDone,
}: {
  onDone: () => void;
}) {
  const { call } = useApiCall();
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call("/api/settings/wordpress", {
        method: "PUT",
        body: { siteUrl, username, appPassword },
      });
      capture("onboarding_step_completed", { step: "wordpress" });
      capture("wordpress_connected");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Site URL</Label>
          <Input
            type="url"
            placeholder="https://yourblog.com"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Your WordPress admin username (found under Users in WP admin).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Application Password</Label>
          <Input
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            required
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          />
          <p className="text-xs text-muted-foreground">
            In WP admin, go to <strong>Users &rarr; Profile</strong>, scroll to
            &ldquo;Application Passwords&rdquo;, enter a name (e.g. &ldquo;Notipo&rdquo;)
            and click <strong>Add New Application Password</strong>.
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving..." : "Connect WordPress"}
        </Button>
      </form>
    </div>
  );
}

function SetupCompleteCard({
  onSyncNow,
  syncing,
  apiKey,
}: {
  onSyncNow: () => void;
  syncing: boolean;
  apiKey: string | null;
}) {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && !!apiKey && localStorage.getItem("notipo_setup_dismissed") === apiKey,
  );

  useEffect(() => {
    if (apiKey && localStorage.getItem("notipo_setup_complete_tracked") !== apiKey) {
      capture("onboarding_completed");
      localStorage.setItem("notipo_setup_complete_tracked", apiKey);
    }
  }, [apiKey]);

  if (dismissed) return null;

  function dismiss() {
    if (apiKey) localStorage.setItem("notipo_setup_dismissed", apiKey);
    setDismissed(true);
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-center justify-between gap-4 pt-6">
        <div>
          <p className="text-sm font-medium">You&apos;re all set!</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Change a post status in Notion to sync it, or press Sync Now.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            disabled={syncing}
            onClick={onSyncNow}
          >
            Sync Now
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss} className="text-muted-foreground">
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
