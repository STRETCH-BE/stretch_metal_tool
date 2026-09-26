/**
 * Minimal .xlsx reader — no dependencies (CLAUDE.md: never add packages).
 * File path: /scripts/lib/xlsx.mjs
 *
 * A workbook is a zip of XML parts. This reads the central directory,
 * inflates the parts it needs (node:zlib), and turns every worksheet into
 * rows keyed by the header row. Supported cell types: shared strings,
 * inline strings, numbers (dates stay serial numbers), booleans, formula
 * cells (their cached <v>), errors (null). ZIP64 and encrypted workbooks
 * are not (a rate workbook is a few sheets). Header = the first row with
 * two or more text cells; a header cell's text is trimmed; empty rows are
 * dropped.
 */

import { inflateRawSync } from "node:zlib";

/* ─── zip ─────────────────────────────────────────────────── */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Map of entry name → Buffer for every file in the archive. */
export function readZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < entries; n += 1) {
    if (buffer.readUInt32LE(offset) !== SIG_CENTRAL) throw new Error(`bad central directory entry at ${offset}`);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error(`bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`unsupported compression method ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/* ─── xml helpers ─────────────────────────────────────────── */

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return code in ENTITIES ? ENTITIES[code] : whole;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
}

/** Text of every <t> inside a fragment (rich-text runs concatenated). */
function textOf(fragment) {
  let text = "";
  for (const m of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(m[1]);
  return text;
}

/** "AB" → 27 (0-based 27? no: A=0, B=1, …, AA=26). */
export function columnIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) throw new Error(`bad cell reference ${ref}`);
  return { col: columnIndex(m[1]), row: parseInt(m[2], 10) };
}

/* ─── workbook ────────────────────────────────────────────── */

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml");
  if (!xml) return [];
  const out = [];
  for (const m of xml.toString("utf8").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(textOf(m[1]));
  return out;
}

function sheetTargets(entries) {
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("not an xlsx workbook (xl/workbook.xml missing)");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const byId = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) byId.set(a.Id, a.Target);
  }
  const sheets = [];
  for (const m of workbook.toString("utf8").matchAll(/<sheet\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? a.id;
    const target = byId.get(rid);
    if (!a.name || !target) continue;
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    sheets.push({ name: a.name, path });
  }
  return sheets;
}

/** Sparse grid: Map<rowNumber, Map<colIndex, value>>. */
function parseSheet(xml, strings) {
  const grid = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(m[1]);
    if (!a.r) continue;
    const body = m[2] ?? "";
    const { col, row } = parseCellRef(a.r);
    let value;
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
    switch (a.t) {
      case "s":
        value = v ? strings[parseInt(v[1], 10)] ?? "" : "";
        break;
      case "inlineStr":
        value = textOf(body);
        break;
      case "str":
        value = v ? unescapeXml(v[1]) : "";
        break;
      case "b":
        value = v ? v[1] === "1" : null;
        break;
      case "e":
        value = null;
        break;
      default:
        value = v ? Number(v[1]) : undefined;
        if (typeof value === "number" && !Number.isFinite(value)) value = v ? unescapeXml(v[1]) : undefined;
    }
    if (value === undefined) continue;
    if (!grid.has(row)) grid.set(row, new Map());
    grid.get(row).set(col, value);
  }
  return grid;
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Rows keyed by header. The header row is the first row with at least two
 * text cells (a one-cell title or note above it is skipped); every later
 * row with at least one non-blank cell becomes a record. Cells under a
 * blank header are ignored; headers are trimmed.
 */
export function gridToRecords(grid) {
  const rowNumbers = [...grid.keys()].sort((a, b) => a - b);
  // The header is the first row with at least two text cells: a sheet may
  // start with a one-cell title and a one-cell explanation above it.
  const textCells = (n) => [...grid.get(n).values()].filter((v) => typeof v === "string" && v.trim() !== "").length;
  let headerRowNumber = rowNumbers.find((n) => textCells(n) >= 2) ?? rowNumbers.find((n) => textCells(n) >= 1) ?? null;
  if (headerRowNumber === null) return { headers: [], records: [] };
  const headerCells = grid.get(headerRowNumber);
  const headers = [];
  for (const [col, value] of headerCells) {
    if (isBlank(value)) continue;
    headers.push({ col, name: String(value).trim() });
  }
  headers.sort((a, b) => a.col - b.col);
  const records = [];
  for (const n of rowNumbers) {
    if (n <= headerRowNumber) continue;
    const cells = grid.get(n);
    const record = {};
    let any = false;
    for (const h of headers) {
      const value = cells.get(h.col);
      record[h.name] = isBlank(value) ? null : value;
      if (!isBlank(value)) any = true;
    }
    if (any) records.push({ row: n, values: record });
  }
  return { headers: headers.map((h) => h.name), records };
}

/**
 * Read a workbook buffer → { sheets: Map<name, { headers, records }> }.
 * Sheet names are kept exactly (they are table names in the rate workbook).
 */
export function readWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const strings = sharedStrings(entries);
  const sheets = new Map();
  for (const { name, path } of sheetTargets(entries)) {
    const xml = entries.get(path);
    if (!xml) throw new Error(`sheet ${name}: part ${path} missing`);
    sheets.set(name, gridToRecords(parseSheet(xml.toString("utf8"), strings)));
  }
  return { sheets };
}
