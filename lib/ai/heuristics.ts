/**
 * Heuristic title-block reader — suggestions from PDF text without any AI.
 * File path: /lib/ai/heuristics.ts
 *
 *   heuristicSuggestions(text, partName?) → Suggestions (source "heuristic",
 *                                            confidence always "low")
 *   normalizeThreadSize("M8x1.25")        → "M8"   (coarse pitch dropped)
 *   normalizeThreadSize("M10x1")          → "M10x1" (fine pitch kept)
 *
 * Tuned on the real pdfjs output of the customer drawings in
 * /test/fixtures/200005.pdf.txt and 200164.pdf.txt (Inventor title blocks,
 * Slovak/English labels). What the extractor gives us:
 * - "PLECH 15x500x220"  → thickness 15 (the smallest of the three),
 *                         blank 500 × 220
 * - "WEIGHT: 11,69 kg"  → 11.69 (decimal comma)
 * - "M8x1.25 (8x)"      → thread M8 × 8;  "M10x1 (6x)" → M10x1 × 6
 * - "n 13 (6x)"         → a Ø13 hole, 6× ("n" is how CAD fonts render Ø)
 *                         → goes to notes, never to threads
 * - "2x45 °"            → chamfer, never a bend angle
 * - "45 °" / "13 °"     → bend angles ONLY when a bend context word exists
 *                         (bend, ohyb, gięcie, Abkant, …); otherwise a note
 * - part number from the file name ("200005.pdf") or the title block
 *   ("200005.ipt")
 *
 * Rules that keep sales safe: the quantity is read only from an explicit
 * label (QTY / szt. / ks / Stk …), never from dimension numbers or "(8x)"
 * counts; confidence is always "low"; nothing here is auto-applied.
 *
 * Notes are language-neutral where possible (symbols: Ø, ×, °) with short
 * English keywords; the UI labels around them are localised.
 */

import {
  emptySuggestions,
  type BendDirection,
  type Suggestions,
  type ThreadSuggestion,
} from "@/lib/ai/types";

/* ---------- number helpers ---------- */

function toNumber(token: string): number | null {
  const n = Number(token.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/* ---------- threads ---------- */

/** ISO 261 coarse pitches; a callout carrying exactly this pitch is plain "M<size>". */
const COARSE_PITCH: Record<string, number> = {
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

function formatSize(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Canonical metric thread label: "M8", "M10x1", "M2.5". Returns null when the
 * input is not a metric thread callout.
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

const THREAD_RE =
  /(?:\b(\d{1,3})\s*[x×]\s*)?\bM(\d{1,2}(?:[.,]\d)?)(?:\s*[x×]\s*(\d(?:[.,]\d{1,2})?)(?!\d))?(?:\s*-\s*(?:6H|6g|LH))?(?:\s*\(\s*(\d{1,3})\s*[x×]\s*\))?/g;

function readThreads(text: string): { threads: ThreadSuggestion[]; notes: string[] } {
  const bySize = new Map<string, { count: number | null; seen: number }>();
  for (const m of text.matchAll(THREAD_RE)) {
    const size = normalizeThreadSize(`M${m[2]}${m[3] ? `x${m[3]}` : ""}`);
    if (!size) continue;
    const countToken = m[4] ?? m[1];
    const count = countToken ? Number(countToken) : null;
    const entry = bySize.get(size);
    if (!entry) {
      bySize.set(size, { count, seen: 1 });
    } else {
      // Same callout repeated in another view: keep the largest count seen,
      // never sum (summing double-counts repeated views).
      entry.seen += 1;
      if (count !== null && (entry.count === null || count > entry.count)) {
        entry.count = count;
      }
    }
  }
  const notes: string[] = [];
  const threads = Array.from(bySize, ([size, { count, seen }]) => {
    if (seen > 1) notes.push(`${size}: callout seen ${seen}× — count not summed`);
    return { size, count };
  });
  return { threads, notes };
}

/* ---------- thickness and blank size ---------- */

const SHEET_RE =
  /\b(?:PLECH|BLECH|BLACHA|SHEET|PLATE|PL\.?)\s*[:=]?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*[x×X]\s*(\d{1,5}(?:[.,]\d{1,2})?)\s*[x×X]\s*(\d{1,5}(?:[.,]\d{1,2})?)\b/i;

const THICKNESS_LABEL_RE =
  /\b(?:THICKNESS|THK|GRUBOŚĆ|GRUBOSC|GR\.|HRÚBKA|HRUBKA|TLOUŠŤKA|TLOUSTKA|DICKE|STÄRKE|STAERKE|t)\s*[:=]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:mm)?\b/i;

function readSheet(text: string): {
  thicknessMm: number | null;
  dimensionsMm: { length: number; width: number } | null;
} {
  const m = text.match(SHEET_RE);
  if (m) {
    const nums = [m[1], m[2], m[3]]
      .map(toNumber)
      .filter((n): n is number => n !== null && n > 0);
    if (nums.length === 3) {
      const sorted = [...nums].sort((a, b) => a - b);
      const thicknessMm = sorted[0];
      if (thicknessMm >= 0.3 && thicknessMm <= 150) {
        return {
          thicknessMm,
          dimensionsMm: { length: sorted[2], width: sorted[1] },
        };
      }
    }
  }
  const label = text.match(THICKNESS_LABEL_RE);
  const thicknessMm = label ? toNumber(label[1]) : null;
  return {
    thicknessMm:
      thicknessMm !== null && thicknessMm >= 0.3 && thicknessMm <= 150
        ? thicknessMm
        : null,
    dimensionsMm: null,
  };
}

/* ---------- material ---------- */

const MATERIAL_GRADE_RES: RegExp[] = [
  /\b(S(?:235|275|355|420|460|500|550|620|690|700|890|960)(?:J0|J2|JR|K2|MC|ML|NL|N|M|G3|W)?(?:\+(?:N|AR|M|Z))?)\b/,
  /\b(DC0[1-6]|DD1[1-4]|DX5[1-6]D(?:\+Z\d*)?|HX\d{3}[A-Z]{1,3}|HC\d{3}[A-Z]{1,3}|H\d{3}LA)\b/,
  /\b(1\.[0-9]{4})\b/,
  /\b(X\d{1,3}(?:Cr|Ni|Mn|Mo)[A-Za-z]*\d*(?:-\d+){0,3})\b/,
  /\b(HARDOX\s?\d{3}|STRENX\s?\d{3,4}[A-Z]*|DOMEX\s?\d{3}[A-Z]*|WELDOX\s?\d{3}|RAEX\s?\d{3}|CORTEN\s?[AB]?|COR-TEN\s?[AB]?)\b/i,
  /\b(AlMg(?:3|4[.,]5Mn|5)|AlMgSi\d*(?:[.,]\d)?|AlZnMgCu\d*|AlSi\d+|AlCuMg\d*|(?:EN\s?)?AW[- ]?\d{4}[A-Z]?)\b/,
  /\b(C45|C22|C60|16MnCr5|42CrMo4|34CrMo4|St\s?37(?:-\d)?|St\s?52(?:-\d)?|11\s?373|11\s?375|11\s?523)\b/,
  /\b(CuZn\d{2}(?:Pb\d)?|CW\d{3}[A-Z]|Cu-?ETP|Cu-?DHP|Ms\s?58|Ms\s?63)\b/,
];

const MATERIAL_WORD_RES: [RegExp, string][] = [
  [/\b(?:INOX|NIERDZ\w*|NEREZ\w*|STAINLESS|EDELSTAHL|ROSTFREI)\b/i, "stainless steel"],
  [/\b(?:ALUMINIUM|ALUMINUM|ALU|HLINÍK|HLINIK|HLINÍKOV\w*)\b/i, "aluminium"],
  [/\b(?:MOSIĄDZ|MOSADZ|BRASS|MESSING)\b/i, "brass"],
];

function readMaterial(text: string): { material: string | null; notes: string[] } {
  const found: { grade: string; index: number }[] = [];
  for (const re of MATERIAL_GRADE_RES) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) {
      found.push({ grade: m[1].replace(/\s+/g, " "), index: m.index ?? 0 });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const grades = unique(found.map((f) => f.grade));
  if (grades.length > 0) {
    const notes =
      grades.length > 1 ? [`Other material tokens: ${grades.slice(1).join(", ")}`] : [];
    return { material: grades[0], notes };
  }
  for (const [re, label] of MATERIAL_WORD_RES) {
    if (re.test(text)) return { material: label, notes: [] };
  }
  return { material: null, notes: [] };
}

/* ---------- weight ---------- */

const WEIGHT_LABEL_RE =
  /\b(?:WEIGHT|MASS|GEWICHT|MASSE|HMOTNOSŤ|HMOTNOST|MASA|WAGA|CIĘŻAR|CIEZAR)\s*[:=]?\s*(?:~|ca\.?|approx\.?)?\s*(\d{1,6}(?:[.,]\d{1,3})?)\s*(kg|g)\b/i;
const WEIGHT_ANY_RE = /\b(\d{1,6}(?:[.,]\d{1,3})?)\s*kg\b/i;

function readWeight(text: string): number | null {
  const label = text.match(WEIGHT_LABEL_RE);
  if (label) {
    const n = toNumber(label[1]);
    if (n !== null) return label[2].toLowerCase() === "g" ? n / 1000 : n;
  }
  const any = text.match(WEIGHT_ANY_RE);
  return any ? toNumber(any[1]) : null;
}

/* ---------- quantity (explicit label only) ---------- */

const QTY_LABEL_RE =
  /\b(?:QTY|QUANTITY|PCS|PIECES|ILOŚĆ|ILOSC|SZT|ANZAHL|STÜCK|STUECK|STK|MENGE|MNOŽSTVO|MNOZSTVO|POČET|POCET|KS)\b\.?\s*[:=]?\s*(\d{1,5})\b/i;
const QTY_TRAILING_RE = /\b(\d{1,5})\s*(?:pcs|pieces|szt\.?|ks|stk\.?|stück|off)\b/i;

function readQuantity(text: string): number | null {
  const m = text.match(QTY_LABEL_RE) ?? text.match(QTY_TRAILING_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ---------- tolerances ---------- */

const TOLERANCE_RES: RegExp[] = [
  /\b((?:STN\s?EN|PN-?EN|ČSN\s?EN|CSN\s?EN|DIN\s?EN|EN|ISO|DIN)\s?2768\s?-?\s?[a-zA-Z]{1,2}(?:\s?-\s?[a-zA-Z])?)\b/,
  /\b(ISO\s?8015)\b/,
  /\b((?:EN\s?)?ISO\s?13920\s?-?\s?[A-H]{1,2})\b/,
  /\b(ISO\s?2768)\b/,
];

function readTolerances(text: string): string | null {
  const found: string[] = [];
  for (const re of TOLERANCE_RES) {
    const m = text.match(re);
    if (m) {
      const label = m[1].replace(/\s+/g, " ").trim();
      if (!found.some((f) => f.includes("2768") && label.includes("2768"))) {
        found.push(label);
      }
    }
  }
  return found.length > 0 ? found.join(", ") : null;
}

/* ---------- finish ---------- */

const RAL_RE = /\bRAL\s?(\d{4})\b/i;
const FINISH_RES: [RegExp, string][] = [
  [/\b(?:POWDER[- ]?COAT\w*|MALOWAN\w*\s+PROSZKOW\w*|PROSZKOW\w*|PRÁŠKOV\w*|PRASKOV\w*|PULVERBESCHICHT\w*|KOMAXIT\w*)\b/i, "powder coating"],
  [/\b(?:HOT[- ]DIP\w*|GALVANI[SZ]\w*|ZINC[- ]?PLAT\w*|VERZINK\w*|OCYNK\w*|CYNKOWAN\w*|POZINK\w*|ZINKOVAN\w*|ŽÁROV\w*|ZAROV\w*)\b/i, "galvanised / zinc plated"],
  [/\b(?:ANODI[SZ]\w*|ANODOW\w*|ELOX\w*)\b/i, "anodised"],
  [/\b(?:BLAST\w*|ŚRUTOWAN\w*|SRUTOWAN\w*|PIASKOWAN\w*|TRYSKAN\w*|GESTRAHLT|SANDSTRAHL\w*)\b/i, "blasted"],
  [/\b(?:BRUSHED|SZCZOTKOWAN\w*|GEBÜRSTET|KARTÁČOVAN\w*|BROUŠEN\w*)\b/i, "brushed"],
  [/\b(?:PASSIVAT\w*|PASYWAC\w*|PASYWOW\w*|PICKL\w*|GEBEIZT|BEIZ\w*|TRAWION\w*|MOŘEN\w*|MOREN\w*)\b/i, "pickled / passivated"],
  [/\b(?:PAINT\w*|LAKIER\w*|LACKIER\w*|NÁTĚR\w*|NATER\w*)\b/i, "painted"],
  [/\b(?:UNTREATED|SUROW\w*|BEZ\s+OBRÓBKI|BEZ\s+POVRCH\w*|ROH|UNBEHANDELT)\b/i, "none (raw)"],
];

function readFinish(text: string): string | null {
  const ral = text.match(RAL_RE);
  for (const [re, label] of FINISH_RES) {
    if (re.test(text)) return ral ? `${label}, RAL ${ral[1]}` : label;
  }
  return ral ? `RAL ${ral[1]}` : null;
}

/* ---------- holes, chamfers, radii (notes) ---------- */

const HOLE_RE =
  /(?:^|[\s(])(?:n|ø|Ø|⌀|∅|DIA\.?)\s?(\d{1,3}(?:[.,]\d{1,2})?)\s*([HhFGJKfgjk]\d{1,2})?(?:\s*\(\s*(\d{1,3})\s*[x×]\s*\))?/g;
const CHAMFER_RE = /\b(\d{1,2}(?:[.,]\d)?)\s*[x×]\s*(\d{1,3}(?:[.,]\d)?)\s*°/g;
const RADIUS_RE = /\bR\s?(\d{1,3}(?:[.,]\d)?)\b/g;

function readCallouts(text: string): string[] {
  const notes: string[] = [];
  for (const m of text.matchAll(HOLE_RE)) {
    const size = toNumber(m[1]);
    if (size === null || size <= 0 || size > 500) continue;
    const fit = m[2] ? ` ${m[2].toUpperCase()}` : "";
    const count = m[3] ? ` (${m[3]}×)` : "";
    const fitHint = m[2] ? " — fit, machining" : "";
    notes.push(`Ø${m[1]}${fit}${count}${fitHint}`);
  }
  for (const m of text.matchAll(CHAMFER_RE)) {
    notes.push(`Chamfer ${m[1]}×${m[2]}°`);
  }
  const radii = unique(Array.from(text.matchAll(RADIUS_RE), (m) => `R${m[1]}`));
  if (radii.length > 0 && radii.length <= 6) {
    notes.push(`Radius callouts: ${radii.join(", ")}`);
  }
  return unique(notes);
}

/* ---------- bends ---------- */

const BEND_CONTEXT_RE =
  /\b(?:BEND\w*|BENT|OHYB\w*|OHÝB\w*|OHNUT\w*|GIĘC\w*|GIEC\w*|GIĘT\w*|GIET\w*|ZAGIĘ\w*|ZAGIE\w*|ZGIN\w*|FOLD\w*|ABKANT\w*|KANTUNG|GEKANTET|BIEG\w*|GEBOGEN|K-?FACTOR|BEND\s+LINE)\b/i;
const BEND_COUNT_RES: RegExp[] = [
  /\b(\d{1,2})\s*[x×]?\s*(?:BENDS?|OHYB\w*|OHÝB\w*|GIĘ\w*|GIE\w*|ZAGIĘ\w*|ZAGIE\w*|ABKANT\w*|KANTUNG\w*)\b/i,
  /\b(?:BENDS?|OHYBY|OHYBOV|GIĘCIA|GIECIA|ZAGIĘCIA|ZAGIECIA|ABKANTUNGEN)\s*[:=]?\s*(\d{1,2})\b/i,
];
const BEND_DIRECTION_RE =
  /\b(?:BEND|OHYB|GIĘCIE|GIECIE|ZAGIĘCIE|ZAGIECIE|ABKANT\w*)\s*(?:LINE\s*)?(UP|DOWN|GÓRA|GORA|DÓŁ|DOL|HORE|DOLE|OBEN|UNTEN)\b/gi;
/** An angle token that is not the second factor of a chamfer ("2x45 °"). */
const ANGLE_RE = /(?<![\dx×.,])(\d{1,3}(?:[.,]\d)?)\s*°(?!\s*C\b)/g;

function readAngles(text: string): number[] {
  const angles: number[] = [];
  for (const m of text.matchAll(ANGLE_RE)) {
    const a = toNumber(m[1]);
    if (a !== null && a > 0 && a < 180) angles.push(a);
  }
  return unique(angles);
}

function readBends(text: string): { bends: Suggestions["bends"]; notes: string[] } {
  const angles = readAngles(text);
  if (!BEND_CONTEXT_RE.test(text)) {
    return {
      bends: null,
      notes:
        angles.length > 0
          ? [`Angles seen: ${angles.map((a) => `${a}°`).join(", ")} (no bend context)`]
          : [],
    };
  }
  let count: number | null = null;
  for (const re of BEND_COUNT_RES) {
    const m = text.match(re);
    if (m) {
      count = Number(m[1]);
      break;
    }
  }
  const directions: BendDirection[] = [];
  for (const m of text.matchAll(BEND_DIRECTION_RE)) {
    const d = m[1].toUpperCase();
    directions.push(
      d === "UP" || d === "GÓRA" || d === "GORA" || d === "HORE" || d === "OBEN" ? "up" : "down"
    );
  }
  return {
    bends: {
      count,
      angles,
      ...(directions.length > 0 ? { directions } : {}),
    },
    notes: [],
  };
}

/* ---------- part number ---------- */

const ID_LIKE_RE = /^(?:\d{4,}[A-Za-z0-9_\-]*|[A-Za-z]{1,4}[-_]?\d{3,}[A-Za-z0-9_\-]*)$/;
const CAD_FILE_RE = /\b([A-Za-z0-9][A-Za-z0-9_\-]{2,})\.(?:ipt|iam|sldprt|sldasm|prt|par|psm|dwg|dxf|step|stp)\b/i;

function readPartNumber(text: string, partName?: string): string | null {
  if (partName) {
    const base = (partName.split(/[\\/]/).pop() ?? "")
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .trim();
    if (base && ID_LIKE_RE.test(base)) return base;
  }
  const cad = text.match(CAD_FILE_RE);
  if (cad) return cad[1];
  // A 5–8 digit token that repeats is almost always the drawing number.
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b(\d{5,8})\b/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const repeated = Array.from(counts).find(([, n]) => n >= 2);
  return repeated ? repeated[0] : null;
}

/* ---------- entry point ---------- */

/**
 * Read a Suggestions object from PDF text. Never throws; an empty or
 * unreadable text yields an empty suggestion with confidence "low".
 */
export function heuristicSuggestions(text: string, partName?: string): Suggestions {
  const out = emptySuggestions("heuristic");
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return out;

  out.partNumber = readPartNumber(flat, partName);

  const material = readMaterial(flat);
  out.material = material.material;

  const sheet = readSheet(flat);
  out.thicknessMm = sheet.thicknessMm;
  out.dimensionsMm = sheet.dimensionsMm;

  out.weightKg = readWeight(flat);
  out.quantity = readQuantity(flat);

  const threads = readThreads(flat);
  out.threads = threads.threads;

  const bends = readBends(flat);
  out.bends = bends.bends;

  out.finish = readFinish(flat);
  out.tolerances = readTolerances(flat);

  out.notes = unique([
    ...(sheet.dimensionsMm
      ? [`Blank ${sheet.dimensionsMm.length} × ${sheet.dimensionsMm.width} mm (title block)`]
      : []),
    ...material.notes,
    ...readCallouts(flat),
    ...bends.notes,
    ...threads.notes,
  ]);
  out.confidence = "low";
  return out;
}
