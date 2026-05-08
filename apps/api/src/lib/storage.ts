import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "storage" });

const PREFIX = "category-images";
const UPLOADS_DIR = path.join(process.cwd(), "uploads", PREFIX);

function useGcs(): boolean {
  return !!config.GCS_BUCKET;
}

/**
 * Reject any path component that could escape the intended directory.
 * tenantId is internally generated (cuid), but we still validate to make
 * the constraint explicit and to harden against future code paths that
 * might pass user-controlled values.
 */
function assertSafePathComponent(name: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new Error(`Invalid ${label}: must match [A-Za-z0-9._-]+ and not be . or ..`);
  }
}

// ── GCS helpers (lazy-loaded to avoid import error when not using GCS) ───────

let gcsStorage: import("@google-cloud/storage").Storage | null = null;

async function getGcsStorage() {
  if (!gcsStorage) {
    const { Storage } = await import("@google-cloud/storage");
    gcsStorage = new Storage();
  }
  return gcsStorage;
}

async function getBucket() {
  const storage = await getGcsStorage();
  return storage.bucket(config.GCS_BUCKET!);
}

// ── Unified storage API ──────────────────────────────────────────────────────

export async function uploadFile(
  tenantId: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  assertSafePathComponent(tenantId, "tenantId");
  assertSafePathComponent(filename, "filename");

  if (useGcs()) {
    const key = `${PREFIX}/${tenantId}/${filename}`;
    const bucket = await getBucket();
    await bucket.file(key).save(buffer, { contentType, resumable: false });
    log.info({ tenantId, key }, "Uploaded file to GCS");
    return `gcs:${tenantId}/${filename}`;
  }

  // Local filesystem fallback. After validation above, the resolution
  // prefix check keeps us inside UPLOADS_DIR even if a future attacker
  // bypasses the validator. Use the resolved path for the actual
  // write so the value being written equals the value we validated.
  const baseDir = path.resolve(UPLOADS_DIR);
  const dir = path.resolve(baseDir, tenantId);
  const target = path.resolve(dir, filename);
  if (!target.startsWith(baseDir + path.sep)) {
    throw new Error("Resolved upload path escapes UPLOADS_DIR");
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(target, buffer);
  log.info({ tenantId, filename }, "Uploaded file to local storage");
  return `upload:${tenantId}/${filename}`;
}

/** Download a file by its storage ref. Used by the featured image service. */
export async function downloadFile(ref: string): Promise<Buffer> {
  if (ref.startsWith("gcs:")) {
    const key = `${PREFIX}/${ref.slice("gcs:".length)}`;
    const bucket = await getBucket();
    const [buffer] = await bucket.file(key).download();
    return buffer;
  }
  if (ref.startsWith("upload:")) {
    const relPath = ref.slice("upload:".length);
    const filePath = path.resolve(UPLOADS_DIR, relPath);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
      throw new Error("Invalid storage path");
    }
    return fs.readFile(filePath);
  }
  throw new Error(`Unknown storage ref: ${ref}`);
}

/** Generate a preview URL. GCS uses signed URLs; local uses the static file path. */
export async function getPreviewUrl(ref: string): Promise<string | null> {
  if (ref.startsWith("gcs:")) {
    const key = `${PREFIX}/${ref.slice("gcs:".length)}`;
    const bucket = await getBucket();
    const [url] = await bucket.file(key).getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });
    return url;
  }
  if (ref.startsWith("upload:")) {
    const relPath = ref.slice("upload:".length);
    return `/api/uploads/category-images/${relPath}`;
  }
  return null;
}

export async function deleteFile(ref: string): Promise<void> {
  if (ref.startsWith("gcs:")) {
    const key = `${PREFIX}/${ref.slice("gcs:".length)}`;
    try {
      const bucket = await getBucket();
      await bucket.file(key).delete();
      log.info({ key }, "Deleted file from GCS");
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
    return;
  }
  if (ref.startsWith("upload:")) {
    const relPath = ref.slice("upload:".length);
    const filePath = path.resolve(UPLOADS_DIR, relPath);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) return;
    await fs.unlink(filePath).catch(() => {});
    log.info({ filePath }, "Deleted file from local storage");
  }
}

export async function deleteTenantFiles(tenantId: string): Promise<void> {
  if (useGcs()) {
    const bucket = await getBucket();
    const [files] = await bucket.getFiles({ prefix: `${PREFIX}/${tenantId}/` });
    if (files.length === 0) return;
    await Promise.all(files.map((f) => f.delete().catch(() => {})));
    log.info({ tenantId, count: files.length }, "Deleted all tenant files from GCS");
    return;
  }

  // Local filesystem fallback
  const dir = path.join(UPLOADS_DIR, tenantId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  log.info({ tenantId }, "Deleted tenant files from local storage");
}
