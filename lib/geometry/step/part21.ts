/**
 * Geometry engine — ISO 10303-21 ("STEP Part 21") file reader.
 * File path: /lib/geometry/step/part21.ts
 *
 * Turns the text of a .step / .stp file into a map of entity instances
 * (`#12 = CARTESIAN_POINT('', (0., 0., 0.));`) with their arguments parsed
 * into a small value tree. Nothing here knows about geometry: brep.ts
 * evaluates the instances, analyse.ts turns them into a PartGeometry.
 *
 * Decisions:
 *   - Hand-written scanner, no regular expressions over the whole file:
 *     customer files reach tens of MB and a backtracking pattern would
 *     stall the upload route. One pass finds the DATA section, one pass
 *     splits it into instances (a `;` outside a string ends one), and
 *     each instance's argument list is parsed by recursive descent.
 *   - Strings keep the Part 21 escape rules that matter for names
 *     (`''` → `'`); \X2\ unicode escapes are left as written — names are
 *     informational only.
 *   - Complex instances (`#5 = ( A(...) B(...) C(...) );`, used for the
 *     representation context with its units and for rational B-splines)
 *     are kept as a list of (type, args) parts; `part(instance, "TYPE")`
 *     finds one of them, and `type` is "" for such instances.
 *   - `$` (unset) becomes null, `*` (derived) becomes { derived: true };
 *     enumerations `.T.` become { enum: "T" }; typed values such as
 *     LENGTH_MEASURE(5.) become { type, args }.
 *   - Instance ids are unique per file by the standard; a duplicate keeps
 *     the last definition and the count is reported in `warnings`.
 *   - Nothing throws for a damaged instance: it is skipped and counted in
 *     `warnings`, so a partly written file still yields its usable
 *     bodies (the caller decides whether the result is trustworthy).
 */

export type StepRef = { ref: number };
export type StepEnum = { enum: string };
export type StepDerived = { derived: true };
export type StepTyped = { type: string; args: StepValue[] };
export type StepValue = number | string | null | StepRef | StepEnum | StepDerived | StepTyped | StepValue[];

export type StepPart = { type: string; args: StepValue[] };

export type StepInstance = {
  id: number;
  /** Entity type in upper case; "" for a complex (multi-type) instance. */
  type: string;
  args: StepValue[];
  /** The parts of a complex instance, in file order (empty for a simple one). */
  complex: StepPart[];
};

export type StepHeader = {
  /** FILE_SCHEMA entry, e.g. "AUTOMOTIVE_DESIGN" (AP214) or "AP203" style names. */
  schema: string | null;
  /** FILE_NAME first argument (the exporter's file name). */
  fileName: string | null;
  /** FILE_NAME originating system, when present. */
  originatingSystem: string | null;
};

export type StepFile = {
  header: StepHeader;
  instances: Map<number, StepInstance>;
  /** Instance ids by simple type (upper case) and by each part type of a complex instance. */
  byType: Map<string, number[]>;
  warnings: string[];
};

export class StepFormatError extends Error {
  constructor(message = "Not a STEP file: no ISO-10303-21 header found") {
    super(message);
    this.name = "StepFormatError";
  }
}

const HEAD_RE = /^\s*(﻿)?ISO-10303-21\s*;/;

/** True when the text starts like a Part 21 exchange file. */
export function isStepText(text: string): boolean {
  return HEAD_RE.test(text.slice(0, 64));
}

export function decodeStepBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/* ─── Value helpers ─────────────────────────────────────────── */

export function isRef(v: StepValue): v is StepRef {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "ref" in v;
}
export function isEnum(v: StepValue): v is StepEnum {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "enum" in v;
}
export function isTyped(v: StepValue): v is StepTyped {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "type" in v;
}
export function isList(v: StepValue): v is StepValue[] {
  return Array.isArray(v);
}
export function asNumber(v: StepValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isTyped(v as StepValue) && (v as StepTyped).args.length === 1) return asNumber((v as StepTyped).args[0]);
  return null;
}
export function asString(v: StepValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}
export function asRef(v: StepValue | undefined): number | null {
  return v !== undefined && isRef(v) ? v.ref : null;
}
export function asRefs(v: StepValue | undefined): number[] {
  if (v === undefined || !isList(v)) return [];
  const out: number[] = [];
  for (const item of v) if (isRef(item)) out.push(item.ref);
  return out;
}
export function asNumbers(v: StepValue | undefined): number[] {
  if (v === undefined || !isList(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = asNumber(item);
    if (n !== null) out.push(n);
  }
  return out;
}
export function asBool(v: StepValue | undefined): boolean | null {
  if (v === undefined || !isEnum(v)) return null;
  if (v.enum === "T") return true;
  if (v.enum === "F") return false;
  return null;
}

/** The (type, args) of a simple instance, or the named part of a complex one. */
export function part(inst: StepInstance, type: string): StepPart | null {
  if (inst.type === type) return { type: inst.type, args: inst.args };
  for (const p of inst.complex) if (p.type === type) return p;
  return null;
}

export function hasType(inst: StepInstance, type: string): boolean {
  return part(inst, type) !== null;
}

/* ─── Scanner ───────────────────────────────────────────────── */

class Cursor {
  pos = 0;
  constructor(
    readonly text: string,
    readonly end: number
  ) {}
  peek(): string {
    return this.text[this.pos] ?? "";
  }
  skipWs(): void {
    const t = this.text;
    while (this.pos < this.end) {
      const ch = t[this.pos];
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
        this.pos++;
      } else if (ch === "/" && t[this.pos + 1] === "*") {
        const close = t.indexOf("*/", this.pos + 2);
        this.pos = close < 0 ? this.end : close + 2;
      } else {
        break;
      }
    }
  }
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}
function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}
function isNumStart(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || ch === "-" || ch === "+" || ch === ".";
}

function readIdent(c: Cursor): string {
  const start = c.pos;
  while (c.pos < c.end && isIdentChar(c.text[c.pos])) c.pos++;
  return c.text.slice(start, c.pos).toUpperCase();
}

function readString(c: Cursor): string {
  // c.pos is at the opening quote.
  c.pos++;
  let out = "";
  const t = c.text;
  while (c.pos < c.end) {
    const ch = t[c.pos];
    if (ch === "'") {
      if (t[c.pos + 1] === "'") {
        out += "'";
        c.pos += 2;
        continue;
      }
      c.pos++;
      return out;
    }
    out += ch;
    c.pos++;
  }
  return out;
}

function readNumber(c: Cursor): number | null {
  const start = c.pos;
  const t = c.text;
  if (t[c.pos] === "+" || t[c.pos] === "-") c.pos++;
  while (c.pos < c.end && t[c.pos] >= "0" && t[c.pos] <= "9") c.pos++;
  if (t[c.pos] === ".") {
    c.pos++;
    while (c.pos < c.end && t[c.pos] >= "0" && t[c.pos] <= "9") c.pos++;
  }
  if (t[c.pos] === "E" || t[c.pos] === "e") {
    c.pos++;
    if (t[c.pos] === "+" || t[c.pos] === "-") c.pos++;
    while (c.pos < c.end && t[c.pos] >= "0" && t[c.pos] <= "9") c.pos++;
  }
  const raw = t.slice(start, c.pos);
  if (raw === "" || raw === "." || raw === "-" || raw === "+") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readValue(c: Cursor): StepValue {
  c.skipWs();
  const ch = c.peek();
  if (ch === "#") {
    c.pos++;
    const n = readNumber(c);
    return { ref: n ?? -1 };
  }
  if (ch === "'") return readString(c);
  if (ch === "$") {
    c.pos++;
    return null;
  }
  if (ch === "*") {
    c.pos++;
    return { derived: true };
  }
  if (ch === ".") {
    // Enumeration .T. / .MILLI. — but ".5" is a number.
    const next = c.text[c.pos + 1] ?? "";
    if (next >= "0" && next <= "9") return readNumber(c) ?? 0;
    c.pos++;
    const start = c.pos;
    while (c.pos < c.end && c.text[c.pos] !== ".") c.pos++;
    const name = c.text.slice(start, c.pos).toUpperCase();
    c.pos++; // closing dot
    return { enum: name };
  }
  if (ch === "(") return readList(c);
  if (isNumStart(ch)) return readNumber(c) ?? 0;
  if (isIdentStart(ch)) {
    const name = readIdent(c);
    c.skipWs();
    if (c.peek() === "(") return { type: name, args: readList(c) };
    return { enum: name };
  }
  // Unknown character: skip it so the parser always makes progress.
  c.pos++;
  return null;
}

function readList(c: Cursor): StepValue[] {
  // c.pos is at "(".
  c.pos++;
  const out: StepValue[] = [];
  for (;;) {
    c.skipWs();
    const ch = c.peek();
    if (ch === "" || c.pos >= c.end) return out;
    if (ch === ")") {
      c.pos++;
      return out;
    }
    if (ch === ",") {
      c.pos++;
      continue;
    }
    out.push(readValue(c));
  }
}

/** Parse the right-hand side of `#id = <rhs>` (simple or complex instance). */
function readInstanceBody(text: string, start: number, end: number): { type: string; args: StepValue[]; complex: StepPart[] } | null {
  const c = new Cursor(text, end);
  c.pos = start;
  c.skipWs();
  if (c.peek() === "(") {
    // Complex instance: ( TYPE(args) TYPE(args) ... )
    c.pos++;
    const parts: StepPart[] = [];
    for (;;) {
      c.skipWs();
      const ch = c.peek();
      if (ch === "" || c.pos >= c.end || ch === ")") break;
      if (!isIdentStart(ch)) {
        c.pos++;
        continue;
      }
      const type = readIdent(c);
      c.skipWs();
      const args = c.peek() === "(" ? readList(c) : [];
      parts.push({ type, args });
    }
    if (parts.length === 0) return null;
    return { type: "", args: [], complex: parts };
  }
  if (!isIdentStart(c.peek())) return null;
  const type = readIdent(c);
  c.skipWs();
  const args = c.peek() === "(" ? readList(c) : [];
  return { type, args, complex: [] };
}

/** Index of the next `;` outside a string literal, or -1. */
function findStatementEnd(text: string, from: number, end: number): number {
  let inString = false;
  for (let i = from; i < end; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === ";") return i;
    else if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return -1;
      i = close + 1;
    }
  }
  return -1;
}

function findSection(text: string, name: "HEADER" | "DATA"): { start: number; end: number } | null {
  const open = new RegExp(`(^|[\\s;])${name}\\s*;`);
  const m = open.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const closeIdx = text.indexOf("ENDSEC", start);
  return { start, end: closeIdx < 0 ? text.length : closeIdx };
}

function parseHeader(text: string): StepHeader {
  const header: StepHeader = { schema: null, fileName: null, originatingSystem: null };
  const sec = findSection(text, "HEADER");
  if (!sec) return header;
  let pos = sec.start;
  for (let guard = 0; guard < 64; guard++) {
    const semi = findStatementEnd(text, pos, sec.end);
    if (semi < 0) break;
    const body = readInstanceBody(text, pos, semi);
    pos = semi + 1;
    if (!body) continue;
    if (body.type === "FILE_SCHEMA") {
      const list = body.args[0];
      const first = isList(list) ? list[0] : null;
      header.schema = asString(first ?? null);
    } else if (body.type === "FILE_NAME") {
      header.fileName = asString(body.args[0]);
      header.originatingSystem = asString(body.args[5]);
    }
  }
  return header;
}

/**
 * Parse a Part 21 file. Throws StepFormatError only when the text is not a
 * STEP file at all (no ISO-10303-21 header or no DATA section).
 */
export function parseStep(text: string): StepFile {
  if (!isStepText(text)) throw new StepFormatError();
  const data = findSection(text, "DATA");
  if (!data) throw new StepFormatError("Not a STEP file: no DATA section found");

  const instances = new Map<number, StepInstance>();
  const byType = new Map<string, number[]>();
  const warnings: string[] = [];
  let duplicates = 0;
  let damaged = 0;

  const index = (type: string, id: number) => {
    const list = byType.get(type);
    if (list) list.push(id);
    else byType.set(type, [id]);
  };

  let pos = data.start;
  while (pos < data.end) {
    const hash = text.indexOf("#", pos);
    if (hash < 0 || hash >= data.end) break;
    const semi = findStatementEnd(text, hash, data.end);
    if (semi < 0) {
      damaged++;
      break;
    }
    // "#id = body"
    const c = new Cursor(text, semi);
    c.pos = hash + 1;
    const id = readNumber(c);
    c.skipWs();
    if (id === null || c.peek() !== "=") {
      damaged++;
      pos = semi + 1;
      continue;
    }
    const body = readInstanceBody(text, c.pos + 1, semi);
    pos = semi + 1;
    if (!body) {
      damaged++;
      continue;
    }
    if (instances.has(id)) duplicates++;
    const inst: StepInstance = { id, type: body.type, args: body.args, complex: body.complex };
    instances.set(id, inst);
    if (inst.type) index(inst.type, id);
    for (const p of inst.complex) index(p.type, id);
  }

  if (duplicates) warnings.push(`${duplicates} duplicate instance id(s); the last definition wins`);
  if (damaged) warnings.push(`${damaged} unreadable instance(s) skipped`);
  return { header: parseHeader(text), instances, byType, warnings };
}
