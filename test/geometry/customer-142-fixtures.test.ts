/**
 * Customer 142 fixtures — the German SolidWorks IFC4 exports (SCHE, LEIN,
 * Verblechung, Exsos logo, Stützenfuß), their OpenCASCADE mesh-to-STEP
 * conversions and the exact Stützenfuß STEPs, through splitModelSync,
 * against the true volumes computed with IfcOpenShell + OpenCASCADE.
 * File path: /test/geometry/customer-142-fixtures.test.ts
 *
 * The files are customer property and are NOT committed: unzip them into
 * test/fixtures/customer-142/ (ifc/, step-converted/,
 * stuetzenfuss-142-048-004/ with expected/*.dxf, expected/ifc-true-volumes.json)
 * and the suite runs; without the folder every case is skipped.
 *
 * Step 0 of the fix/ifc-mesh-import work: every part is recorded (name,
 * occurrences, triage, thickness, flat bbox, bends, holes, flat and solid
 * volume, true volume) as a table on stdout — the baseline for the PR
 * description — and the targets of the prompt are asserted:
 *   1. solidVolumeMm3 within 1 % of the true volume for every `part`;
 *      FLAT_MASS_MISMATCH gone where the flat is right, still raised on the
 *      two logo Innenteil parts (flat −12 %);
 *   2. the 12 Verblechung reference bodies and the logo sliver → red
 *      geometry.reference_body; the 3 logo unnamed parts → amber
 *      geometry.unnamed_body only; no flag on any `part`;
 *   3. each step-converted file gives the same parts as its IFC (thickness,
 *      bend count, hole count, flat bbox within 0.5 mm);
 *   4. Stützenfuß Pos 1 / Pos 2 flats against expected/*.dxf loop by loop;
 *   5. SCHE grouped to 39 parts, LEIN unchanged at 39.
 *
 * Assumed layout of ifc-true-volumes.json (the file was produced outside
 * this repository): either an array of { file, name, role, volumeMm3 } or
 * an object keyed by file name holding such arrays; `nameKey` is derived
 * (name lower-cased, everything but [a-z0-9] removed) when absent, and
 * duplicate keys match in file order. Roles: part | reference |
 * unnamed_part | sliver.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDxfSync } from "@/lib/geometry";
import { splitModelSync } from "@/lib/geometry/step/analyse";
import { decodeStepBytes } from "@/lib/geometry/step/part21";
import type { PartGeometry, SplitModel } from "@/lib/geometry/types";
import { evaluateDfmFlags } from "@/lib/pricing/dfm";
import { referenceBodyVerdict } from "@/lib/pricing/reference-body";

const DIR = path.join(process.cwd(), "test/fixtures/customer-142");
const LASER_BED_MM = 3000; // [CONFIRM] the flat laser's bed length of the machine park
const present = fs.existsSync(DIR);

type Expected = { file: string; name: string; nameKey: string; role: string; volumeMm3: number };

export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loadExpected(): Expected[] {
  const file = path.join(DIR, "expected/ifc-true-volumes.json");
  if (!fs.existsSync(file)) return [];
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const out: Expected[] = [];
  const take = (fileName: string, entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const name = String(e.name ?? "");
    const volume = Number(e.volumeMm3 ?? e.trueVolumeMm3 ?? e.volume ?? NaN);
    if (!name || !Number.isFinite(volume)) return;
    out.push({ file: String(e.file ?? fileName), name, nameKey: String(e.nameKey ?? nameKey(name)), role: String(e.role ?? "part"), volumeMm3: volume });
  };
  if (Array.isArray(raw)) for (const entry of raw) take("", entry);
  else if (raw && typeof raw === "object") for (const [fileName, list] of Object.entries(raw as Record<string, unknown>)) if (Array.isArray(list)) for (const entry of list) take(fileName, entry);
  return out;
}

function listFiles(sub: string, ext: RegExp): string[] {
  const dir = path.join(DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => ext.test(f)).sort();
}

function split(sub: string, file: string): SplitModel {
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, sub, file)));
  return splitModelSync(decodeStepBytes(bytes), { name: file.replace(/\.(ifc|stp|step)$/i, "") });
}

type Row = {
  file: string;
  name: string;
  occurrences: number;
  triage: string;
  reasons: string;
  thicknessMm: number | null;
  bbox: string;
  bends: number;
  bendLengths: string;
  holes: number;
  flatMm3: number | null;
  solidMm3: number | null;
  trueMm3: number | null;
  role: string | null;
  flags: string;
};

function rowsOf(sub: string, file: string, expected: Expected[]): { rows: Row[]; model: SplitModel } {
  const model = split(sub, file);
  const stem = file.replace(/\.(ifc|stp|step)$/i, "");
  const used = new Map<string, number>();
  const rows = model.parts.map((p): Row => {
    const g = p.geometry;
    const key = nameKey(p.name);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const candidates = expected.filter((e) => e.nameKey === key && (e.file === "" || nameKey(e.file).includes(nameKey(stem)) || nameKey(stem).includes(nameKey(e.file.replace(/\.(ifc|stp|step)$/i, "")))));
    const match = candidates[n] ?? candidates[0] ?? null;
    const flat = g.sheet?.isSheetMetal ? g.measures.netAreaMm2 * (g.sheet.thicknessMm || 0) : null;
    const verdict = referenceBodyVerdict(g.sheet?.bodyHints, LASER_BED_MM);
    const dfm = g.sheet ? evaluateDfmFlags({ partId: "p", itemId: "i", geometry: g, sheet: g.sheet, thicknessMm: g.sheet.thicknessMm || 1, kerfMm: null, tools: [] }).map((f) => f.code) : [];
    return {
      file: stem,
      name: p.name,
      occurrences: p.occurrences,
      triage: g.triage.state,
      reasons: g.triage.reasons.join(","),
      thicknessMm: g.material.thicknessMm,
      bbox: `${g.measures.bbox.width.toFixed(1)} × ${g.measures.bbox.height.toFixed(1)}`,
      bends: g.measures.bendLines.length,
      bendLengths: g.measures.bendLines.map((b) => Math.round(b.lengthMm)).join("/"),
      holes: g.measures.holes.length,
      flatMm3: flat === null ? null : Math.round(flat),
      solidMm3: g.sheet?.solidVolumeMm3 === null || g.sheet?.solidVolumeMm3 === undefined ? null : Math.round(g.sheet.solidVolumeMm3),
      trueMm3: match ? Math.round(match.volumeMm3) : null,
      role: match?.role ?? null,
      flags: [...(verdict ? [verdict.code] : []), ...dfm.filter((c) => c === "dfm.flat_mass_mismatch")].join(","),
    };
  });
  return { rows, model };
}

function printTable(rows: Row[]): void {
  const header = "| file | part | occ | triage | reasons | t | flat bbox | bends | bend lengths | holes | flat mm³ | 3D mm³ | true mm³ | role | flags |";
  const lines = rows.map((r) => `| ${r.file} | ${r.name} | ${r.occurrences} | ${r.triage} | ${r.reasons} | ${r.thicknessMm ?? "—"} | ${r.bbox} | ${r.bends} | ${r.bendLengths} | ${r.holes} | ${r.flatMm3 ?? "—"} | ${r.solidMm3 ?? "—"} | ${r.trueMm3 ?? "—"} | ${r.role ?? "—"} | ${r.flags} |`);
  console.log([header, "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...lines].join("\n"));
}

/** Loop-by-loop comparison with a reference flat DXF: same count, centroids within 0.2 mm, areas within 0.5 %. */
function compareToReference(g: PartGeometry, referenceDxf: string): void {
  const ref = analyzeDxfSync(fs.readFileSync(referenceDxf, "utf8"), { thicknessMm: g.material.thicknessMm ?? 4 });
  const closed = (x: PartGeometry) =>
    x.loops
      .filter((l) => l.closed && (l.kind === "outer" || l.kind === "hole"))
      .map((l) => ({ area: l.areaMm2, cx: (l.bbox.minX + l.bbox.maxX) / 2 - x.measures.bbox.minX, cy: (l.bbox.minY + l.bbox.maxY) / 2 - x.measures.bbox.minY }))
      .sort((a, b) => b.area - a.area || a.cx - b.cx || a.cy - b.cy);
  const ours = closed(g);
  const theirs = closed(ref);
  expect(ours).toHaveLength(theirs.length);
  const W = g.measures.bbox.width;
  const H = g.measures.bbox.height;
  const orientations = [
    (p: { cx: number; cy: number }) => p,
    (p: { cx: number; cy: number }) => ({ cx: W - p.cx, cy: p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: p.cx, cy: H - p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: W - p.cx, cy: H - p.cy }),
    (p: { cx: number; cy: number }) => ({ cx: p.cy, cy: p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: H - p.cy, cy: p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: p.cy, cy: W - p.cx }),
    (p: { cx: number; cy: number }) => ({ cx: H - p.cy, cy: W - p.cx }),
  ];
  const fits = orientations.some((o) => theirs.every((t) => ours.some((u) => Math.abs(u.area - t.area) <= Math.max(t.area, 1) * 0.005 && Math.hypot(o(u).cx - t.cx, o(u).cy - t.cy) <= 0.2)));
  expect(fits).toBe(true);
}

const expected = present ? loadExpected() : [];
const ifcFiles = present ? listFiles("ifc", /\.ifc$/i) : [];
const convertedFiles = present ? listFiles("step-converted", /\.ste?p$/i) : [];
const stuetzFiles = present ? listFiles("stuetzenfuss-142-048-004", /\.ste?p$/i) : [];

describe("customer 142 fixtures", () => {
  it.skipIf(!present)("baseline table: every file, every part", () => {
    const all: Row[] = [];
    for (const f of ifcFiles) all.push(...rowsOf("ifc", f, expected).rows);
    for (const f of convertedFiles) all.push(...rowsOf("step-converted", f, expected).rows);
    for (const f of stuetzFiles) all.push(...rowsOf("stuetzenfuss-142-048-004", f, expected).rows);
    printTable(all);
    expect(all.length).toBeGreaterThan(0);
  });

  it.skipIf(!present || expected.length === 0)("1. solid volume within 1 % of the true volume for every part; the mass check fires only on the logo trays", () => {
    for (const f of ifcFiles) {
      const { rows } = rowsOf("ifc", f, expected);
      for (const r of rows) {
        if (r.role !== "part" || r.trueMm3 === null) continue;
        expect(r.solidMm3, `${r.file} / ${r.name}: solid volume`).not.toBeNull();
        expect(Math.abs((r.solidMm3 as number) - r.trueMm3) / r.trueMm3, `${r.file} / ${r.name}: solid vs true`).toBeLessThanOrEqual(0.01);
        const innenteil = /innenteil/.test(nameKey(r.name));
        expect(r.flags.includes("dfm.flat_mass_mismatch"), `${r.file} / ${r.name}: mass check`).toBe(innenteil);
      }
    }
  });

  it.skipIf(!present || expected.length === 0)("2. reference bodies red, unnamed parts amber, parts clean", () => {
    for (const f of ifcFiles) {
      const { rows } = rowsOf("ifc", f, expected);
      for (const r of rows) {
        if (r.role === "reference" || r.role === "sliver") expect(r.flags, `${r.file} / ${r.name}`).toContain("geometry.reference_body");
        else if (r.role === "unnamed_part") expect(r.flags.split(",").filter((c) => c.startsWith("geometry.")), `${r.file} / ${r.name}`).toEqual(["geometry.unnamed_body"]);
        else if (r.role === "part") expect(r.flags.split(",").filter((c) => c.startsWith("geometry.")), `${r.file} / ${r.name}`).toEqual([]);
      }
    }
  });

  it.skipIf(!present || convertedFiles.length === 0)("3. each converted STEP gives the same parts as its IFC", () => {
    for (const conv of convertedFiles) {
      const stem = nameKey(conv.replace(/\.ste?p$/i, ""));
      const ifc = ifcFiles.find((f) => stem.includes(nameKey(f.replace(/\.ifc$/i, ""))) || nameKey(f.replace(/\.ifc$/i, "")).includes(stem));
      if (!ifc) continue;
      const a = rowsOf("step-converted", conv, expected).rows;
      const b = rowsOf("ifc", ifc, expected).rows;
      expect(a.length, conv).toBe(b.length);
      for (const ra of a) {
        const rb = b.find((x) => nameKey(x.name) === nameKey(ra.name)) ?? b[a.indexOf(ra)];
        expect(ra.thicknessMm, `${conv} / ${ra.name}: thickness`).toBe(rb.thicknessMm);
        expect(ra.bends, `${conv} / ${ra.name}: bends`).toBe(rb.bends);
        expect(ra.holes, `${conv} / ${ra.name}: holes`).toBe(rb.holes);
        const da = ra.bbox.split(" × ").map(Number);
        const db = rb.bbox.split(" × ").map(Number);
        expect(Math.abs(da[0] - db[0]), `${conv} / ${ra.name}: bbox`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(da[1] - db[1]), `${conv} / ${ra.name}: bbox`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it.skipIf(!present || stuetzFiles.length === 0)("4. Stützenfuß Pos 1 / Pos 2 flats, loop by loop against the expected DXFs", () => {
    const targets: Record<string, { w: number; h: number; bends: number[]; holes: number; area: number; dxf: string }> = {
      pos1: { w: 448.33, h: 291.33, bends: [240, 248], holes: 2, area: 120061, dxf: "Pos1" },
      pos2: { w: 488.33, h: 479.65, bends: [188, 248, 248], holes: 6, area: 163338, dxf: "Pos2" },
    };
    const expectedDir = path.join(DIR, "stuetzenfuss-142-048-004/expected");
    for (const f of stuetzFiles) {
      const model = split("stuetzenfuss-142-048-004", f);
      const key = /pos\s*1/i.test(f) ? "pos1" : /pos\s*2/i.test(f) ? "pos2" : null;
      const parts = key ? [model.parts[0]] : model.parts;
      if (!key) expect(parts.length, f).toBe(2);
      for (const p of parts) {
        const g = p.geometry;
        expect(g.triage.state, `${f} / ${p.name}`).toBe("green");
        const dims = [g.measures.bbox.width, g.measures.bbox.height].sort((a, b) => b - a);
        const t = key ? targets[key] : dims[0] > 470 ? targets.pos2 : targets.pos1;
        expect(Math.abs(dims[0] - Math.max(t.w, t.h)), `${f} / ${p.name}: flat`).toBeLessThanOrEqual(0.2);
        expect(Math.abs(dims[1] - Math.min(t.w, t.h)), `${f} / ${p.name}: flat`).toBeLessThanOrEqual(0.2);
        expect(g.measures.bendLines.map((b) => Math.round(b.lengthMm)).sort((a, b) => a - b), `${f} / ${p.name}: bends`).toEqual(t.bends);
        expect(g.measures.holes.filter((h) => Math.abs(h.diameterMm - 13) < 0.3), `${f} / ${p.name}: Ø13`).toHaveLength(t.holes);
        expect(Math.abs(g.measures.netAreaMm2 - t.area) / t.area, `${f} / ${p.name}: area`).toBeLessThanOrEqual(0.005);
        expect(Math.abs(g.sheet!.solidVolumeMm3! - g.sheet!.flatVolumeMm3) / g.sheet!.flatVolumeMm3, `${f} / ${p.name}: flat vs 3D`).toBeLessThanOrEqual(0.01);
        const dxf = fs.existsSync(expectedDir) ? fs.readdirSync(expectedDir).find((x) => /\.dxf$/i.test(x) && x.toLowerCase().includes(t.dxf.toLowerCase())) : undefined;
        if (dxf) compareToReference(g, path.join(expectedDir, dxf));
      }
    }
  });

  it.skipIf(!present)("5. SCHE grouped to 39 parts (Fassade 4 ×3, Fassade 8 ×3, Verbinder Rahmen ×4, Schiebestück ×2 ×2, Winkel Werbetafel ×2), LEIN unchanged", () => {
    const sche = ifcFiles.find((f) => /sche/i.test(f));
    const lein = ifcFiles.find((f) => /lein/i.test(f));
    if (sche) {
      const model = split("ifc", sche);
      expect(model.parts).toHaveLength(39);
      const occ = (name: RegExp) => model.parts.filter((p) => name.test(p.name)).map((p) => p.occurrences);
      expect(occ(/^fassade 4$/i)).toEqual([3]);
      expect(occ(/^fassade 8$/i)).toEqual([3]);
      expect(occ(/verbinder rahmen/i)).toEqual([4]);
      expect(occ(/schiebest.ck fenstersturz/i)).toEqual([2]);
      expect(occ(/schiebest.ck tropfkante/i)).toEqual([2]);
      expect(occ(/winkel werbetafel/i)).toEqual([2]);
      expect(model.parts.filter((p) => /tropfkante (links|rechts)/i.test(p.name))).toHaveLength(2);
    }
    if (lein) expect(split("ifc", lein).parts).toHaveLength(39);
  });
});
