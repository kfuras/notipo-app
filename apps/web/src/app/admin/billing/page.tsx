"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApi, useApiCall } from "@/hooks/use-api";
import { capture } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Zap, Image, Radio, Loader2 } from "lucide-react";

interface BillingData {
  data: {
    plan: string;
    effectivePlan: string;
    trialEndsAt: string | null;
    trialDaysRemaining: number | null;
    postsUsedThisMonth: number;
    postsLimit: number | null;
    featuredImagesEnabled: boolean;
    webhooksEnabled: boolean;
    hasStripeCustomer: boolean;
    stripeConfigured: boolean;
  };
}

function PlanBadge({ plan, trialDaysRemaining }: { plan: string; trialDaysRemaining: number | null }) {
  if (plan === "TRIAL") {
    return (
      <Badge variant="secondary">
        Trial — {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""} left
      </Badge>
    );
  }
  if (plan === "PRO") {
    return <Badge className="bg-primary text-primary-foreground">Pro</Badge>;
  }
  return <Badge variant="outline">Free</Badge>;
}

export default function BillingPage() {
  const { call } = useApiCall();
  const { data: billing, loading, refetch } = useApi<BillingData>("/api/billing");
  const [actionLoading, setActionLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      toast.success("Upgrade successful! Welcome to Pro.");
      capture("checkout_completed");
      refetch();
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState({}, "", url.toString());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const b = billing?.data;

  const handleCheckout = () => {
    capture("upgrade_clicked", { current_plan: b?.plan });
    router.push("/admin/billing/checkout");
  };

  const handlePortal = async () => {
    setActionLoading(true);
    try {
      const res = await call<{ data: { url: string } }>("/api/billing/portal", {
        method: "POST",
      });
      window.location.href = res.data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal");
      setActionLoading(false);
    }
  };

  if (loading || !b) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const effectivePlan = b.effectivePlan;
  const isFree = effectivePlan === "FREE";
  const isPro = effectivePlan === "PRO" || effectivePlan === "TRIAL";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Billing</h1>
        <PlanBadge plan={b.plan} trialDaysRemaining={b.trialDaysRemaining} />
      </div>

      {/* Plan card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            {b.plan === "TRIAL" ? "Trial" : isPro ? "Pro Plan" : "Free Plan"}
          </CardTitle>
          <CardDescription>
            {b.plan === "TRIAL"
              ? `You have Pro features for ${b.trialDaysRemaining} more day${b.trialDaysRemaining !== 1 ? "s" : ""}. Upgrade to keep them.`
              : isPro
              ? "You have access to all features."
              : "Upgrade to Pro for unlimited posts, featured images, and instant sync."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {b.stripeConfigured && isFree && (
            <Button onClick={handleCheckout} disabled={actionLoading}>
              {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upgrade to Pro — $19/mo
            </Button>
          )}
          {b.stripeConfigured && b.plan === "TRIAL" && (
            <Button onClick={handleCheckout} disabled={actionLoading}>
              {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upgrade to Pro — $19/mo
            </Button>
          )}
          {b.stripeConfigured && b.plan === "PRO" && b.hasStripeCustomer && (
            <Button variant="outline" onClick={handlePortal} disabled={actionLoading}>
              {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Manage Subscription
            </Button>
          )}
          {!b.stripeConfigured && (
            <p className="text-sm text-muted-foreground">
              Billing is not configured yet. Contact the administrator.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Usage card */}
      <Card>
        <CardHeader>
          <CardTitle>Usage This Month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Posts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Posts synced</span>
            </div>
            <span className="text-sm font-medium">
              {b.postsUsedThisMonth}
              {b.postsLimit !== null ? ` / ${b.postsLimit}` : ""}
            </span>
          </div>
          {b.postsLimit !== null && (
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{ width: `${Math.min(100, (b.postsUsedThisMonth / b.postsLimit) * 100)}%` }}
              />
            </div>
          )}

          {/* Featured images */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Featured images</span>
            </div>
            <Badge variant={b.featuredImagesEnabled ? "default" : "outline"}>
              {b.featuredImagesEnabled ? "Enabled" : "Pro only"}
            </Badge>
          </div>

          {/* Webhooks / instant sync */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Webhooks & instant sync</span>
            </div>
            <Badge variant={b.webhooksEnabled ? "default" : "outline"}>
              {b.webhooksEnabled ? "Enabled" : "Pro only"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
