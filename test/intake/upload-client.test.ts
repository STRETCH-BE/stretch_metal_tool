/**
 * Browser upload flow (components/intake/upload-client.ts) against a fake
 * fetch: a 504 / HTML answer of the complete request during `analysing`
 * becomes "analysis_timeout" with the file id; the resumable (TUS) upload
 * creates the upload with the signed token in x-signature and sends
 * 6 MB chunks with the right offsets, resyncing with HEAD after a dropped
 * chunk; status polling stops when the intake leaves `processing`.
 * File path: /test/intake/upload-client.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  encodeTusMetadata,
  pollIntakeStatus,
  resumableEndpoint,
  resumeIntakeRequest,
  RESUMABLE_THRESHOLD_BYTES,
  TUS_CHUNK_BYTES,
  uploadFileToQuote,
  uploadResumable,
  UploadFlowError,
} from "@/components/intake/upload-client";
import { routes } from "@/lib/routes";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const FILE_ID = "22222222-2222-4222-8222-222222222222";
const QUOTE = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeSupabase(upload: () => Promise<{ error: null | { message: string } }>): SupabaseClient<Database> {
  return { storage: { from: () => ({ uploadToSignedUrl: upload }) } } as unknown as SupabaseClient<Database>;
}

function smallFile(): File {
  return new File([new Uint8Array(1024)], "part.dxf", { type: "application/dxf" });
}

describe("uploadFileToQuote — complete request cut off", () => {
  it.each([
    ["504 HTML page", () => new Response("<html>504 Gateway Time-out</html>", { status: 504, headers: { "Content-Type": "text/html" } })],
    ["200 without JSON", () => new Response("", { status: 200 })],
  ])("%s during analysing → analysis_timeout with the file id", async (_label, complete) => {
    const stages: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === routes.api.filesSign) return json({ fileId: FILE_ID, path: `quotes/${QUOTE}/${FILE_ID}/part.dxf`, token: "tok", signedUrl: "u", kind: "dxf" });
      if (String(url) === routes.api.filesComplete) return complete();
      throw new Error(`unexpected ${String(url)}`);
    });
    const promise = uploadFileToQuote({
      quoteId: QUOTE,
      file: smallFile(),
      bucket: "quote-files",
      supabase: fakeSupabase(async () => ({ error: null })),
      supabaseUrl: "https://x.supabase.co",
      supabaseKey: "anon",
      onStage: (stage) => stages.push(stage),
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(promise).rejects.toMatchObject({ code: "analysis_timeout", fileId: FILE_ID });
    expect(stages).toEqual(["signing", "uploading", "analysing"]);
  });

  it("passes a JSON error code of the complete route through", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === routes.api.filesSign) return json({ fileId: FILE_ID, path: "p", token: "tok", signedUrl: "u", kind: "dxf" });
      return json({ error: "conflict" }, 409);
    });
    await expect(
      uploadFileToQuote({
        quoteId: QUOTE,
        file: smallFile(),
        bucket: "b",
        supabase: fakeSupabase(async () => ({ error: null })),
        supabaseUrl: "https://x.supabase.co",
        supabaseKey: "anon",
        onStage: () => undefined,
        fetch: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
  });

  it("uses the resumable endpoint above the threshold and never uploadToSignedUrl", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const calls: { method: string; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ method: init?.method ?? "GET", url: u });
      if (u === routes.api.filesSign) return json({ fileId: FILE_ID, path: `quotes/${QUOTE}/${FILE_ID}/hall.ifc`, token: "tok", signedUrl: "u", kind: "ifc" });
      if (u.endsWith("/upload/resumable")) return new Response(null, { status: 201, headers: { Location: "https://x.storage/up/1" } });
      if (u === "https://x.storage/up/1") return new Response(null, { status: 204, headers: { "Upload-Offset": String(Number((init?.headers as Record<string, string>)["Upload-Offset"]) + (init?.body as Blob).size) } });
      if (u === routes.api.filesComplete) return json({ fileId: FILE_ID, kind: "assembly", name: "hall", format: "ifc", parts: [], expected: 0, failed: [], intakeStatus: "done", skipped: 0 });
      throw new Error(`unexpected ${u}`);
    });
    const big = new File([new Uint8Array(RESUMABLE_THRESHOLD_BYTES + 10)], "hall.ifc");
    const progress: number[] = [];
    const result = await uploadFileToQuote({
      quoteId: QUOTE,
      file: big,
      bucket: "quote-files",
      supabase: fakeSupabase(upload),
      supabaseUrl: "https://x.supabase.co/",
      supabaseKey: "anon",
      onStage: () => undefined,
      onUploadProgress: (sent) => progress.push(sent),
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(result.fileId).toBe(FILE_ID);
    expect(upload).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    expect(progress.at(-1)).toBe(big.size);
  });
});

describe("uploadResumable (TUS)", () => {
  it("creates the upload with x-signature + metadata and PATCHes 6 MB chunks at increasing offsets", async () => {
    const size = 13 * 1024 * 1024;
    const file = new Blob([new Uint8Array(size)]);
    const requests: { method: string; url: string; headers: Record<string, string>; bodyBytes: number }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bodyBytes = init?.body instanceof Blob ? init.body.size : 0;
      requests.push({ method: init?.method ?? "GET", url: String(url), headers, bodyBytes });
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { Location: "/storage/v1/upload/resumable/abc" } });
      const next = Number(headers["Upload-Offset"]) + bodyBytes;
      return new Response(null, { status: 204, headers: { "Upload-Offset": String(next) } });
    };
    await uploadResumable(file, {
      endpoint: resumableEndpoint("https://ref.supabase.co"),
      headers: { apikey: "anon", "x-signature": "signed-token" },
      metadata: { bucketName: "quote-files", objectName: "quotes/q/f/hall.ifc", contentType: "application/octet-stream" },
      fetch: fetchImpl as typeof fetch,
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://ref.supabase.co/storage/v1/upload/resumable",
      headers: { "Tus-Resumable": "1.0.0", apikey: "anon", "x-signature": "signed-token", "Upload-Length": String(size) },
    });
    expect(requests[0].headers["Upload-Metadata"]).toBe(
      encodeTusMetadata({ bucketName: "quote-files", objectName: "quotes/q/f/hall.ifc", contentType: "application/octet-stream" })
    );
    const patches = requests.slice(1);
    expect(patches.every((r) => r.method === "PATCH" && r.url === "https://ref.supabase.co/storage/v1/upload/resumable/abc")).toBe(true);
    expect(patches.map((r) => Number(r.headers["Upload-Offset"]))).toEqual([0, TUS_CHUNK_BYTES, 2 * TUS_CHUNK_BYTES]);
    expect(patches.map((r) => r.bodyBytes)).toEqual([TUS_CHUNK_BYTES, TUS_CHUNK_BYTES, size - 2 * TUS_CHUNK_BYTES]);
    expect(patches.every((r) => r.headers["Content-Type"] === "application/offset+octet-stream")).toBe(true);
  });

  it("resyncs the offset with HEAD after a dropped chunk and continues", async () => {
    const chunk = 1024;
    const file = new Blob([new Uint8Array(chunk * 3)]);
    const log: string[] = [];
    let serverOffset = 0;
    let dropped = false;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      log.push(method);
      if (method === "POST") return new Response(null, { status: 201, headers: { Location: "https://s/up/1" } });
      if (method === "HEAD") return new Response(null, { status: 200, headers: { "Upload-Offset": String(serverOffset) } });
      const body = init?.body as Blob;
      if (!dropped && serverOffset === chunk) {
        // The server stored the second chunk but the response was lost.
        dropped = true;
        serverOffset += body.size;
        throw new TypeError("network");
      }
      serverOffset += body.size;
      return new Response(null, { status: 204, headers: { "Upload-Offset": String(serverOffset) } });
    };
    const sent: number[] = [];
    await uploadResumable(file, {
      endpoint: "https://s/storage/v1/upload/resumable",
      headers: {},
      metadata: { bucketName: "b", objectName: "o" },
      chunkBytes: chunk,
      onProgress: (bytes) => sent.push(bytes),
      fetch: fetchImpl as typeof fetch,
    });
    expect(log).toEqual(["POST", "PATCH", "PATCH", "HEAD", "PATCH"]);
    expect(serverOffset).toBe(chunk * 3);
    expect(sent.at(-1)).toBe(chunk * 3);
  });

  it("gives up as upload_failed on a 4xx answer", async () => {
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? new Response(null, { status: 201, headers: { Location: "https://s/up/1" } }) : new Response("nope", { status: 403 });
    await expect(
      uploadResumable(new Blob([new Uint8Array(10)]), { endpoint: "https://s/r", headers: {}, metadata: {}, fetch: fetchImpl as typeof fetch })
    ).rejects.toMatchObject({ code: "upload_failed", status: 403 });
  });
});

describe("status polling and resume", () => {
  it("polls until the intake leaves processing", async () => {
    const answers = [
      { intakeStatus: "processing", partsExpected: 45, partsDone: 10, intakeError: null },
      { intakeStatus: "processing", partsExpected: 45, partsDone: 30, intakeError: null },
      { intakeStatus: "partial", partsExpected: 45, partsDone: 41, intakeError: "x" },
    ];
    const fetchImpl = vi.fn(async () => json(answers.shift()));
    const seen: number[] = [];
    const final = await pollIntakeStatus(FILE_ID, {
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
      onProgress: (s) => seen.push(s.partsDone ?? -1),
    });
    expect(final).toMatchObject({ intakeStatus: "partial", partsDone: 41 });
    expect(seen).toEqual([10, 30, 41]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(routes.api.fileStatus(FILE_ID));
  });

  it("returns null when the time is up", async () => {
    const fetchImpl = vi.fn(async () => json({ intakeStatus: "processing", partsExpected: 45, partsDone: 1, intakeError: null }));
    const final = await pollIntakeStatus(FILE_ID, { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => undefined, timeoutMs: 0 });
    expect(final).toBeNull();
  });

  it("resume posts to the resume route and maps intake_done", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(routes.api.fileResumeIntake(FILE_ID));
      return json({ error: "intake_done" }, 409);
    });
    await expect(resumeIntakeRequest(FILE_ID, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(UploadFlowError);
    await expect(resumeIntakeRequest(FILE_ID, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "intake_done" });
  });
});
