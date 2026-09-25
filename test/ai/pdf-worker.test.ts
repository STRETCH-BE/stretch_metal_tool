/**
 * The pdfjs worker must survive Vercel's output file tracing (review
 * finding): pdfjs's Node fake worker does `import(GlobalWorkerOptions.
 * workerSrc)` with a runtime variable that @vercel/nft cannot follow, so
 * /lib/pdf-text.ts imports the worker with a string literal first. This
 * file proves (1) the literal is there, (2) Next's bundled nft traces
 * the worker only because of it, (3) pdfjs never dereferences workerSrc
 * (a bogus path still extracts). It must be the FIRST extraction in this
 * process, hence its own file (vitest isolates files).
 * File path: /test/ai/pdf-worker.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractPdfText } from "@/lib/pdf-text";

const ROOT = process.cwd();
const SOURCE = fs.readFileSync(path.join(ROOT, "lib/pdf-text.ts"), "utf8");
const WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.mjs";
const PDF_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";

/** The literal `import("…")` specifiers in the source, in order. */
function importLiterals(source: string): string[] {
  return Array.from(source.matchAll(/import\(\s*"([^"]+)"\s*\)/g), (m) => m[1]);
}

type TraceResult = { fileList: Set<string> };
type NodeFileTrace = (
  files: string[],
  options: { base: string; processCwd: string; mixedModules: boolean }
) => Promise<TraceResult>;

async function traceEntry(source: string): Promise<string[]> {
  const require = createRequire(path.join(ROOT, "package.json"));
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft") as {
    nodeFileTrace: NodeFileTrace;
  };
  const entry = path.join(ROOT, "test/ai/.nft-entry.tmp.mjs");
  fs.writeFileSync(entry, source);
  try {
    const result = await nodeFileTrace([entry], { base: ROOT, processCwd: ROOT, mixedModules: true });
    return [...result.fileList].filter((f) => f.includes("pdfjs-dist/legacy/build/"));
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

describe("pdf.worker.mjs stays in the output file trace", () => {
  it("lib/pdf-text.ts imports the worker with a string literal, before pdf.mjs", () => {
    const literals = importLiterals(SOURCE);
    expect(literals).toContain(WORKER_SPECIFIER);
    expect(literals).toContain(PDF_SPECIFIER);
    expect(literals.indexOf(WORKER_SPECIFIER)).toBeLessThan(literals.indexOf(PDF_SPECIFIER));
    expect(SOURCE).not.toMatch(/workerSrc\s*=/);
  });

  it("nft traces the worker only through that literal (control: pdf.mjs alone misses it)", async () => {
    const withoutWorker = await traceEntry(`export const f = () => import("${PDF_SPECIFIER}");`);
    expect(withoutWorker.some((f) => f.endsWith("pdf.mjs"))).toBe(true);
    expect(withoutWorker.some((f) => f.endsWith("pdf.worker.mjs"))).toBe(false);

    const asInSource = await traceEntry(
      importLiterals(SOURCE)
        .map((s, i) => `export const f${i} = () => import("${s}");`)
        .join("\n")
    );
    expect(asInSource.some((f) => f.endsWith("pdf.mjs"))).toBe(true);
    expect(asInSource.some((f) => f.endsWith("pdf.worker.mjs"))).toBe(true);
  }, 60_000);

  it("extraction works even when workerSrc points nowhere (main-thread handler path)", async () => {
    const pdfjs = await import(PDF_SPECIFIER);
    pdfjs.GlobalWorkerOptions.workerSrc = "/nonexistent/pdf.worker.mjs";

    const pdf = await renderToBuffer(
      React.createElement(
        Document,
        null,
        React.createElement(Page, { size: "A4" }, React.createElement(Text, null, "PLECH 3x100x50 S235"))
      )
    );
    const result = await extractPdfText(pdf);
    expect(result.text).toContain("PLECH 3x100x50 S235");
    expect((globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker?.WorkerMessageHandler).toBeTruthy();
  }, 30_000);
});
