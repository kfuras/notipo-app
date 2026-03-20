import { z } from "zod";
import "dotenv/config";

/** Treat empty strings as undefined so blank .env values don't fail validation */
const emptyToUndefined = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const emptyToUndefinedUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);
const emptyToUndefinedEmail = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().email().optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(64),
  API_KEY: z.string().min(8),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NOTION_WEBHOOK_SECRET: emptyToUndefined,
  NOTION_OAUTH_CLIENT_ID: emptyToUndefined,
  NOTION_OAUTH_CLIENT_SECRET: emptyToUndefined,
  NOTION_OAUTH_REDIRECT_URI: emptyToUndefinedUrl,
  ALLOW_SIGNUP: z.string().default("false").transform((v) => v === "true"),
  POLL_INTERVAL_SECONDS: z.coerce.number().default(300),
  STRIPE_SECRET_KEY: emptyToUndefined,
  STRIPE_PUBLISHABLE_KEY: emptyToUndefined,
  STRIPE_WEBHOOK_SECRET: emptyToUndefined,
  STRIPE_PRO_PRICE_ID: emptyToUndefined,
  RESEND_API_KEY: emptyToUndefined,
  RESEND_FROM_EMAIL: emptyToUndefined,
  ADMIN_NOTIFY_EMAIL: emptyToUndefinedEmail,
  FRONTEND_URL: emptyToUndefinedUrl,
  UNSPLASH_ACCESS_KEY: emptyToUndefined,
  GEMINI_API_KEY: emptyToUndefined,
  GCS_BUCKET: emptyToUndefined,
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
