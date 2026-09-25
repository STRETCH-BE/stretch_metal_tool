/**
 * Generates public/downloads/stretchmetal-example.dxf — the example flat
 * pattern linked from the upload screen and the website export guide.
 * File path: /scripts/generate-example-dxf.mjs
 *
 * Plain Node ESM on purpose (no TypeScript, no imports from lib/) so it
 * runs with `node scripts/generate-example-dxf.mjs` anywhere. Writes a
 * 200 × 120 mm bracket (t = 3) on the published layer convention:
 *   CUT       outline with R5 corners (4 LINE + 4 ARC)
 *   HOLES     4 × Ø6.647 (ISO minor diameter of M8)
 *   BEND_UP   one bend line across the width at x = 70
 *   BEND_DOWN one bend line across the width at x = 130 (dashed layer)
 *   ENGRAVE   a short marking line
 *   WELD      a seam along the bottom edge
 * R12 dialect (AC1009: no handles) plus $INSUNITS = 4 so every CAD/CAM
 * reads it. The generated file is committed; re-run when the convention
 * changes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "public", "downloads", "stretchmetal-example.dxf");

const L = 200;
const W = 120;
const R = 5;
const HOLE_R = 6.647 / 2;

const lines = [];
const g = (code, value) => {
  lines.push(String(code).padStart(3, " "));
  lines.push(typeof value === "number" ? fmt(value) : value);
};
const fmt = (v) => {
  const s = v.toFixed(9).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.0`;
};
const point = (base, x, y) => {
  g(base, x);
  g(base + 10, y);
  g(base + 20, 0);
};
const line = (layer, x1, y1, x2, y2) => {
  g(0, "LINE");
  g(8, layer);
  point(10, x1, y1);
  point(11, x2, y2);
};
const arc = (layer, cx, cy, r, a0, a1) => {
  g(0, "ARC");
  g(8, layer);
  point(10, cx, cy);
  g(40, r);
  g(50, a0);
  g(51, a1);
};
const circle = (layer, cx, cy, r) => {
  g(0, "CIRCLE");
  g(8, layer);
  point(10, cx, cy);
  g(40, r);
};

const layers = [
  ["CUT", 7, "CONTINUOUS"],
  ["HOLES", 8, "CONTINUOUS"],
  ["BEND_UP", 1, "CONTINUOUS"],
  ["BEND_DOWN", 1, "DASHED"],
  ["WELD", 2, "CONTINUOUS"],
  ["ENGRAVE", 8, "CONTINUOUS"],
  ["IGNORE", 9, "CONTINUOUS"],
];

// HEADER
g(0, "SECTION");
g(2, "HEADER");
g(9, "$ACADVER");
g(1, "AC1009");
g(9, "$INSUNITS");
g(70, "4");
g(9, "$EXTMIN");
point(10, 0, 0);
g(9, "$EXTMAX");
point(10, L, W);
g(0, "ENDSEC");

// TABLES
g(0, "SECTION");
g(2, "TABLES");
g(0, "TABLE");
g(2, "LTYPE");
g(70, "2");
g(0, "LTYPE");
g(2, "CONTINUOUS");
g(70, "0");
g(3, "Solid line");
g(72, "65");
g(73, "0");
g(40, 0);
g(0, "LTYPE");
g(2, "DASHED");
g(70, "0");
g(3, "Dashed __ __ __");
g(72, "65");
g(73, "2");
g(40, 0.75);
g(49, 0.5);
g(49, -0.25);
g(0, "ENDTAB");
g(0, "TABLE");
g(2, "LAYER");
g(70, String(layers.length));
for (const [name, color, ltype] of layers) {
  g(0, "LAYER");
  g(2, name);
  g(70, "0");
  g(62, String(color));
  g(6, ltype);
}
g(0, "ENDTAB");
g(0, "ENDSEC");

// BLOCKS (empty)
g(0, "SECTION");
g(2, "BLOCKS");
g(0, "ENDSEC");

// ENTITIES
g(0, "SECTION");
g(2, "ENTITIES");
// Outline, counter-clockwise, R5 corners.
line("CUT", R, 0, L - R, 0);
arc("CUT", L - R, R, R, 270, 360);
line("CUT", L, R, L, W - R);
arc("CUT", L - R, W - R, R, 0, 90);
line("CUT", L - R, W, R, W);
arc("CUT", R, W - R, R, 90, 180);
line("CUT", 0, W - R, 0, R);
arc("CUT", R, R, R, 180, 270);
// Holes (M8 minor diameter).
for (const [x, y] of [
  [25, 25],
  [175, 25],
  [25, 95],
  [175, 95],
]) {
  circle("HOLES", x, y, HOLE_R);
}
// Bends across the full width.
line("BEND_UP", 70, 0, 70, W);
line("BEND_DOWN", 130, 0, 130, W);
// Marking and weld seam.
line("ENGRAVE", 90, 60, 110, 60);
line("WELD", 60, 0, 140, 0);
g(0, "ENDSEC");
g(0, "EOF");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\r\n") + "\r\n", "utf8");
console.log(`wrote ${outPath} (${lines.length / 2} groups)`);
