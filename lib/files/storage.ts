/**
 * Storage glue for the private "quote-files" bucket — SERVER ONLY.
 * File path: /lib/files/storage.ts
 *
 * Browser uploads never pass through a route handler (Vercel's 4.5 MB
 * body limit): the sign route hands out a signed UPLOAD url (admin
 * client, createSignedUploadUrl) and the browser PUTs the bytes with
 * supabase-js uploadToSignedUrl; the complete route then downloads the
 * object server-side (admin client), sniffs it and hashes it. Read links
 * are 10-minute signed urls (SIGNED_URL_TTL_S) — the bucket is private
 * and never listed. The service key stays inside lib/supabase/admin.ts;
 * every caller of this module has already passed assertRole /
 * requireQuoteWriter.
 *
 * Object keys: quotes/<quoteId>/<fileId>/<safeName>, so a key encodes
 * which quote it belongs to (files rows carry no quote_id) and the
 * complete route can verify a client-supplied path belongs to the quote
 * and the ticket it was issued for. The prefix is a convention, not a
 * guarantee: files_insert and the storage insert policy only check
 * can_write(), so readers of "the files of quote X" must also check the
 * uploader may edit X (lib/parts/quote-editor.ts). Schema follow-up for
 * the migration owner: files.quote_id + RLS on can_edit_quote(quote_id),
 * storage insert limited to the signed-upload flow.
 */

import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { QUOTE_FILES_BUCKET } from "@/lib/env";
import type { FileKind, FileRow } from "@/lib/db/types";
import { safeFileName } from "@/lib/files/sniff";

/** Read links expire after 10 minutes (build prompt Step 12). */
export const SIGNED_URL_TTL_S = 600;

const PATH_RE = /^quotes\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,120})$/i;

export function storagePath(quoteId: string, fileId: string, safeName: string): string {
  return `quotes/${quoteId}/${fileId}/${safeName}`;
}

export function parseStoragePath(path: string): { quoteId: string; fileId: string; name: string } | null {
  const m = PATH_RE.exec(path);
  return m ? { quoteId: m[1].toLowerCase(), fileId: m[2].toLowerCase(), name: m[3] } : null;
}

export type UploadTicket = { fileId: string; path: string; token: string; signedUrl: string };

/** Signed upload url for one object; the browser uploads straight to Storage. */
export async function createUploadTicket(quoteId: string, fileName: string): Promise<UploadTicket> {
  const admin = createAdminClient();
  const fileId = randomUUID();
  const path = storagePath(quoteId, fileId, safeFileName(fileName));
  const { data, error } = await admin.storage.from(QUOTE_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message ?? "no data"}`);
  return { fileId, path: data.path, token: data.token, signedUrl: data.signedUrl };
}

export async function downloadFile(path: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(QUOTE_FILES_BUCKET).download(path);
  if (error || !data) throw new Error(`storage download failed for ${path}: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Short-lived read link (10 min by default). */
export async function signedReadUrl(path: string, expiresInS = SIGNED_URL_TTL_S): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(QUOTE_FILES_BUCKET).createSignedUrl(path, expiresInS);
  if (error || !data) throw new Error(`createSignedUrl failed for ${path}: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

/** Best-effort removal (rejected uploads); never throws. */
export async function removeFile(path: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.storage.from(QUOTE_FILES_BUCKET).remove([path]);
  } catch (error) {
    console.error("[files] remove failed", path, error);
  }
}

export function sha256(buffer: Uint8Array | Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export type InsertFileInput = {
  id: string;
  storagePath: string;
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
  kind: FileKind;
  uploadedBy: string;
};

/**
 * files row. The RLS policy (files_insert) requires can_write() and
 * uploaded_by = auth.uid(), so the user's client is the right one here;
 * the admin client works too (route handlers after assertRole).
 */
export async function insertFileRow(client: ServerSupabase | AdminSupabase, input: InsertFileInput): Promise<FileRow> {
  const { data, error } = await client
    .from("files")
    .insert({
      id: input.id,
      storage_path: input.storagePath,
      original_name: input.originalName,
      mime: input.mime,
      size: input.size,
      sha256: input.sha256,
      kind: input.kind,
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`files insert failed: ${error?.message ?? "no row"}`);
  return data;
}
