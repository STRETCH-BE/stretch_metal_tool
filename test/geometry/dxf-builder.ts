/**
 * Test helper — builds ASCII DXF text from entity specs.
 * File path: /test/geometry/dxf-builder.ts
 *
 * Minimal AC1015-style writer so synthetic fixtures live next to the
 * assertions instead of as opaque files. Only what the tests need:
 * header variables, a layer table, blocks with entities, and the entity
 * types the engine parses plus the non-geometry ones triage counts.
 */

export type P = { x: number; y: number };

export type EntitySpec =
  | { type: "LINE"; layer?: string; start: P; end: P; linetype?: string }
  | { type: "ARC"; layer?: string; center: P; radius: number; startDeg: number; endDeg: number }
  | { type: "CIRCLE"; layer?: string; center: P; radius: number }
  | { type: "LWPOLYLINE"; layer?: string; vertices: (P & { bulge?: number })[]; closed?: boolean }
  | { type: "POLYLINE"; layer?: string; vertices: (P & { bulge?: number })[]; closed?: boolean }
  | {
      type: "SPLINE";
      layer?: string;
      degree: number;
      controlPoints: P[];
      knots: number[];
      /** Group 41 per control point (rational spline); omitted = non-rational. */
      weights?: number[];
      closed?: boolean;
      periodic?: boolean;
    }
  | { type: "ELLIPSE"; layer?: string; center: P; majorAxis: P; ratio: number; startParam?: number; endParam?: number }
  | { type: "INSERT"; layer?: string; name: string; position: P; xScale?: number; yScale?: number; rotation?: number }
  | { type: "POINT"; layer?: string; position: P }
  | { type: "TEXT"; layer?: string; position: P; text: string }
  | { type: "MTEXT"; layer?: string; position: P; text: string }
  | { type: "DIMENSION"; layer?: string }
  | { type: "HATCH"; layer?: string }
  | { type: "RAW"; groups: [number, string | number][] };

export type BlockSpec = { name: string; base?: P; entities: EntitySpec[] };

export type DxfSpec = {
  version?: string;
  /** null = omit $INSUNITS entirely */
  insunits?: number | null;
  extmin?: P | null;
  extmax?: P | null;
  layers?: string[];
  blocks?: BlockSpec[];
  entities: EntitySpec[];
  /** Line ending, CRLF by default like Inventor. */
  eol?: string;
};

function fmt(v: number): string {
  const s = v.toFixed(9).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.0`;
}

export function buildDxf(spec: DxfSpec): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    out.push(String(code).padStart(3, " "));
    out.push(typeof value === "number" ? fmt(value) : value);
  };
  const pt = (base: number, p: P) => {
    g(base, p.x);
    g(base + 10, p.y);
    g(base + 20, 0);
  };
  let handle = 0x100;
  const h = () => (handle++).toString(16).toUpperCase();

  const writeEntity = (e: EntitySpec) => {
    if (e.type === "RAW") {
      for (const [c, v] of e.groups) g(c, v);
      return;
    }
    const layer = e.layer ?? "0";
    g(0, e.type);
    g(5, h());
    g(8, layer);
    switch (e.type) {
      case "LINE":
        if (e.linetype) g(6, e.linetype);
        pt(10, e.start);
        pt(11, e.end);
        break;
      case "ARC":
        pt(10, e.center);
        g(40, e.radius);
        g(50, e.startDeg);
        g(51, e.endDeg);
        break;
      case "CIRCLE":
        pt(10, e.center);
        g(40, e.radius);
        break;
      case "LWPOLYLINE":
        g(90, String(e.vertices.length));
        g(70, e.closed ? "1" : "0");
        for (const v of e.vertices) {
          g(10, v.x);
          g(20, v.y);
          if (v.bulge) g(42, v.bulge);
        }
        break;
      case "POLYLINE":
        g(66, "1");
        g(70, e.closed ? "1" : "0");
        for (const v of e.vertices) {
          g(0, "VERTEX");
          g(8, layer);
          g(10, v.x);
          g(20, v.y);
          g(30, 0);
          if (v.bulge) g(42, v.bulge);
        }
        g(0, "SEQEND");
        g(8, layer);
        break;
      case "SPLINE": {
        let flags = 8;
        if (e.closed) flags |= 1;
        if (e.periodic) flags |= 2;
        if (e.weights) flags |= 4;
        g(70, String(flags));
        g(71, String(e.degree));
        g(72, String(e.knots.length));
        g(73, String(e.controlPoints.length));
        g(74, "0");
        for (const k of e.knots) g(40, k);
        for (const wt of e.weights ?? []) g(41, wt);
        for (const c of e.controlPoints) pt(10, c);
        break;
      }
      case "ELLIPSE":
        pt(10, e.center);
        pt(11, e.majorAxis);
        g(40, e.ratio);
        g(41, e.startParam ?? 0);
        g(42, e.endParam ?? Math.PI * 2);
        break;
      case "INSERT":
        g(2, e.name);
        pt(10, e.position);
        g(41, e.xScale ?? 1);
        g(42, e.yScale ?? 1);
        g(43, 1);
        g(50, e.rotation ?? 0);
        break;
      case "POINT":
        pt(10, e.position);
        break;
      case "TEXT":
        pt(10, e.position);
        g(40, 2.5);
        g(1, e.text);
        break;
      case "MTEXT":
        pt(10, e.position);
        g(40, 2.5);
        g(1, e.text);
        break;
      case "DIMENSION":
        g(2, "*D1");
        pt(10, { x: 0, y: 0 });
        pt(11, { x: 0, y: 0 });
        g(70, "0");
        g(1, "<>");
        break;
      case "HATCH":
        g(2, "SOLID");
        g(70, "1");
        g(71, "0");
        g(91, "0");
        break;
    }
  };

  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, spec.version ?? "AC1015");
  if (spec.insunits !== null) {
    g(9, "$INSUNITS");
    g(70, String(spec.insunits ?? 4));
  }
  if (spec.extmin !== null) {
    g(9, "$EXTMIN");
    pt(10, spec.extmin ?? { x: 0, y: 0 });
  }
  if (spec.extmax !== null && spec.extmax !== undefined) {
    g(9, "$EXTMAX");
    pt(10, spec.extmax);
  }
  g(0, "ENDSEC");

  const layers = new Set<string>(["0", ...(spec.layers ?? [])]);
  for (const e of spec.entities) if ("layer" in e && e.layer) layers.add(e.layer);
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, String(layers.size));
  for (const l of layers) {
    g(0, "LAYER");
    g(5, h());
    g(100, "AcDbSymbolTableRecord");
    g(100, "AcDbLayerTableRecord");
    g(2, l);
    g(70, "0");
    g(62, "7");
    g(6, "Continuous");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "BLOCKS");
  for (const b of spec.blocks ?? []) {
    g(0, "BLOCK");
    g(5, h());
    g(8, "0");
    g(2, b.name);
    g(70, "0");
    pt(10, b.base ?? { x: 0, y: 0 });
    g(3, b.name);
    for (const e of b.entities) writeEntity(e);
    g(0, "ENDBLK");
    g(5, h());
    g(8, "0");
  }
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const e of spec.entities) writeEntity(e);
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join(spec.eol ?? "\r\n") + (spec.eol ?? "\r\n");
}

/* ─── Shape helpers ──────────────────────────────────────── */

/** Four LINEs, counter-clockwise from (x, y). `gapMm` shortens the last line. */
export function rectLines(x: number, y: number, w: number, h: number, layer = "0", gapMm = 0): EntitySpec[] {
  return [
    { type: "LINE", layer, start: { x, y }, end: { x: x + w, y } },
    { type: "LINE", layer, start: { x: x + w, y }, end: { x: x + w, y: y + h } },
    { type: "LINE", layer, start: { x: x + w, y: y + h }, end: { x, y: y + h } },
    { type: "LINE", layer, start: { x, y: y + h }, end: { x, y: y + gapMm } },
  ];
}

export function circle(cx: number, cy: number, r: number, layer = "0"): EntitySpec {
  return { type: "CIRCLE", layer, center: { x: cx, y: cy }, radius: r };
}

export function line(x1: number, y1: number, x2: number, y2: number, layer = "0", linetype?: string): EntitySpec {
  return { type: "LINE", layer, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, linetype };
}

/** A rounded rectangle as 4 LINE + 4 ARC (like an Inventor flat pattern). */
export function roundedRect(x: number, y: number, w: number, h: number, r: number, layer = "0"): EntitySpec[] {
  return [
    { type: "LINE", layer, start: { x: x + r, y }, end: { x: x + w - r, y } },
    { type: "ARC", layer, center: { x: x + w - r, y: y + r }, radius: r, startDeg: 270, endDeg: 360 },
    { type: "LINE", layer, start: { x: x + w, y: y + r }, end: { x: x + w, y: y + h - r } },
    { type: "ARC", layer, center: { x: x + w - r, y: y + h - r }, radius: r, startDeg: 0, endDeg: 90 },
    { type: "LINE", layer, start: { x: x + w - r, y: y + h }, end: { x: x + r, y: y + h } },
    { type: "ARC", layer, center: { x: x + r, y: y + h - r }, radius: r, startDeg: 90, endDeg: 180 },
    { type: "LINE", layer, start: { x, y: y + h - r }, end: { x, y: y + r } },
    { type: "ARC", layer, center: { x: x + r, y: y + r }, radius: r, startDeg: 180, endDeg: 270 },
  ];
}
