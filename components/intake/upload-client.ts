/**
 * Browser-side upload flow for one file: sign → uploadToSignedUrl →
 * complete. Plain TypeScript (no React) so the workspace component stays
 * small and the flow can be reasoned about in one place.
 * File path: /components/intake/upload-client.ts
 *
 * The bytes go straight from the browser to Supabase Storage with the
 * signed upload url the server issued (route handlers never see file
 * bodies). Errors are UploadFlowError with a CODE from content.upload
 * .errors: the server's { error } codes pass through, transport failures
 * become "network", a Storage failure "upload_failed".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { IntakeResult } from "@/lib/parts/intake";
import type { UploadErrorCode } from "@/content/upload";
import { routes } from "@/lib/routes";

export type UploadStage = "signing" | "uploading" | "analysing";

export class UploadFlowError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly status?: number
  ) {
    super(`upload: ${code}`);
    this.name = "UploadFlowError";
  }
}

type SignResponse = { fileId: string; path: string; token: string; signedUrl: string; kind: "dxf" | "pdf" | "step" };

export type CompleteResponse = IntakeResult & { fileId: string };

const KNOWN_CODES = new Set<string>([
  "extension", "size", "dwg", "empty", "binary_dxf", "unknown_type", "type_mismatch",
  "invalid_body", "invalid_path", "not_uploaded", "conflict", "network", "upload_failed",
  "unauthenticated", "forbidden", "not_found", "locked", "invalid_id",
  "validation", "no_geometry", "no_rates", "bend_not_found", "no_bends", "nothing_to_apply", "no_pdf", "no_item", "generic",
]);

export function asErrorCode(value: unknown): UploadErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as UploadErrorCode) : "generic";
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new UploadFlowError("network");
  }
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    if (response.status === 401) throw new UploadFlowError("unauthenticated", 401);
    throw new UploadFlowError(asErrorCode(data?.error), response.status);
  }
  if (!data) throw new UploadFlowError("generic", response.status);
  return data as T;
}

export type UploadFlowInput = {
  quoteId: string;
  file: File;
  bucket: string;
  supabase: SupabaseClient<Database>;
  onStage: (stage: UploadStage) => void;
};

export async function uploadFileToQuote(input: UploadFlowInput): Promise<CompleteResponse> {
  input.onStage("signing");
  const ticket = await postJson<SignResponse>(routes.api.filesSign, {
    quoteId: input.quoteId,
    fileName: input.file.name,
    size: input.file.size,
  });

  input.onStage("uploading");
  const { error } = await input.supabase.storage
    .from(input.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, input.file, { upsert: false });
  if (error) throw new UploadFlowError("upload_failed");

  input.onStage("analysing");
  return postJson<CompleteResponse>(routes.api.filesComplete, {
    quoteId: input.quoteId,
    fileId: ticket.fileId,
    path: ticket.path,
    originalName: input.file.name,
    size: input.file.size,
  });
}
