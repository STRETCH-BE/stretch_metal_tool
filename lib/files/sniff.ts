/**
 * File type sniffing + upload validation — pure, no I/O.
 * File path: /lib/files/sniff.ts
 *
 * Extensions are a hint; the BYTES decide (build prompt Step 12). Order of
 * checks matters: a DWG ("AC10xx" at offset 0) and a binary DXF ("AutoCAD
 * Binary DXF\r\n\u001a\0") are recognised first because both are
 * rejected with a specific message; then PDF ("%PDF-" within the first
 * 1 KiB, Acrobat's own tolerance for junk before the header), STEP
 * ("ISO-10303-21;" as the first token), and finally ASCII DXF: after an
 * optional BOM and blank lines the file is a sequence of (group code,
 * value) line pairs; 999 comment pairs are skipped and the first real
 * pair must be `0` / `SECTION`. CRLF, leading spaces on the code line and
 * cp1250 bytes (decoded as latin1, never fatal) are all tolerated.
 *
 * Companion matching (200005.pdf ↔ 200005.dxf) compares `baseName()` —
 * the file name without its LAST extension only, case-insensitively —
 * so "Bracket.v2.DXF" pairs with "bracket.v2.pdf".
 *
 * Limits: 25 MB per file (MAX_FILE_BYTES) and the whitelist .dxf .pdf
 * .step .stp. A .dwg gets its own rejection code so the UI can show the
 * "save as DXF" message with the guide link.
 */

import type { FileKind } from "@/lib/db/types";

export type SniffedType = "dxf" | "pdf" | "step" | "dwg" | "dxf_binary" | "unknown";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["dxf", "pdf", "step", "stp"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** Codes the UI maps to copy (content.upload.errors). */
export type UploadRejection = "extension" | "size" | "dwg" | "empty" | "binary_dxf" | "unknown_type" | "type_mismatch";

const HEAD_BYTES = 4096;
const PDF_WINDOW = 1024;

function head(bytes: Uint8Array, n = HEAD_BYTES): string {
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, n));
  let s = "";
  for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
  return s;
}

function stripBom(s: string): string {
  // UTF-8 BOM as latin1 chars, or a UTF-16 BOM.
  if (s.startsWith("ï»¿")) return s.slice(3);
  if (s.startsWith("þÿ") || s.startsWith("ÿþ")) return s.slice(2);
  return s;
}

/** True when the text starts with DXF group-code pairs leading to 0/SECTION. */
export function looksLikeAsciiDxf(text: string): boolean {
  const lines = stripBom(text)
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let i = 0;
  // Allow a handful of 999 comment pairs before the first section.
  for (let guard = 0; guard < 16 && i + 1 < lines.length; guard++) {
    const code = lines[i];
    const value = lines[i + 1];
    if (!/^-?\d+$/.test(code)) return false;
    if (code === "999") {
      i += 2;
      continue;
    }
    return Number(code) === 0 && value.toUpperCase() === "SECTION";
  }
  return false;
}

export function sniffFileType(bytes: Uint8Array, fileName = ""): SniffedType {
  if (bytes.byteLength === 0) return "unknown";
  const text = head(bytes);
  if (/^AC10\d\d/.test(text)) return "dwg";
  if (text.startsWith("AutoCAD Binary DXF")) return "dxf_binary";
  if (text.slice(0, PDF_WINDOW).includes("%PDF-")) return "pdf";
  if (/^\s*ISO-10303-21\s*;/.test(stripBom(text))) return "step";
  if (looksLikeAsciiDxf(text)) return "dxf";
  void fileName;
  return "unknown";
}

/** Lower-case extension without the dot, "" when none. */
export function extensionOf(fileName: string): string {
  const name = fileName.trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** File name without its last extension (case preserved). */
export function baseName(fileName: string): string {
  const name = fileName.trim().replace(/^.*[\\/]/, "");
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Companion match: same base name, case-insensitive. */
export function baseNamesMatch(a: string, b: string): boolean {
  return baseName(a).toLowerCase() === baseName(b).toLowerCase();
}

export function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/** Storage-safe file name: ASCII letters, digits, dot, dash, underscore; ≤ 120 chars. */
export function safeFileName(fileName: string): string {
  const name = fileName.trim().replace(/^.*[\\/]/, "");
  const ext = extensionOf(name);
  const base = baseName(name)
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  const safeBase = base.length > 0 ? base : "file";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

export type UploadValidation =
  | { ok: true; extension: AllowedExtension; kind: Exclude<FileKind, "export_dxf" | "thumbnail" | "quote_pdf" | "other"> }
  | { ok: false; code: UploadRejection };

/** Extension + size check before a signed upload URL is issued. */
export function validateUploadRequest(input: { fileName: string; size: number }): UploadValidation {
  const ext = extensionOf(input.fileName);
  if (ext === "dwg") return { ok: false, code: "dwg" };
  if (!isAllowedExtension(ext)) return { ok: false, code: "extension" };
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, code: "empty" };
  if (input.size > MAX_FILE_BYTES) return { ok: false, code: "size" };
  return { ok: true, extension: ext, kind: kindForExtension(ext) };
}

export function kindForExtension(ext: AllowedExtension): "dxf" | "pdf" | "step" {
  return ext === "stp" || ext === "step" ? "step" : ext;
}

export type SniffValidation =
  | { ok: true; kind: "dxf" | "pdf" | "step" }
  | { ok: false; code: UploadRejection; sniffed: SniffedType };

/** Server-side check of the downloaded bytes against the claimed extension. */
export function validateSniffedFile(bytes: Uint8Array, fileName: string): SniffValidation {
  const sniffed = sniffFileType(bytes, fileName);
  if (sniffed === "dwg") return { ok: false, code: "dwg", sniffed };
  if (sniffed === "dxf_binary") return { ok: false, code: "binary_dxf", sniffed };
  if (sniffed === "unknown") return { ok: false, code: "unknown_type", sniffed };
  const ext = extensionOf(fileName);
  const claimed = isAllowedExtension(ext) ? kindForExtension(ext) : null;
  if (claimed !== null && claimed !== sniffed) return { ok: false, code: "type_mismatch", sniffed };
  return { ok: true, kind: sniffed };
}

/** MIME stored on the files row per kind (the bucket whitelist accepts these). */
export function mimeForKind(kind: "dxf" | "pdf" | "step"): string {
  switch (kind) {
    case "dxf":
      return "application/dxf";
    case "pdf":
      return "application/pdf";
    case "step":
      return "application/step";
  }
}
