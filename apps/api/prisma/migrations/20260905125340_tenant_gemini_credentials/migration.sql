-- The tenant's own Google Gemini API key, encrypted with the same AES-256-GCM
-- envelope as the Notion and WordPress credentials beside it.
--
-- AI-generated featured images are billed to whoever owns the key. Gemini only
-- sells prepaid accounts, so the hosted service cannot offer a shared one; a
-- blog that wants AI images brings its own. Self-hosted installs keep falling
-- back to GEMINI_API_KEY, where the operator and the tenant are the same person.
ALTER TABLE "tenants" ADD COLUMN "geminiCredentials" TEXT;
