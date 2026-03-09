import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../lib/email.js";
import { createToken, verifyToken } from "../lib/auth-token.js";
import { isStripeConfigured } from "../lib/stripe.js";

const log = logger.child({ route: "auth" });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  blogName: z.string().min(1).max(100),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function getBaseUrl(): string {
  return config.NOTION_OAUTH_REDIRECT_URI
    ? new URL(config.NOTION_OAUTH_REDIRECT_URI).origin
    : "https://notipo.com";
}

function verificationEmailHtml(verifyUrl: string): string {
  return `<p>Welcome to Notipo! Please verify your email address to get started.</p>
    <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px;">Verify Email</a></p>
    <p style="color:#888;font-size:13px;">Or copy this link: ${verifyUrl}</p>
    <p style="color:#888;font-size:13px;">This link expires in 24 hours.</p>`;
}

const authRateLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: "15 minutes" },
  },
};

const emailRateLimit = {
  config: {
    rateLimit: { max: 5, timeWindow: "15 minutes" },
  },
};

export async function authRoutes(app: FastifyInstance) {
  /** GET /api/auth/providers — what auth methods are available */
  app.get("/api/auth/providers", async () => {
    let signup = config.ALLOW_SIGNUP;
    // Always show signup if no tenants exist yet (first-run setup)
    if (!signup) {
      const tenantCount = await app.prisma.tenant.count();
      if (tenantCount === 0) signup = true;
    }
    return {
      data: {
        password: true,
        signup,
      },
    };
  });

  /** POST /api/auth/register — create a new tenant with email+password */
  app.post("/api/auth/register", authRateLimit, async (request, reply) => {
    if (!config.ALLOW_SIGNUP) {
      // Allow the very first registration even when signup is disabled (self-hosted setup)
      const tenantCount = await app.prisma.tenant.count();
      if (tenantCount > 0) {
        return reply.forbidden("Registration is disabled");
      }
    }

    const body = registerSchema.parse(request.body);

    // Check for existing password-auth user with this email
    const existing = await app.prisma.user.findFirst({
      where: { email: body.email, passwordHash: { not: null } },
    });
    if (existing) {
      return reply.conflict("An account with this email already exists");
    }

    // Generate unique slug
    let slug = slugify(body.blogName);
    if (!slug) slug = "blog";
    let suffix = 0;
    while (await app.prisma.tenant.findUnique({ where: { slug } })) {
      suffix++;
      slug = `${slugify(body.blogName) || "blog"}-${suffix}`;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const apiKey = randomBytes(32).toString("hex");

    // When Stripe is not configured (self-hosted), grant full Pro access.
    // When Stripe is configured (SaaS), start a 7-day trial.
    const usesTrial = isStripeConfigured();
    const trialEndsAt = usesTrial ? new Date() : null;
    if (trialEndsAt) trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const tenant = await app.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: body.blogName,
          slug,
          plan: usesTrial ? "TRIAL" : "PRO",
          trialEndsAt,
          users: {
            create: {
              email: body.email,
              name: body.name,
              role: "OWNER",
              apiKey,
              passwordHash,
              emailVerified: false,
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          users: {
            select: { id: true, email: true },
          },
        },
      });
      return t;
    });

    const user = tenant.users[0];
    log.info({ tenantId: tenant.id, email: body.email }, "New tenant registered");

    // Send verification email
    const token = createToken(user.id, "verify");
    const verifyUrl = `${getBaseUrl()}/auth/verify?token=${token}`;
    const emailSent = await sendEmail(body.email, "Verify your email — Notipo", verificationEmailHtml(verifyUrl));

    // Notify admin of new signup (fire-and-forget)
    if (config.ADMIN_NOTIFY_EMAIL) {
      sendEmail(
        config.ADMIN_NOTIFY_EMAIL,
        `New signup: ${body.blogName}`,
        `<p><strong>${body.name || body.email}</strong> (${body.email}) just registered with blog name <strong>${body.blogName}</strong>.</p>`,
      ).catch(() => {});
    }

    // If email is not configured, auto-verify and log the user in immediately
    if (!emailSent) {
      const verified = await app.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      });
      log.info({ userId: user.id }, "Email not configured — auto-verified user");
      return reply.code(201).send({
        data: {
          apiKey: verified.apiKey,
          user: { id: verified.id, email: verified.email, name: verified.name },
          tenant: verified.tenant,
        },
      });
    }

    return reply.code(201).send({
      message: "Check your email to verify your account.",
      needsVerification: true,
    });
  });

  /** POST /api/auth/login — verify email+password, return API key */
  app.post("/api/auth/login", authRateLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await app.prisma.user.findFirst({
      where: { email: body.email, passwordHash: { not: null } },
      select: {
        id: true,
        email: true,
        name: true,
        apiKey: true,
        passwordHash: true,
        emailVerified: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!user || !user.passwordHash) {
      return reply.unauthorized("Invalid email or password");
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return reply.unauthorized("Invalid email or password");
    }

    if (!user.emailVerified) {
      return reply.code(403).send({
        error: "Please verify your email before signing in.",
        needsVerification: true,
        email: user.email,
      });
    }

    return {
      data: {
        apiKey: user.apiKey,
        user: { id: user.id, email: user.email, name: user.name },
        tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
      },
    };
  });

  /** POST /api/auth/verify-email — verify email using token */
  app.post("/api/auth/verify-email", authRateLimit, async (request, reply) => {
    const { token } = verifyEmailSchema.parse(request.body);

    const result = verifyToken(token, "verify");
    if (!result) {
      return reply.badRequest("Invalid or expired verification link.");
    }

    const user = await app.prisma.user.update({
      where: { id: result.userId },
      data: { emailVerified: true },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });

    log.info({ userId: result.userId }, "Email verified");
    return {
      message: "Email verified successfully.",
      data: {
        apiKey: user.apiKey,
        user: { id: user.id, email: user.email, name: user.name },
        tenant: user.tenant,
      },
    };
  });

  /** POST /api/auth/resend-verification — resend verification email */
  app.post("/api/auth/resend-verification", emailRateLimit, async (request) => {
    const { email } = resendVerificationSchema.parse(request.body);

    const user = await app.prisma.user.findFirst({
      where: { email, passwordHash: { not: null }, emailVerified: false },
      select: { id: true },
    });

    if (user) {
      const token = createToken(user.id, "verify");
      const verifyUrl = `${getBaseUrl()}/auth/verify?token=${token}`;
      await sendEmail(email, "Verify your email — Notipo", verificationEmailHtml(verifyUrl));
      log.info({ email }, "Verification email resent");
    }

    // Always return success to prevent email enumeration
    return { message: "If that email exists and is unverified, a verification link has been sent." };
  });

  /** POST /api/auth/forgot-password — request a password reset email */
  app.post("/api/auth/forgot-password", emailRateLimit, async (request) => {
    const { email } = forgotPasswordSchema.parse(request.body);

    const user = await app.prisma.user.findFirst({
      where: { email, passwordHash: { not: null } },
      select: { id: true },
    });

    if (user) {
      const token = createToken(user.id, "reset");
      const resetUrl = `${getBaseUrl()}/auth/reset?token=${token}`;

      await sendEmail(
        email,
        "Reset your password — Notipo",
        `<p>You requested a password reset.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
        <p style="color:#888;font-size:13px;">Or copy this link: ${resetUrl}</p>
        <p style="color:#888;font-size:13px;">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>`,
      );

      log.info({ email }, "Password reset email sent");
    }

    // Always return success to prevent email enumeration
    return { message: "If that email exists, a reset link has been sent." };
  });

  /** POST /api/auth/reset-password — set a new password using a reset token */
  app.post("/api/auth/reset-password", authRateLimit, async (request, reply) => {
    const { token, password } = resetPasswordSchema.parse(request.body);

    const result = verifyToken(token, "reset");
    if (!result) {
      return reply.badRequest("Invalid or expired reset link. Please request a new one.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await app.prisma.user.update({
      where: { id: result.userId },
      data: { passwordHash },
    });

    log.info({ userId: result.userId }, "Password reset completed");
    return { message: "Password has been reset." };
  });
}
