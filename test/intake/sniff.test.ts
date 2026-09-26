/**
 * File sniffing + upload validation (lib/files/sniff.ts) — customer
 * fixtures and synthetic buffers: DXF (CRLF, BOM, 999 comments, cp1250
 * bytes), binary DXF, PDF (junk before the header), STEP, DWG, unknown;
 * extension whitelist, 25 MB limit, base-name companion matching.
 * File path: /test/intake/sniff.test.ts
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  baseName,
  baseNamesMatch,
  extensionOf,
  kindForExtension,
  mimeForKind,
  safeFileName,
  sniffFileType,
  validateSniffedFile,
  validateUploadRequest,
} from "@/lib/files/sniff";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const FIXTURE_200005 = new Uint8Array(fs.readFileSync("test/fixtures/200005.dxf"));
const FIXTURE_200164 = new Uint8Array(fs.readFileSync("test/fixtures/200164.dxf"));

describe("sniffFileType", () => {
  it("recognises the customer DXFs (CRLF, cp1250 code page)", () => {
    expect(sniffFileType(FIXTURE_200005, "200005.dxf")).toBe("dxf");
    expect(sniffFileType(FIXTURE_200164, "200164.dxf")).toBe("dxf");
  });

  it("accepts a BOM, blank lines, leading spaces and 999 comments before 0/SECTION", () => {
    const text = "\u00ef\u00bb\u00bf\r\n\r\n999\r\nmade by test\r\n  0\r\nSECTION\r\n  2\r\nHEADER\r\n";
    expect(sniffFileType(bytes(text), "a.dxf")).toBe("dxf");
    expect(sniffFileType(bytes("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"), "b.dxf")).toBe("dxf");
  });

  it("tolerates cp1250 bytes in the head", () => {
    const text = "  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$TITLE\r\n  1\r\nGi\u00eacie \u00b3\u00b9cznik\r\n";
    expect(sniffFileType(bytes(text), "x.dxf")).toBe("dxf");
  });

  it("flags a binary DXF and a DWG", () => {
    expect(sniffFileType(bytes("AutoCAD Binary DXF\r\n\u001a\u0000rest"), "bin.dxf")).toBe("dxf_binary");
    expect(sniffFileType(bytes("AC1015" + "\u0000".repeat(40)), "part.dwg")).toBe("dwg");
    expect(sniffFileType(bytes("AC1032" + "\u0000".repeat(40)), "part.dxf")).toBe("dwg");
  });

  it("recognises PDF (header within the first 1 KiB) and STEP", () => {
    expect(sniffFileType(bytes("%PDF-1.7\n%\u00e2\u00e3\n"), "d.pdf")).toBe("pdf");
    expect(sniffFileType(bytes("\n".repeat(200) + "%PDF-1.4\n"), "d.pdf")).toBe("pdf");
    expect(sniffFileType(bytes("x".repeat(2000) + "%PDF-1.4\n"), "d.pdf")).toBe("unknown");
    expect(sniffFileType(bytes("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('part'),'2;1');"), "m.step")).toBe("step");
    expect(sniffFileType(bytes("\u00ef\u00bb\u00bf  ISO-10303-21 ;\n"), "m.stp")).toBe("step");
  });

  it("returns unknown for garbage, text without SECTION and empty buffers", () => {
    expect(sniffFileType(bytes("hello world"), "a.dxf")).toBe("unknown");
    expect(sniffFileType(bytes("  0\nENTITIES\n"), "a.dxf")).toBe("unknown");
    expect(sniffFileType(bytes("abc\n0\nSECTION"), "a.dxf")).toBe("unknown");
    expect(sniffFileType(new Uint8Array(0), "a.dxf")).toBe("unknown");
  });
});

describe("validateUploadRequest", () => {
  it("whitelists .dxf .pdf .step .stp (case-insensitive) and maps them to kinds", () => {
    expect(ALLOWED_EXTENSIONS).toEqual(["dxf", "pdf", "step", "stp"]);
    expect(validateUploadRequest({ fileName: "200005.DXF", size: 10 })).toEqual({ ok: true, extension: "dxf", kind: "dxf" });
    expect(validateUploadRequest({ fileName: "a.stp", size: 10 })).toEqual({ ok: true, extension: "stp", kind: "step" });
    expect(kindForExtension("step")).toBe("step");
    expect(mimeForKind("pdf")).toBe("application/pdf");
  });

  it("rejects DWG with its own code, other extensions, empty and oversize files", () => {
    expect(validateUploadRequest({ fileName: "part.dwg", size: 10 })).toEqual({ ok: false, code: "dwg" });
    expect(validateUploadRequest({ fileName: "part.exe", size: 10 })).toEqual({ ok: false, code: "extension" });
    expect(validateUploadRequest({ fileName: "noext", size: 10 })).toEqual({ ok: false, code: "extension" });
    expect(validateUploadRequest({ fileName: "a.dxf", size: 0 })).toEqual({ ok: false, code: "empty" });
    expect(validateUploadRequest({ fileName: "a.dxf", size: MAX_FILE_BYTES + 1 })).toEqual({ ok: false, code: "size" });
    expect(validateUploadRequest({ fileName: "a.dxf", size: MAX_FILE_BYTES })).toMatchObject({ ok: true });
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("validateSniffedFile", () => {
  it("passes matching bytes and rejects mismatches / DWG / binary / unknown", () => {
    expect(validateSniffedFile(FIXTURE_200005, "200005.dxf")).toEqual({ ok: true, kind: "dxf" });
    expect(validateSniffedFile(bytes("%PDF-1.4"), "x.pdf")).toEqual({ ok: true, kind: "pdf" });
    expect(validateSniffedFile(bytes("%PDF-1.4"), "x.dxf")).toEqual({ ok: false, code: "type_mismatch", sniffed: "pdf" });
    expect(validateSniffedFile(bytes("AC1018xxxx"), "x.dxf")).toEqual({ ok: false, code: "dwg", sniffed: "dwg" });
    expect(validateSniffedFile(bytes("AutoCAD Binary DXF\r\n"), "x.dxf")).toEqual({ ok: false, code: "binary_dxf", sniffed: "dxf_binary" });
    expect(validateSniffedFile(bytes("nope"), "x.dxf")).toEqual({ ok: false, code: "unknown_type", sniffed: "unknown" });
  });
});

describe("base names", () => {
  it("strips the last extension only, keeps case, matches case-insensitively", () => {
    expect(baseName("200005.dxf")).toBe("200005");
    expect(baseName("Bracket.v2.DXF")).toBe("Bracket.v2");
    expect(baseName("C:\\drawings\\200005.PDF")).toBe("200005");
    expect(baseName("noext")).toBe("noext");
    expect(baseName(".hidden")).toBe(".hidden");
    expect(baseNamesMatch("200005.pdf", "200005.DXF")).toBe(true);
    expect(baseNamesMatch("Bracket.v2.pdf", "bracket.v2.dxf")).toBe(true);
    expect(baseNamesMatch("200005.pdf", "200005-rev2.dxf")).toBe(false);
    expect(extensionOf("a.b.STEP")).toBe("step");
    expect(extensionOf("a.")).toBe("");
  });

  it("makes storage-safe names", () => {
    expect(safeFileName("Gięcie łącznik (1).dxf")).toBe("Giecie_lacznik_1.dxf");
    expect(safeFileName("../../evil.pdf")).toBe("evil.pdf");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("ąę ź.STEP")).toBe("ae_z.step");
  });
});
