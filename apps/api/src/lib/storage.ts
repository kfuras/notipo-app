import { Storage } from "@google-cloud/storage";
import { config } from "../config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "storage" });

const PREFIX = "category-images";

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

function getBucket() {
  if (!config.GCS_BUCKET) {
    throw new Error("GCS_BUCKET environment variable is not configured");
  }
  return getStorage().bucket(config.GCS_BUCKET);
}

function objectKey(tenantId: string, filename: string): string {
  return `${PREFIX}/${tenantId}/${filename}`;
}

/** Store format: gcs:{tenantId}/{filename} */
export function toStorageRef(tenantId: string, filename: string): string {
  return `gcs:${tenantId}/${filename}`;
}

/** Parse a gcs: storage ref into the GCS object key. */
function refToKey(ref: string): string | null {
  if (!ref.startsWith("gcs:")) return null;
  return `${PREFIX}/${ref.slice("gcs:".length)}`;
}

export async function uploadFile(
  tenantId: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const key = objectKey(tenantId, filename);
  const file = getBucket().file(key);
  await file.save(buffer, { contentType, resumable: false });
  log.info({ tenantId, key }, "Uploaded file to GCS");
  return toStorageRef(tenantId, filename);
}

/** Download a file from GCS by its storage ref. Used by the featured image service. */
export async function downloadFile(ref: string): Promise<Buffer> {
  const key = refToKey(ref);
  if (!key) throw new Error(`Invalid storage ref: ${ref}`);
  const [buffer] = await getBucket().file(key).download();
  return buffer;
}

/** Generate a signed URL for frontend preview (1 hour expiry). */
export async function getSignedUrl(ref: string): Promise<string> {
  const key = refToKey(ref);
  if (!key) throw new Error(`Invalid storage ref: ${ref}`);
  const [url] = await getBucket().file(key).getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}

export async function deleteFile(ref: string): Promise<void> {
  const key = refToKey(ref);
  if (!key) return;
  try {
    await getBucket().file(key).delete();
    log.info({ key }, "Deleted file from GCS");
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 404) return;
    throw err;
  }
}

export async function deleteTenantFiles(tenantId: string): Promise<void> {
  const [files] = await getBucket().getFiles({ prefix: `${PREFIX}/${tenantId}/` });
  if (files.length === 0) return;
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  log.info({ tenantId, count: files.length }, "Deleted all tenant files from GCS");
}
