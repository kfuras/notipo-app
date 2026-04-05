import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

/** When Stripe is not configured, all features are unlocked (self-hosted mode). */
function isSelfHosted(): boolean {
  return !config.STRIPE_SECRET_KEY;
}

interface PlanLimits {
  postsPerMonth: number | null; // null = unlimited
  featuredImages: boolean;
  webhooks: boolean;
  pollIntervalSeconds: number;
}

const PLAN_CONFIG: Record<string, PlanLimits> = {
  FREE: {
    postsPerMonth: 5,
    featuredImages: false,
    webhooks: false,
    pollIntervalSeconds: 300, // 5 minutes
  },
  PRO: {
    postsPerMonth: null,
    featuredImages: true,
    webhooks: true,
    pollIntervalSeconds: 300, // 5 minutes
  },
  TRIAL: {
    postsPerMonth: null,
    featuredImages: true,
    webhooks: true,
    pollIntervalSeconds: 300, // same as Pro during trial
  },
};

/** Resolve the effective plan, accounting for trial expiry. */
export function getEffectivePlan(plan: string, trialEndsAt: Date | null): string {
  if (isSelfHosted()) return "PRO";
  if (plan === "TRIAL") {
    if (!trialEndsAt || new Date() > trialEndsAt) return "FREE";
    return "TRIAL";
  }
  return plan;
}

export function getPlanLimits(effectivePlan: string): PlanLimits {
  return PLAN_CONFIG[effectivePlan] ?? PLAN_CONFIG.FREE;
}

/** Count posts created in the current calendar month for a tenant. */
export async function getMonthlyPostCount(prisma: PrismaClient, tenantId: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return prisma.post.count({
    where: { tenantId, createdAt: { gte: startOfMonth } },
  });
}

/** Check if tenant can sync another post. */
export async function canSyncPost(
  prisma: PrismaClient,
  tenantId: string,
  plan: string,
  trialEndsAt: Date | null,
): Promise<{ allowed: boolean; reason?: string }> {
  const effective = getEffectivePlan(plan, trialEndsAt);
  const limits = getPlanLimits(effective);
  if (limits.postsPerMonth === null) return { allowed: true };

  const count = await getMonthlyPostCount(prisma, tenantId);
  if (count >= limits.postsPerMonth) {
    return {
      allowed: false,
      reason: `Monthly post limit reached (${count}/${limits.postsPerMonth}). Upgrade to Pro for unlimited posts.`,
    };
  }
  return { allowed: true };
}

export function canGenerateFeaturedImage(plan: string, trialEndsAt: Date | null): boolean {
  return getPlanLimits(getEffectivePlan(plan, trialEndsAt)).featuredImages;
}

export function canUseWebhooks(plan: string, trialEndsAt: Date | null): boolean {
  return getPlanLimits(getEffectivePlan(plan, trialEndsAt)).webhooks;
}

export function canImportFromWordPress(plan: string, trialEndsAt: Date | null): boolean {
  const effective = getEffectivePlan(plan, trialEndsAt);
  return effective === "PRO" || effective === "TRIAL";
}

export function getPollInterval(plan: string, trialEndsAt: Date | null): number {
  return getPlanLimits(getEffectivePlan(plan, trialEndsAt)).pollIntervalSeconds;
}
