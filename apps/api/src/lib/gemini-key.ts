/**
 * Which Gemini key an AI-generated featured image is billed to.
 *
 * The rule lives here alone so it cannot drift between the settings route that
 * validates it and the sync job that spends it.
 */

import type { PrismaClient } from "@prisma/client";
import { CredentialService } from "../services/credential.service.js";
import { isSelfHosted } from "./plan-limits.js";
import { config } from "../config.js";

/**
 * The tenant's own key if they have set one.
 *
 * Otherwise the instance key, but only when self-hosted — there the operator
 * and the tenant are the same person, and GEMINI_API_KEY is their own. On the
 * hosted service there is deliberately no fallback: Gemini bills a prepaid
 * account, so a shared key would mean every tenant's image generation is drawn
 * from ours. Returns null when no key applies, and the caller refuses.
 */
export async function resolveGeminiApiKey(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string | null> {
  const creds = await new CredentialService(prisma).getGeminiCredentials(tenantId);
  if (creds?.apiKey) return creds.apiKey;
  if (isSelfHosted() && config.GEMINI_API_KEY) return config.GEMINI_API_KEY;
  return null;
}
