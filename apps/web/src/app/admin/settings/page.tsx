"use client";

import { useState } from "react";
import { useApi, useApiCall } from "@/hooks/use-api";
import { capture } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface SettingsData {
  data: {
    notion: {
      configured: boolean;
      authMode: string;
      oauthAvailable: boolean;
      workspaceId: string | null;
      databaseId: string | null;
      triggerStatus: string | null;
      publishTriggerStatus: string | null;
      updateTriggerStatus: string | null;
    };
    wordpress: {
      configured: boolean;
      siteUrl: string | null;
    };
    codeHighlighter: string;
    featuredImageMode: string;
    aiImageStyle: string | null;
    geminiAvailable: boolean;
    webhookUrl: string | null;
    effectivePlan: string;
  };
}

export default function SettingsPage() {
  const { data: settings, refetch } = useApi<SettingsData>("/api/settings");
  const cfg = settings?.data;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {cfg && (
        <>
          <NotionCard cfg={cfg.notion} onUpdate={refetch} />
          <WordPressCard cfg={cfg.wordpress} onUpdate={refetch} />
          <CodeHighlighterCard current={cfg.codeHighlighter} onUpdate={refetch} />
          <FeaturedImageCard
            mode={cfg.featuredImageMode}
            style={cfg.aiImageStyle}
            geminiAvailable={cfg.geminiAvailable}
            isPro={cfg.effectivePlan === "PRO"}
            onUpdate={refetch}
          />
          <WebhookCard current={cfg.webhookUrl} onUpdate={refetch} />
        </>
      )}
    </div>
  );
}

function NotionCard({
  cfg,
  onUpdate,
}: {
  cfg: SettingsData["data"]["notion"];
  onUpdate: () => void;
}) {
  const { call } = useApiCall();
  const [showManual, setShowManual] = useState(false);
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
      capture("settings_notion_updated", { method: "manual" });
      setToken("");
      setDbId("");
      setShowManual(false);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function disconnect() {
    await call("/api/settings/notion", { method: "DELETE" });
    capture("notion_disconnected");
    setConfirmDisconnect(false);
    onUpdate();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Notion</CardTitle>
            <CardDescription>
              {cfg.configured
                ? `Connected via ${cfg.authMode}`
                : "Not connected"}
            </CardDescription>
          </div>
          <Badge variant={cfg.configured ? "default" : "secondary"}>
            {cfg.configured ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cfg.configured ? (
          <>
            {cfg.databaseId && (
              <div className="text-sm">
                <span className="text-muted-foreground">Database ID: </span>
                <code className="text-xs">{cfg.databaseId}</code>
              </div>
            )}
            {confirmDisconnect ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Disconnect Notion?</span>
                <Button variant="destructive" size="sm" onClick={disconnect}>Yes</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {cfg.oauthAvailable && (
              <Button onClick={connectOAuth}>Connect to Notion</Button>
            )}
            <Separator />
            {showManual ? (
              <form onSubmit={saveManual} className="space-y-3">
                <div className="space-y-2">
                  <Label>Integration Token</Label>
                  <Input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Database ID</Label>
                  <Input
                    value={dbId}
                    onChange={(e) => setDbId(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManual(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowManual(true)}>
                Use manual token
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WordPressCard({
  cfg,
  onUpdate,
}: {
  cfg: SettingsData["data"]["wordpress"];
  onUpdate: () => void;
}) {
  const { call } = useApiCall();
  const [editing, setEditing] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function connectOneClick(e: React.FormEvent) {
    e.preventDefault();
    let parsed: URL;
    try { parsed = new URL(siteUrl.replace(/\/+$/, "")); } catch { return; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    const callbackUrl = `${window.location.origin}/admin`;
    const wpAuthUrl = `${parsed.origin}/wp-admin/authorize-application.php?app_name=Notipo&success_url=${encodeURIComponent(callbackUrl)}`;
    window.location.href = wpAuthUrl;
  }

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call("/api/settings/wordpress", {
        method: "PUT",
        body: { siteUrl, username, appPassword },
      });
      capture("settings_wordpress_updated");
      setEditing(false);
      setShowManual(false);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function disconnect() {
    await call("/api/settings/wordpress", { method: "DELETE" });
    capture("wordpress_disconnected");
    setConfirmDisconnect(false);
    onUpdate();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">WordPress</CardTitle>
            <CardDescription>
              {cfg.configured ? cfg.siteUrl : "Not connected"}
            </CardDescription>
          </div>
          <Badge variant={cfg.configured ? "default" : "secondary"}>
            {cfg.configured ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {cfg.configured && !editing ? (
          confirmDisconnect ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Disconnect WordPress?</span>
              <Button variant="destructive" size="sm" onClick={disconnect}>Yes</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Update
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <form onSubmit={connectOneClick} className="space-y-3">
              <div className="space-y-2">
                <Label>Site URL</Label>
                <Input
                  type="url"
                  placeholder="https://yourblog.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You&apos;ll be redirected to your WordPress admin to approve the connection.
              </p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!siteUrl.trim()}>
                  Connect WordPress
                </Button>
                {cfg.configured && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>

            <button
              type="button"
              className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Hide manual entry" : "Enter credentials manually"}
            </button>

            {showManual && (
              <form onSubmit={saveManual} className="space-y-3">
                <div className="space-y-2">
                  <Label>Site URL</Label>
                  <Input
                    type="url"
                    placeholder="https://yourblog.com"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Application Password</Label>
                  <Input
                    type="password"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  {cfg.configured && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setShowManual(false); }}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CodeHighlighterCard({
  current,
  onUpdate,
}: {
  current: string;
  onUpdate: () => void;
}) {
  const { call } = useApiCall();
  const options = [
    { value: "WP_CODE", label: "WordPress Code Block" },
    { value: "HIGHLIGHT_JS", label: "Highlight.js" },
    { value: "PRISM_JS", label: "Prism.js" },
    { value: "PRISMATIC", label: "Prismatic" },
  ];

  async function change(value: string) {
    await call("/api/settings", {
      method: "PATCH",
      body: { codeHighlighter: value },
    });
    capture("settings_code_highlighter_changed", { value });
    onUpdate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Code Highlighter</CardTitle>
        <CardDescription>
          How code blocks are formatted in WordPress
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <Button
              key={opt.value}
              variant={current === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => change(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const AI_IMAGE_STYLES = [
  { value: "comic book", label: "Comic Book" },
  { value: "watercolor", label: "Watercolor" },
  { value: "3D render", label: "3D Render" },
  { value: "minimalist", label: "Minimalist" },
  { value: "photorealistic", label: "Photorealistic" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "retro", label: "Retro" },
];

function FeaturedImageCard({
  mode,
  style,
  geminiAvailable,
  isPro,
  onUpdate,
}: {
  mode: string;
  style: string | null;
  geminiAvailable: boolean;
  isPro: boolean;
  onUpdate: () => void;
}) {
  const { call } = useApiCall();
  const [selectedStyle, setSelectedStyle] = useState(style ?? "minimalist");

  async function setMode(value: string) {
    await call("/api/settings", {
      method: "PATCH",
      body: {
        featuredImageMode: value,
        ...(value === "AI_GENERATED" && { aiImageStyle: selectedStyle }),
      },
    });
    onUpdate();
  }

  async function changeStyle(value: string) {
    setSelectedStyle(value);
    if (mode === "AI_GENERATED") {
      await call("/api/settings", {
        method: "PATCH",
        body: { aiImageStyle: value },
      });
      onUpdate();
    }
  }

  const canUseAi = geminiAvailable && isPro;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Featured Images</CardTitle>
        <CardDescription>
          How featured images are generated for new posts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "STANDARD" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("STANDARD")}
          >
            Standard
          </Button>
          <Button
            variant={mode === "AI_GENERATED" ? "default" : "outline"}
            size="sm"
            disabled={!canUseAi}
            onClick={() => setMode("AI_GENERATED")}
          >
            AI Generated
          </Button>
        </div>

        {!geminiAvailable && (
          <p className="text-xs text-muted-foreground">
            AI image generation requires a Gemini API key to be configured.
          </p>
        )}
        {geminiAvailable && !isPro && (
          <p className="text-xs text-muted-foreground">
            AI image generation is available on the Pro plan.
          </p>
        )}

        {canUseAi && (
          <div className="space-y-2">
            <Label>AI Image Style</Label>
            <div className="flex flex-wrap gap-2">
              {AI_IMAGE_STYLES.map((opt) => (
                <Button
                  key={opt.value}
                  variant={selectedStyle === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => changeStyle(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookCard({
  current,
  onUpdate,
}: {
  current: string | null;
  onUpdate: () => void;
}) {
  const { call } = useApiCall();
  const [url, setUrl] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await call("/api/settings", {
        method: "PATCH",
        body: { webhookUrl: url },
      });
      capture("settings_webhook_updated", { has_url: !!url });
      setSuccess("Saved");
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function testWebhook() {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      await call("/api/settings/test-webhook", { method: "POST" });
      setSuccess("Test message sent!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Webhook Notifications</CardTitle>
        <CardDescription>
          Get notified in Slack or Discord when a sync or publish fails.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <Input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => { setUrl(e.target.value); setSuccess(null); }}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-500">{success}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            {url && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing || !url}
                onClick={testWebhook}
              >
                {testing ? "Sending..." : "Test"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
