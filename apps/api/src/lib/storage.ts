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
  if (useGcs()) {
    const key = `${PREFIX}/${tenantId}/${filename}`;
    const bucket = await getBucket();
    await bucket.file(key).save(buffer, { contentType, resumable: false });
    log.info({ tenantId, key }, "Uploaded file to GCS");
    return `gcs:${tenantId}/${filename}`;
  }

  // Local filesystem fallback
  const dir = path.join(UPLOADS_DIR, tenantId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
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
