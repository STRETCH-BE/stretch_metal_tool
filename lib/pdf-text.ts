/**
 * PDF text extraction for the PDF companion of a part (server only).
 * File path: /lib/pdf-text.ts
 *
 *   isPdf(bytes)            → true when the bytes carry the %PDF- magic
 *   extractPdfText(bytes)   → { text, pages, pageCount } via pdfjs-dist
 *
 * Decisions:
 * - pdfjs-dist v5 is loaded with a dynamic import of the *legacy* build
 *   inside the function, so the module is only evaluated on the server
 *   (route handler / server action) and never lands in a client bundle.
 *   `next.config.ts` lists pdfjs-dist under `serverExternalPackages`, so
 *   Next leaves the import to Node.
 * - Worker on the main thread, imported STATICALLY. In Node pdfjs disables
 *   the web worker and runs a "fake worker": it first looks for
 *   `globalThis.pdfjsWorker.WorkerMessageHandler` and only otherwise does
 *   `import(GlobalWorkerOptions.workerSrc)` with the runtime default
 *   "./pdf.worker.mjs" — a VARIABLE specifier that Vercel's output file
 *   tracing (@vercel/nft) cannot follow, so on a deployed function the
 *   worker file would be missing and every getDocument() would reject
 *   with "Setting up fake worker failed". `extractPdfText` therefore
 *   imports "pdfjs-dist/legacy/build/pdf.worker.mjs" with a string
 *   literal before getDocument: nft traces the literal (the file ships
 *   with the function) and the module sets `globalThis.pdfjsWorker`, so
 *   pdfjs takes the main-thread path and never dereferences `workerSrc`.
 *   /test/ai/pdf-worker.test.ts proves both halves (nft trace + a bogus
 *   workerSrc). `useSystemFonts: true` avoids the standard-font fetch
 *   that Node cannot do. The former `isEvalSupported: false` option is
 *   gone in pdfjs-dist 5.7 (the build contains no `eval` / `new Function`
 *   at all), so it is not passed.
 * - The bytes are copied before handing them to pdfjs because pdfjs may
 *   transfer (detach) the ArrayBuffer it receives; callers keep their
 *   buffer usable (e.g. to base64 the same bytes for the AI pre-fill).
 * - Text items are joined with spaces, lines (`hasEOL`) with newlines,
 *   whitespace collapsed. The result matches the fixtures in
 *   /test/fixtures/*.pdf.txt, which drive the heuristics in
 *   /lib/ai/heuristics.ts (Ø is rendered as a lone "n" by CAD fonts).
 * - The PDF companion is matched to a DXF by base name
 *   (200005.pdf ↔ 200005.dxf) in the intake route, not here.
 */

export type PdfText = {
  /** All pages, joined with a blank line between pages. */
  text: string;
  /** One normalised string per page (1-based page N is `pages[N - 1]`). */
  pages: string[];
  pageCount: number;
};

const PDF_MAGIC = "%PDF-";
/** The spec lets viewers accept junk before the header; 1 KiB is Acrobat's tolerance. */
const MAGIC_SEARCH_WINDOW = 1024;

/** True when the buffer starts with (or contains within the first 1 KiB) the %PDF- header. */
export function isPdf(buffer: Uint8Array | Buffer): boolean {
  if (!buffer || buffer.byteLength < PDF_MAGIC.length) return false;
  const head = new TextDecoder("latin1").decode(
    buffer.subarray(0, Math.min(buffer.byteLength, MAGIC_SEARCH_WINDOW))
  );
  return head.includes(PDF_MAGIC);
}

/** Collapse whitespace the way the fixtures were produced: single spaces, trimmed lines, no blank lines. */
export function normalisePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Extract the text of every page. Throws on a non-PDF or an unreadable
 * (encrypted, truncated) file — callers decide whether that is fatal.
 */
export async function extractPdfText(
  buffer: Uint8Array | Buffer
): Promise<PdfText> {
  if (!isPdf(buffer)) {
    throw new Error("extractPdfText: the bytes are not a PDF (missing %PDF- header).");
  }

  // Dynamic imports keep pdfjs on the server; the string literals keep both
  // files in Vercel's file trace. The worker module registers
  // globalThis.pdfjsWorker, which pdfjs's Node fake worker uses directly.
  // @ts-expect-error -- pdfjs-dist ships no typings for the worker build
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // The copy protects the caller's buffer.
  const data = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let raw = "";
        for (const item of content.items) {
          // TextMarkedContent items carry no text; only TextItem has `str`.
          if (!("str" in item)) continue;
          raw += item.str;
          raw += item.hasEOL ? "\n" : " ";
        }
        pages.push(normalisePdfText(raw));
      } finally {
        page.cleanup();
      }
    }
    return {
      text: pages.filter((p) => p.length > 0).join("\n\n"),
      pages,
      pageCount: pdf.numPages,
    };
  } finally {
    await pdf.destroy();
  }
}
