# Geometry engine (`lib/geometry`)

Pure TypeScript, no Next/Supabase/env imports, every internal import is
relative (`./types`, `./math`, …) so the folder can be lifted out as-is.
Units: mm, mm², kg, degrees. Deterministic: no `Date`, no random.

## Pipeline

```
parseDxf  →  normalise  →  heal  →  buildLoops  →  classify  →  measure  →  evaluateTriage
parse.ts     normalise.ts  heal.ts  loops.ts        classify.ts  measure.ts   triage.ts
```

| Stage | What it does |
|---|---|
| `parse.ts` | `dxf-parser` wrapper. LINE, ARC, CIRCLE, LWPOLYLINE/POLYLINE (bulges → exact arcs), SPLINE (NURBS/fit points, adaptive ≤ 0.05 mm), ELLIPSE (flattened), INSERT (exploded recursively with translate/scale/rotate). Header: `$ACADVER`, `$INSUNITS` (1 inch → ×25.4, 0/missing → unknown), `$EXTMIN/MAX`, layer names. Everything else (POINT, TEXT, DIMENSION, HATCH, …) is counted by type + layer from a raw scan of the ENTITIES section (dxf-parser skips unknown types silently). Throws `DxfFormatError` only when there is no `SECTION` group. |
| `normalise.ts` | Layer conventions → `roleFromLayer`; ignored layers and zero-length entities go to `dropped`; stable ids (`ids.ts`, FNV-1a of type + coordinates at 0.001 mm). |
| `heal.ts` | Snap free endpoints within `toleranceMm` (default 0.01, max 0.5) with a grid hash; drop exact duplicates (direction independent); drop LINEs fully inside a collinear LINE of the same layer role. Parallel lines further than the tolerance are never merged. |
| `loops.ts` | Chain by endpoints; at branches continue with the smallest turning angle. Exact areas (shoelace + signed circular segments), exact arc lengths, true arc bbox, flattened points, circle detection (CIRCLE, or radius spread < 1 %). Near-closed chains within tolerance are closed (`loopsClosed`). |
| `classify.ts` | Role overrides > layer role > geometry. Containment tree of closed loops; frames (top-level rectangle around a part with holes) are ignored; each remaining top-level loop is a part group (`partIndex`, 0 = largest = `outerLoopId`); nested loops are holes; open chains inside a part are candidates (`unknown`) unless the layer says bend/weld/engrave or the user tagged them — an open line on a cut layer or layer `0` is still a candidate; outside → noise/ignore. |
| `measure.ts` | Cut length (outer + holes, only cut/hole roles), pierces, bbox, blank (+2 × margin), areas (islands add back), mass = area·t·ρ/1e9, holes with thread suggestions (`threads.ts`), bend lines from bend-role entities, smallest contour, slow contours (< 10 × t), engrave length. |
| `annotate.ts` | Applies `PartAnnotations`: deletions, scale/mirror (ids kept), role overrides, drawn bends, weld effective lengths (`length × bead/pitch × sides`), thread confirmations; re-runs chain/classify/measure/triage. Answered amber questions turn green. |
| `quick-part.ts` | Manual part → rectangle + grid of holes + drawn bend annotations + roll; runs the same pipeline. |
| `export-dxf.ts` | Annotated R12 ASCII DXF on layers CUT/HOLES/BEND_UP/BEND_DOWN/WELD/ENGRAVE/IGNORE; round-trips through `analyzeDxf`. |
| `svg.ts` | Path strings (Y flipped, arcs as `A`), `viewBoxFor`, standalone `<svg>` for thumbnails (light/dark). |
| `engine.ts` | `TsGeometryEngine implements GeometryEngine`; `analyzeDxfSync` never throws on garbage DXF (returns `red_no_closed_contour` with `triage.details.parseError`). `index.ts` exports everything plus `geometryEngine`. |

## Swapping in a Python service

Everything the app touches goes through the `GeometryEngine` interface in
`types.ts` (`analyzeDxf`, `applyAnnotations`, `quickPart`,
`exportAnnotatedDxf`). A Python `ezdxf` + `shapely` implementation only has
to return the same `PartGeometry` JSON (`version: 1`) over HTTP; write a
class implementing the interface that POSTs the DXF text and options, and
export it from `index.ts` as `geometryEngine` instead of `TsGeometryEngine`.
Entity ids must be computed the same way (`ids.ts`: FNV-1a over
`TYPE|segment keys` with coordinates rounded to 0.001 mm) so stored
annotations keep re-attaching.

## Layer conventions (`layer-conventions.ts`, case-insensitive, `*` = prefix)

| Role | Layers |
|---|---|
| bend up | `IV_BEND`, `BEND`, `BEND_UP`, `BEND LINES`, `BENDLINES`, `BEND-UP`, `BENDUP` |
| bend down | `IV_BEND_DOWN`, `BEND_DOWN`, `BEND-DOWN`, `BENDDOWN` |
| ignore | `IV_TANGENT`, `IV_ARC_CENTERS`, `IV_FEATURE_PROFILES`, `IV_FEATURE_PROFILES_DOWN`, `IV_UNCONSUMED_SKETCHES`, `DEFPOINTS`, `DIM*`, `TEXT*`, `FRAME`, `TITLE*` |
| engrave | `ENGRAVE`, `MARK`, `ETCH`, `IV_ENGRAVE` |
| weld | `WELD`, `WELD_SEAM` |
| cut | `IV_OUTER_PROFILE`, `IV_INTERIOR_PROFILES`, `CUT`, `0` |

Ignored-layer entities are removed before chaining and listed in
`dropped` with reason `ignored_layer` — they are never priced.

## Triage (`triage.ts`), first match wins

| State | Rule (thresholds are exported constants) |
|---|---|
| `red_no_closed_contour` | no closed loop / parse failure |
| `red_drawing_sheet` | dropped DIMENSION + TEXT + MTEXT ≥ 8 (`DIMENSION_TEXT_THRESHOLD`), or ≥ 3 separated closed-loop clusters (`VIEW_CLUSTER_THRESHOLD`, bboxes neither overlap nor nest), or `$EXTMAX − $EXTMIN` size vs geometry size ratio > 3 on an axis (`EXTENTS_RATIO_THRESHOLD`; offsets are ignored — Inventor writes extents from the origin) |
| `amber_units` | `$INSUNITS` missing/0, or inch (already scaled ×25.4) — until `annotations.unitsConfirmed` |
| `amber_bend_candidates` | open chains with role `unknown` inside the outline; `candidateEntityIds` lists them |
| `amber_forming_unknown` | no bend lines and no interior open lines, and the name or PDF text contains a forming stem (`FORMING_HINT_STEMS`: bend/bent/fold/kant/roll/ohyb/biegen/walc/zwijan/gięc/gięt/giąć — "plech" is not one) — until forming/roll/bends are given |
| `green` | reason `bend_layers_found` or `no_interior_open_lines` |

`multi_part` is appended to the reasons of any state when `partCount > 1`.

## Tests

`npx vitest run test/geometry lib/geometry` — customer fixtures
(`test/fixtures/200005.dxf`, `200164.dxf`) with the numbers from the build
prompt, synthetic DXFs built with `test/geometry/dxf-builder.ts`, export
round-trip, quick part, SVG, annotations, and the downloadable example
(`public/downloads/stretchmetal-example.dxf`, regenerated with
`node scripts/generate-example-dxf.mjs`).
