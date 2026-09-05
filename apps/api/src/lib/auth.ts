import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { config } from "../config.js";
import { isStripeConfigured } from "./stripe.js";

const TRIAL_DAYS = 7;

const BASE_URL = process.env.BETTER_AUTH_URL || "https://app.notipo.com";

/**
 * better-auth handles HUMAN/web access (sessions + email/password + Google).
 * Programmatic access (CLI/MCP) keeps the `x-api-key` model — see plugins/auth.ts.
 *
 * Model-name overrides: Notipo already has a per-tenant `User` (table `users`)
 * that is being retired via the data migration. To keep the app building while
 * both coexist, better-auth's own tables use distinct names (`authUser` etc.).
 * A blog is an "organization" → mapped onto the existing `tenants` table.
 */
/** The blog name is free text from the signup form and lands in an HTML email. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "blog"}-${randomBytes(4).toString("hex")}`;
}

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          mapProfileToUser: (profile: { name?: string; email?: string }) => ({
            name: profile.name?.trim() || profile.email || "",
          }),
        },
      }
    : {};

export const auth = betterAuth({
  appName: "Notipo",
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.BETTER_AUTH_URL || "https://app.notipo.com"],
  // Behind Fly's proxy request.ip is the edge IP; resolve the real client IP so
  // rate limiting buckets per-user instead of collapsing everyone into one.
  advanced: {
    ipAddress: { ipAddressHeaders: ["fly-client-ip", "x-forwarded-for"] },
  },
  // Throttle credential endpoints (brute-force / signup abuse). In-memory store
  // is per-machine; acceptable for the current 2-machine setup.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 300, max: 5 },
      "/request-password-reset": { window: 300, max: 5 },
    },
  },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Honor ALLOW_SIGNUP server-side, not just in the UI hint. Prod sets it true.
    disableSignUp: !config.ALLOW_SIGNUP,
    requireEmailVerification: false,
    autoSignIn: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Reset your Notipo password",
        `<p>Click to set a new password:</p><p><a href="${url}">${url}</a></p>`,
      );
    },
    resetPasswordTokenExpiresIn: 60 * 60,
  },
  socialProviders: { ...google },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your email — Notipo",
        `<p>Confirm your email for Notipo:</p><p><a href="${url}">${url}</a></p>`,
      );
    },
  },
  user: {
    modelName: "authUser",
    additionalFields: {
      // Name of the blog to create on signup.
      blogName: { type: "string", required: false, input: true },
    },
  },
  session: { modelName: "authSession" },
  account: {
    modelName: "authAccount",
    // Let Google sign-in link to a pre-existing account with the same verified
    // email — required so migrated users (created without a password) can sign
    // in with Google and land on their existing blog rather than a new one.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  verification: { modelName: "verification" },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const blogName = (user as { blogName?: string }).blogName || "My blog";
          try {
            const org = await auth.api.createOrganization({
              body: { name: blogName, slug: slugify(blogName), userId: user.id },
            });
            if (!org?.id) throw new Error("createOrganization returned no organization id");

            // Start the billing trial (mirrors the retired register route): with
            // Stripe configured, a 7-day trial; self-hosted stays PRO. Without
            // this, the tenant default (plan=TRIAL, trialEndsAt=null) resolves to
            // FREE immediately — see getEffectivePlan.
            const usesTrial = isStripeConfigured();
            await prisma.tenant.update({
              where: { id: org.id },
              data: usesTrial
                ? { plan: "TRIAL", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000) }
                : { plan: "PRO" },
            });
            // Give the new blog a default API key so CLI/MCP work immediately.
            await prisma.apiKey.create({
              data: {
                key: `ntp_${randomBytes(32).toString("hex")}`,
                tenantId: org.id,
                userId: user.id,
                name: "Default",
              },
            });
          } catch (err) {
            // Provisioning failed after the authUser row was committed. Delete the
            // orphaned user so signup stays RETRYABLE — otherwise the account is
            // permanently locked out (every request 401s "No blog is set up", and
            // re-signup fails with "email already exists"). Rethrow so signup
            // reports failure instead of a false success.
            await prisma.authUser.delete({ where: { id: user.id } }).catch(() => {});
            throw err;
          }

          // Tell the operator someone signed up. Deliberately outside the block
          // above: that one deletes the user and rethrows when provisioning
          // fails, and a bounced notification must never reach that path — a
          // signup is not worth losing over an email. sendEmail resolves false
          // rather than throwing, and the catch guards against that changing.
          if (config.ADMIN_NOTIFY_EMAIL) {
            void sendEmail(
              config.ADMIN_NOTIFY_EMAIL,
              `New signup: ${user.email}`,
              `<p>A new blog was created on Notipo.</p><ul>` +
                `<li>Email: ${escapeHtml(user.email)}</li>` +
                `<li>Blog: ${escapeHtml(blogName)}</li>` +
                `</ul>` +
                `<p>Open the admin panel to see the account.</p>`,
              `A new blog was created on Notipo.\n\n` +
                `Email: ${user.email}\nBlog: ${blogName}\n\n` +
                `Open the admin panel to see the account.`,
            ).catch(() => {});
          }
        },
      },
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      schema: {
        organization: { modelName: "tenant" },
        member: { modelName: "member" },
        invitation: { modelName: "invitation" },
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
