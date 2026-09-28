/**
 * Drawing cross-checks — what the companion PDF says against what the
 * model holds: the parts list (hardware quantities), the revision letter
 * of the title block against the file name, the material and finish
 * lines, and whether paint masking is called out.
 * File path: /lib/geometry/step/drawing-check.ts
 *
 * Pure text parsing over the extracted PDF text (lib/pdf-text.ts), so it
 * runs inside the geometry engine (sheet report) and in tests without a
 * PDF library. French drawings
 * (SST) are the reference: "Réf / Qt / Designation" parts list rows such
 * as "1  5  Goujon M3x8" or "3  10  Insert M4", a revision table whose
 * rows start with the index letter ("IND." column: "G  12/03/2026 …"),
 * and title-block labels MATIERE / FINITION. English and Polish labels
 * are accepted too. Everything found is a SUGGESTION until confirmed.
 */

import type { HardwareKind, HardwareLine } from "../types";

export type DrawingHardwareRow = { kind: HardwareKind; size: string; qty: number; label: string };

export type DrawingCheck = {
  hardware: DrawingHardwareRow[];
  /** Latest revision letter of the revision table (highest in the alphabet), or null. */
  revision: string | null;
  material: string | null;
  finish: string | null;
  masking: boolean;
};

const MASKING_WORDS = ["epargne peinture", "épargne peinture", "masking", "maskierung", "maskowanie", "abdeckung"];

const STUD_WORDS = ["goujon", "stud", "bolzen", "kołek", "kolek", "sworzeń", "sworzen"];
const INSERT_WORDS = ["insert", "écrou à sertir", "ecrou a sertir", "einpressmutter", "nakrętka wciskana", "nakretka wciskana", "press-in", "pem"];

function normaliseLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function sizeIn(text: string): string | null {
  const m = text.match(/\bM\s?(\d{1,2})(?:\s?[x×]\s?(\d{1,3}))?/i);
  if (!m) return null;
  return m[2] ? `M${m[1]}x${m[2]}` : `M${m[1]}`;
}

/** Parts-list rows: a quantity and a designation with a stud / insert word and a metric size. */
export function parseHardwareRows(text: string): DrawingHardwareRow[] {
  const out: DrawingHardwareRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = normaliseLine(raw);
    if (!line) continue;
    const lower = line.toLowerCase();
    const kind: HardwareKind | null = STUD_WORDS.some((w) => lower.includes(w)) ? "weld_stud" : INSERT_WORDS.some((w) => lower.includes(w)) ? "insert" : null;
    if (!kind) continue;
    const size = sizeIn(line);
    if (!size) continue;
    // Quantity: the integer column before the designation ("1 5 Goujon…" → 5, "Qt 10 Insert…" → 10).
    const before = line.slice(0, lower.search(new RegExp((kind === "weld_stud" ? STUD_WORDS : INSERT_WORDS).map(escapeRe).join("|"), "i")));
    const numbers = before.match(/\d+/g) ?? [];
    const qty = numbers.length > 0 ? Number(numbers[numbers.length - 1]) : NaN;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) continue;
    out.push({ kind, size: size.toUpperCase(), qty, label: line });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Revision letter from a file name such as "M040120_G - Face avant.stp" → "G". */
export function revisionFromFileName(fileName: string): string | null {
  const m = fileName.match(/^[A-Z0-9]+[_-]([A-Z])(?:\b|[ _-])/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Latest revision of the drawing's revision table: rows that start with a
 * single letter followed by a date ("G 12/03/2026 …", "IND. G …"). The
 * highest letter wins (revision tables list every index).
 */
export function revisionFromDrawing(text: string): string | null {
  let best: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = normaliseLine(raw);
    const m = line.match(/^(?:IND\.?\s+)?([A-Z])\s+(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
    if (!m) continue;
    const letter = m[1].toUpperCase();
    if (best === null || letter > best) best = letter;
  }
  return best;
}

const MATERIAL_LABELS = ["matiere", "matière", "material", "materiał", "material:"];
const FINISH_LABELS = ["finition", "finish", "wykończenie", "wykonczenie", "oberfläche", "oberflaeche"];

/** "MATIERE : DC01 2mm" → "DC01 2mm"; the LAST occurrence wins (older revisions are listed first). */
function labelledValue(text: string, labels: string[]): string | null {
  let value: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = normaliseLine(raw);
    const lower = line.toLowerCase();
    for (const label of labels) {
      const idx = lower.indexOf(label);
      if (idx < 0) continue;
      const rest = line.slice(idx + label.length).replace(/^[\s:.-]+/, "").trim();
      if (rest.length >= 2 && rest.length <= 80) value = rest;
    }
  }
  return value;
}

export function checkDrawing(text: string | null | undefined): DrawingCheck {
  if (!text) return { hardware: [], revision: null, material: null, finish: null, masking: false };
  const lower = text.toLowerCase();
  return {
    hardware: parseHardwareRows(text),
    revision: revisionFromDrawing(text),
    material: labelledValue(text, MATERIAL_LABELS),
    finish: labelledValue(text, FINISH_LABELS),
    masking: MASKING_WORDS.some((w) => lower.includes(w)),
  };
}

export type HardwareMismatch = { kind: HardwareKind; size: string; drawingQty: number; modelQty: number };

/** Drawing rows vs detected hardware, by (kind, size); a size the model reads as "M4" matches a drawing "M4". */
export function compareHardware(drawing: DrawingHardwareRow[], detected: HardwareLine[]): HardwareMismatch[] {
  const key = (kind: HardwareKind, size: string | null) => `${kind}|${(size ?? "?").toUpperCase().replace(/×/g, "X")}`;
  const modelQty = new Map<string, number>();
  for (const h of detected) modelQty.set(key(h.kind, h.size), (modelQty.get(key(h.kind, h.size)) ?? 0) + h.qty);
  const drawingQty = new Map<string, { kind: HardwareKind; size: string; qty: number }>();
  for (const d of drawing) {
    const k = key(d.kind, d.size);
    const cur = drawingQty.get(k);
    drawingQty.set(k, { kind: d.kind, size: d.size, qty: (cur?.qty ?? 0) + d.qty });
  }
  const out: HardwareMismatch[] = [];
  for (const [k, d] of drawingQty) {
    const m = modelQty.get(k) ?? 0;
    if (m !== d.qty) out.push({ kind: d.kind, size: d.size, drawingQty: d.qty, modelQty: m });
  }
  for (const [k, m] of modelQty) {
    if (!drawingQty.has(k)) {
      const [kind, size] = k.split("|") as [HardwareKind, string];
      out.push({ kind, size, drawingQty: 0, modelQty: m });
    }
  }
  return out;
}
