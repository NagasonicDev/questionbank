import type { Question } from "../api/types";
import { newId } from "./id";
import { getFirst, run } from "./db/sqlite";
import * as idb from "./db/indexeddb";

const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
const MAX_BYTES = 15 * 1024 * 1024;

// Registry of live object URLs keyed by asset_id (used synchronously by assetUrl).
const urlCache = new Map<string, string>();

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function mimeFromExtension(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

/**
 * Client-side stand-in for backend POST /uploads: validates like the REST
 * endpoint, then stores the blob in IndexedDB under a fresh asset_id and
 * registers an object URL immediately so editors can preview it.
 */
export async function uploadAsset(file: File): Promise<{
  asset_path: string;
  mime_type: string;
  original_filename: string;
}> {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported file type '${ext}'. Allowed: ${[...ALLOWED_EXTENSIONS].sort().join(", ")}`
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File too large (max 15 MB)");
  }
  const assetId = newId("asset");
  await idb.putAsset(assetId, file);
  registerUrl(assetId, file);
  return {
    asset_path: assetId,
    mime_type: file.type || mimeFromExtension(ext),
    original_filename: file.name,
  };
}

function registerUrl(assetId: string, blob: Blob): void {
  if (!urlCache.has(assetId)) {
    urlCache.set(assetId, URL.createObjectURL(blob));
  }
}

/** Synchronous lookup used by renderers (QuestionReader / BlockEditor). */
export function assetUrl(assetIdOrPath: string): string {
  return urlCache.get(assetIdOrPath) ?? "";
}

/** Load an asset's blob from IndexedDB and register its object URL. */
export async function ensureAssetUrl(assetId: string): Promise<string> {
  const cached = urlCache.get(assetId);
  if (cached) return cached;
  const blob = await idb.getAsset(assetId);
  if (!blob) return "";
  registerUrl(assetId, blob);
  return urlCache.get(assetId) ?? "";
}

/** Register every asset referenced by a question tree (question + parts). */
export async function registerQuestionAssets(question: Question): Promise<void> {
  const ids = new Set(question.assets.map((a) => a.asset_id));
  for (const part of question.parts) {
    for (const a of part.assets) ids.add(a.asset_id);
  }
  for (const id of ids) await ensureAssetUrl(id);
}

/**
 * The client-only twin of backend finalize_uploaded_assets: ensure every
 * image/diagram/graph block whose asset_path refers to a stored blob gets an
 * Asset row so the ownership record stays complete. Re-runs are no-ops.
 */
export async function finalizeQuestionAssets(
  questionId: string,
  rows: Array<{ slot: string; position: number; block_type: string; content_json: string }>
): Promise<void> {
  const IMAGE_TYPES = new Set(["image", "diagram", "graph"]);
  const seen = new Set<string>();
  const blobs = await idb.listAssetIds();
  const blobSet = new Set(blobs);
  for (const row of rows) {
    if (!IMAGE_TYPES.has(row.block_type)) continue;
    let content: any;
    try {
      content = JSON.parse(row.content_json);
    } catch {
      continue;
    }
    const path = content?.asset_path;
    if (typeof path !== "string" || !path || seen.has(path)) continue;
    seen.add(path);
    if (!blobSet.has(path)) continue;
    const existing = await getAssetRow(path);
    if (existing) continue;
    const blob = await idb.getAsset(path);
    const mime =
      blob?.type || mimeFromExtension(extensionOf(path)) || "application/octet-stream";
    await insertAsset(path, questionId, mime, content.alt_text ?? null, content.caption ?? null);
  }
}

async function getAssetRow(assetId: string): Promise<any> {
  return getFirst("SELECT asset_id FROM asset WHERE asset_id = ?", [assetId]);
}

async function insertAsset(
  assetId: string,
  questionId: string,
  mime: string,
  altText: string | null,
  caption: string | null
): Promise<void> {
  await run(
    `INSERT INTO asset (asset_id, question_id, file_path, mime_type, width, height, alt_text, caption, original_filename)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
    [assetId, questionId, assetId, mime, altText, caption]
  );
}

/** Remove an asset's blob + object URL (used on question delete). */
export async function deleteAssetBlob(assetId: string): Promise<void> {
  const url = urlCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(assetId);
  }
  await idb.deleteAsset(assetId);
}