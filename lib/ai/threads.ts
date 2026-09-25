/**
 * Metric thread size normalisation, shared by the heuristics, the AI
 * value sanitiser and the chip diff.
 * File path: /lib/ai/threads.ts
 *
 *   normalizeThreadSize("M8x1.25") → "M8"    (ISO 261 coarse pitch dropped)
 *   normalizeThreadSize("M10x1")   → "M10x1" (fine pitch kept)
 *   normalizeThreadSize("banana")  → null
 *
 * Lives in its own file so /lib/ai/bounds.ts can validate the model's
 * thread sizes without importing the whole heuristics module (which in
 * turn imports the bounds — a cycle otherwise).
 */

/** ISO 261 coarse pitches; a callout carrying exactly this pitch is plain "M<size>". */
export const COARSE_PITCH: Record<string, number> = {
  "1.6": 0.35,
  "2": 0.4,
  "2.5": 0.45,
  "3": 0.5,
  "4": 0.7,
  "5": 0.8,
  "6": 1,
  "8": 1.25,
  "10": 1.5,
  "12": 1.75,
  "14": 2,
  "16": 2,
  "18": 2.5,
  "20": 2.5,
  "22": 2.5,
  "24": 3,
  "27": 3,
  "30": 3.5,
  "33": 3.5,
  "36": 4,
  "39": 4,
  "42": 4.5,
  "45": 4.5,
  "48": 5,
  "52": 5,
  "56": 5.5,
  "60": 5.5,
  "64": 6,
};

export function toNumber(token: string): number | null {
  const n = Number(token.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatSize(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Canonical metric thread label: "M8", "M10x1", "M2.5". Returns null when the
 * input is not a metric thread callout (size 1–64 mm).
 */
export function normalizeThreadSize(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^M\s*(\d{1,2}(?:[.,]\d)?)(?:\s*[x×X]\s*(\d(?:[.,]\d{1,2})?))?/i);
  if (!m) return null;
  const size = toNumber(m[1]);
  if (size === null || size < 1 || size > 64) return null;
  const sizeKey = formatSize(size);
  const pitch = m[2] ? toNumber(m[2]) : null;
  if (pitch !== null && COARSE_PITCH[sizeKey] !== pitch) {
    return `M${sizeKey}x${formatSize(pitch)}`;
  }
  return `M${sizeKey}`;
}
