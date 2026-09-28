/**
 * Browser-side upload flow for one file: sign → upload to Storage →
 * complete, plus the follow-up after a timeout (status polling, resume).
 * Plain TypeScript (no React) so the workspace component stays small and
 * the flow is unit-tested with a fake fetch (test/intake/upload-client.test.ts).
 * File path: /components/intake/upload-client.ts
 *
 * The bytes go straight from the browser to Supabase Storage with the
 * signed upload ticket the server issued (route handlers never see file
 * bodies). Files up to RESUMABLE_THRESHOLD_BYTES use uploadToSignedUrl
 * (one request); larger ones go through Storage's resumable (TUS)
 * endpoint with the SAME ticket — the token goes in the `x-signature`
 * header (Supabase docs, "Resumable uploads → Presigned uploads") — in
 * TUS_CHUNK_BYTES chunks, which is what gives the `uploading` stage its
 * progress and survives a dropped connection (the offset is re-read with
 * HEAD and the upload continues). tus-js-client is not a dependency of
 * this project, so the few requests of the protocol are done with fetch
 * here (POST create with Upload-Length / Upload-Metadata, PATCH chunks
 * with Upload-Offset, HEAD to resync).
 *
 * Errors are UploadFlowError with a CODE from content.upload.errors: the
 * server's { error } codes pass through, transport failures become
 * "network", a Storage failure "upload_failed". A complete request that
 * ends without JSON (the platform's 504 page when the intake outlives the
 * function) becomes "analysis_timeout" carrying the file id: the intake
 * may still be running, so the workspace polls GET /api/files/[id]/status
 * and finishes with POST /api/files/[id]/resume-intake.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IntakeStatusDb } from "@/lib/db/types";
import type { IntakeResult } from "@/lib/parts/intake";
import type { UploadErrorCode } from "@/content/upload";
import { routes } from "@/lib/routes";

export type UploadStage = "signing" | "uploading" | "analysing";

/** Files above this go through the resumable endpoint (Supabase's own recommendation: > 6 MB). */
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;
/** Chunk size the Supabase TUS endpoint requires ("it must be set to 6MB"). */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const TUS_VERSION = "1.0.0";
const TUS_RETRIES = 3;

export class UploadFlowError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly status?: number,
    /** Set when the server already has the upload (the complete request timed out). */
    public readonly fileId?: string
  ) {
    super(`upload: ${code}`);
    this.name = "UploadFlowError";
  }
}

type SignResponse = { fileId: string; path: string; token: string; signedUrl: string; kind: "dxf" | "pdf" | "step" | "ifc" };

export type CompleteResponse = IntakeResult & { fileId: string };

export type FileStatus = {
  intakeStatus: IntakeStatusDb | null;
  partsExpected: number | null;
  partsDone: number | null;
  intakeError: string | null;
};

const KNOWN_CODES = new Set<string>([
  "extension", "size", "dwg", "empty", "binary_dxf", "unknown_type", "type_mismatch",
  "invalid_body", "invalid_path", "not_uploaded", "conflict", "network", "upload_failed", "analysis_timeout", "intake_done",
  "unauthenticated", "forbidden", "not_found", "locked", "invalid_id",
  "validation", "no_geometry", "no_rates", "bend_not_found", "no_bends", "nothing_to_apply", "no_pdf", "no_item", "generic",
]);

export function asErrorCode(value: unknown): UploadErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as UploadErrorCode) : "generic";
}

type Fetch = typeof fetch;

async function requestJson<T>(url: string, init: RequestInit, fetchImpl: Fetch, onNoJson: (status: number) => UploadFlowError): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new UploadFlowError("network");
  }
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    if (response.status === 401) throw new UploadFlowError("unauthenticated", 401);
    if (!data) throw onNoJson(response.status);
    throw new UploadFlowError(asErrorCode(data.error), response.status);
  }
  if (!data) throw onNoJson(response.status);
  return data as T;
}

function postJson<T>(url: string, body: unknown, fetchImpl: Fetch = fetch, onNoJson?: (status: number) => UploadFlowError): Promise<T> {
  return requestJson<T>(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    fetchImpl,
    onNoJson ?? ((status) => new UploadFlowError("generic", status))
  );
}

/* ─── Resumable (TUS) upload ─────────────────────────────────────── */

export type ResumableUploadOptions = {
  /** The TUS creation endpoint (…/storage/v1/upload/resumable). */
  endpoint: string;
  /** apikey + x-signature (the signed upload token). */
  headers: Record<string, string>;
  metadata: Record<string, string>;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  fetch?: Fetch;
  chunkBytes?: number;
};

/** TUS Upload-Metadata: `key base64(value)` pairs, comma separated. */
export function encodeTusMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(value)))}`)
    .join(",");
}

async function tusFetch(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new UploadFlowError("network");
  }
}

/**
 * Uploads `file` through the TUS protocol: one POST creating the upload
 * (Location = the upload url, valid 24 h on Supabase), then PATCH per
 * chunk with the current offset. A failed chunk is retried after re-reading
 * the server's offset with HEAD (TUS_RETRIES times), so a dropped
 * connection continues instead of starting over.
 */
export async function uploadResumable(file: Blob, options: ResumableUploadOptions): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const chunkBytes = options.chunkBytes ?? TUS_CHUNK_BYTES;
  const base = { "Tus-Resumable": TUS_VERSION, ...options.headers };

  const created = await tusFetch(fetchImpl, options.endpoint, {
    method: "POST",
    headers: {
      ...base,
      "Upload-Length": String(file.size),
      "Upload-Metadata": encodeTusMetadata(options.metadata),
    },
  });
  const location = created.headers.get("Location");
  if (!created.ok || !location) throw new UploadFlowError("upload_failed", created.status);
  const uploadUrl = new URL(location, options.endpoint).toString();

  let offset = 0;
  let retries = 0;
  options.onProgress?.(0, file.size);
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkBytes));
    let response: Response | null = null;
    try {
      response = await tusFetch(fetchImpl, uploadUrl, {
        method: "PATCH",
        headers: { ...base, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
        body: chunk,
      });
    } catch (error) {
      if (!(error instanceof UploadFlowError) || error.code !== "network") throw error;
    }
    if (response && response.ok) {
      const next = Number(response.headers.get("Upload-Offset"));
      offset = Number.isFinite(next) && next > 0 ? next : offset + chunk.size;
      options.onProgress?.(offset, file.size);
      retries = 0;
      continue;
    }
    // Network failure or an offset conflict (409): resync from the server.
    if (response && response.status !== 409 && response.status < 500) throw new UploadFlowError("upload_failed", response.status);
    if (++retries > TUS_RETRIES) throw new UploadFlowError(response ? "upload_failed" : "network", response?.status);
    const head = await tusFetch(fetchImpl, uploadUrl, { method: "HEAD", headers: base });
    if (!head.ok) throw new UploadFlowError("upload_failed", head.status);
    const known = Number(head.headers.get("Upload-Offset"));
    offset = Number.isFinite(known) && known >= 0 ? known : offset;
  }
}

/** The project's TUS endpoint for a Supabase url (…/storage/v1/upload/resumable). */
export function resumableEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
}

/* ─── The flow ───────────────────────────────────────────────────── */

export type UploadFlowInput = {
  quoteId: string;
  file: File;
  bucket: string;
  supabase: SupabaseClient<Database>;
  /** Project url + anon key for the resumable endpoint (files above the threshold). */
  supabaseUrl: string;
  supabaseKey: string;
  onStage: (stage: UploadStage) => void;
  /** Bytes sent so far during `uploading` (resumable uploads only). */
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
  fetch?: Fetch;
};

function timeoutError(fileId: string) {
  return (status: number) => new UploadFlowError("analysis_timeout", status, fileId);
}

export async function uploadFileToQuote(input: UploadFlowInput): Promise<CompleteResponse> {
  const fetchImpl = input.fetch ?? fetch;
  input.onStage("signing");
  const ticket = await postJson<SignResponse>(
    routes.api.filesSign,
    { quoteId: input.quoteId, fileName: input.file.name, size: input.file.size },
    fetchImpl
  );

  input.onStage("uploading");
  if (input.file.size > RESUMABLE_THRESHOLD_BYTES) {
    await uploadResumable(input.file, {
      endpoint: resumableEndpoint(input.supabaseUrl),
      headers: { apikey: input.supabaseKey, "x-signature": ticket.token },
      metadata: {
        bucketName: input.bucket,
        objectName: ticket.path,
        contentType: input.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onProgress: input.onUploadProgress,
      fetch: fetchImpl,
    });
  } else {
    const { error } = await input.supabase.storage
      .from(input.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, input.file, { upsert: false });
    if (error) throw new UploadFlowError("upload_failed");
  }

  input.onStage("analysing");
  return postJson<CompleteResponse>(
    routes.api.filesComplete,
    { quoteId: input.quoteId, fileId: ticket.fileId, path: ticket.path, originalName: input.file.name, size: input.file.size },
    fetchImpl,
    timeoutError(ticket.fileId)
  );
}

/** Finishes the intake of an upload the server already has (parts stored earlier are kept). */
export function resumeIntakeRequest(fileId: string, fetchImpl: Fetch = fetch): Promise<CompleteResponse> {
  return postJson<CompleteResponse>(routes.api.fileResumeIntake(fileId), {}, fetchImpl, timeoutError(fileId));
}

export function fetchFileStatus(fileId: string, fetchImpl: Fetch = fetch): Promise<FileStatus> {
  return requestJson<FileStatus>(routes.api.fileStatus(fileId), { method: "GET" }, fetchImpl, (status) => new UploadFlowError("generic", status));
}

export type PollOptions = {
  onProgress?: (status: FileStatus) => void;
  timeoutMs?: number;
  intervalMs?: number;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls the intake status until it leaves `processing` (or the file row has
 * no status yet) — resolves with the last status, `null` when the time is up.
 */
export async function pollIntakeStatus(fileId: string, options: PollOptions = {}): Promise<FileStatus | null> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await fetchFileStatus(fileId, options.fetch);
    options.onProgress?.(status);
    if (status.intakeStatus !== null && status.intakeStatus !== "processing") return status;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
