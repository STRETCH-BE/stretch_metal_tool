/**
 * The embedded font data must match the TTF files in /public/fonts/pdf
 * (regenerate with `node scripts/generate-pdf-fonts.mjs`).
 * File path: /test/pdf/fonts-data.test.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_FONT_FILES } from "@/lib/pdf/fonts-data";

describe("pdf fonts-data", () => {
  it("matches the TTF files byte for byte", () => {
    expect(PDF_FONT_FILES).toHaveLength(5);
    for (const font of PDF_FONT_FILES) {
      const bytes = readFileSync(path.join(process.cwd(), "public", "fonts", "pdf", font.file));
      expect(font.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      const [header, payload] = font.dataUrl.split(",", 2);
      expect(header).toBe("data:font/ttf;base64");
      expect(Buffer.from(payload, "base64").equals(bytes)).toBe(true);
    }
  });
});
