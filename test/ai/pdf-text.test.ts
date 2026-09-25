/**
 * extractPdfText / isPdf against a PDF generated on the fly with
 * @react-pdf/renderer (the same library the quote PDF uses), so the test
 * needs no binary fixture and proves pdfjs-dist runs in plain Node.
 * File path: /test/ai/pdf-text.test.ts
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractPdfText, isPdf, normalisePdfText } from "@/lib/pdf-text";

const h = React.createElement;
const TITLE_BLOCK = "PLECH 2x554,3x60 DC01 WEIGHT: 0,51 kg M8x1.25 (8x)";

async function makePdf(pages: string[][]): Promise<Buffer> {
  const doc = h(
    Document,
    null,
    ...pages.map((lines, i) =>
      h(Page, { key: i, size: "A4" }, ...lines.map((line, j) => h(Text, { key: j }, line)))
    )
  );
  return renderToBuffer(doc);
}

describe("isPdf", () => {
  it("recognises the %PDF- magic", async () => {
    const pdf = await makePdf([["x"]]);
    expect(isPdf(pdf)).toBe(true);
    expect(isPdf(new Uint8Array(pdf))).toBe(true);
  });

  it("rejects non-PDF bytes", () => {
    expect(isPdf(Buffer.from("hello"))).toBe(false);
    expect(isPdf(Buffer.from("0,0\nLINE\n"))).toBe(false);
    expect(isPdf(new Uint8Array(0))).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("returns the known title-block text from a generated PDF", async () => {
    const pdf = await makePdf([[TITLE_BLOCK, "n 13 (6x)"]]);
    const result = await extractPdfText(pdf);
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.text).toContain(TITLE_BLOCK);
    expect(result.text).toContain("n 13 (6x)");
  }, 30_000);

  it("keeps pages apart and accepts a Uint8Array", async () => {
    const pdf = await makePdf([["First page S355"], ["Second page M10x1 (6x)"]]);
    const bytes = new Uint8Array(pdf);
    const result = await extractPdfText(bytes);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]).toContain("First page S355");
    expect(result.pages[1]).toContain("Second page M10x1 (6x)");
    expect(result.text).toContain("First page S355\n\nSecond page M10x1 (6x)");
    // The caller's buffer must stay usable (pdfjs may detach what it is given).
    expect(bytes.byteLength).toBe(pdf.byteLength);
    expect(isPdf(bytes)).toBe(true);
  }, 30_000);

  it("throws on non-PDF bytes", async () => {
    await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toThrow(/not a PDF/);
  });
});

describe("normalisePdfText", () => {
  it("collapses whitespace and drops empty lines", () => {
    expect(normalisePdfText("  A   B \t C \r\n\n\n  D  ")).toBe("A B C\nD");
  });
});
