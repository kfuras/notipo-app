import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";

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
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
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
      // Name of the blog to create on signup (mirrors Klarbud's companyName).
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
          const org = await auth.api.createOrganization({
            body: { name: blogName, slug: slugify(blogName), userId: user.id },
          });
          // Give the new blog a default API key so CLI/MCP work immediately.
          if (org?.id) {
            await prisma.apiKey.create({
              data: {
                key: `ntp_${randomBytes(32).toString("hex")}`,
                tenantId: org.id,
                userId: user.id,
                name: "Default",
              },
            });
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
