/**
 * guide content (EN) — mirror of /content/guide.ts.
 * File path: /content/en/guide.ts
 */

import type { GuideContent } from "@/content/guide";

export const guide: GuideContent = {
  title: "DXF export guide",
  meta: {
    title: "How to prepare a DXF for a quote",
    description: "Exporting a 1:1 flat pattern from Inventor, SolidWorks, Fusion 360 and AutoCAD, the recognised layer names, a checklist and an example file.",
  },
  hero: {
    eyebrow: "Guide",
    title: "A good DXF is",
    titleAccent: "a quote in a minute.",
    lead: "The StretchMetal quoting tool reads the sheet-metal flat pattern straight from the file: outline, holes, bend lines. One file = one part, 1:1 scale in millimetres, bend lines on named layers — and the quote prices itself.",
    downloadExample: "Download the example DXF",
    login: "Sign in to the tool",
    website: "stretchmetal.pl",
  },
  why: {
    eyebrow: "Why a flat pattern",
    title: "Flat pattern, not a drawing",
    body: "The laser cuts flat sheet, so the quote needs the flat pattern, not a workshop drawing with views and dimensions. From the flat pattern we compute cut length, pierces, mass and the blank; from the bend lines — the number of bends and the press-brake force.",
    points: [
      "1:1 scale in millimetres — no scaled views.",
      "Geometry only: no dimensions, title block, frame or text.",
      "One part per file; upload assemblies as separate files.",
      "Bend lines on a layer named as in the table below — then they are recognised automatically.",
      "Give bend angles, threads, finish and quantity in an attached PDF with the same name.",
    ],
  },
  cad: {
    eyebrow: "Export from CAD",
    title: "Step by step",
    intro: "Every common CAD system exports a flat pattern to DXF. Below are the paths we verified — after exporting, open the file in a DXF viewer and make sure only the outline and bend lines are visible.",
    systems: [
      {
        key: "inventor",
        name: "Autodesk Inventor",
        steps: [
          "Open the sheet-metal part and switch to Flat Pattern.",
          "File → Save Copy As → DXF format.",
          "In the export options tick the Bend Up / Bend Down layers (IV_BEND, IV_BEND_DOWN) and Outer / Interior Profiles; Tangent Lines and Arc Centers may stay on — they are ignored.",
          "File version: AutoCAD 2018 (AC1032) or 2004; units millimetres.",
        ],
        note: "Inventor writes the layers IV_OUTER_PROFILE, IV_INTERIOR_PROFILES, IV_BEND and IV_BEND_DOWN — our reference case, nothing to change.",
      },
      {
        key: "solidworks",
        name: "SolidWorks",
        steps: [
          "In the feature tree right-click Flat-Pattern → Export to DXF/DWG.",
          "In DXF/DWG Output choose Sheet metal, tick Geometry and Bend lines; untick Sketches, Library features and Forming tools.",
          "Output alignment: no mirroring; units mm; version R2013 or R14.",
          "Save as .dxf (not .dwg).",
        ],
        note: "SolidWorks puts bend lines on the BEND LINES / BENDLINES layer — both names are recognised.",
      },
      {
        key: "fusion",
        name: "Autodesk Fusion 360",
        steps: [
          "Sheet Metal → Create Flat Pattern.",
          "In flat-pattern mode: Export Flat Pattern as DXF.",
          "Tick Bend lines (and Bend extents when offered); set units to mm.",
          "Save the file and check that the outline is closed.",
        ],
        note: "Fusion writes bend lines to the BEND / BEND_UP and BEND_DOWN layers.",
      },
      {
        key: "autocad",
        name: "AutoCAD and other 2D CAD",
        steps: [
          "Draw the flat pattern at 1:1 in millimetres on layer CUT or 0.",
          "Put bend lines on layer BEND (bend up) or BEND_DOWN (bend down), as single lines from edge to edge.",
          "Delete the frame, title block, dimensions and texts, or leave them on layers DIM*, TEXT*, FRAME, TITLE* — those are skipped.",
          "Save As → DXF (AutoCAD 2018 ASCII DXF or R12/LT2 DXF).",
        ],
        note: "Set INSUNITS = 4 (millimetres); without it the tool asks you to confirm the units.",
      },
      {
        key: "dwg",
        name: "Only have a DWG?",
        steps: [
          "Open the file in AutoCAD, DraftSight, LibreCAD or another DWG editor.",
          "File → Save As → file type “AutoCAD DXF” (ASCII).",
          "Upload the .dxf — the tool does not read DWG.",
        ],
        note: "Binary DXF is not supported either — choose the ASCII variant.",
      },
    ],
  },
  layers: {
    eyebrow: "Layers",
    title: "Recognised layer names",
    intro: "The layer name decides the role of a line before any geometry heuristic runs. Case does not matter. Anything not in the table goes to cutting (closed contours) or to the question “are these lines bends, engraving or cuts?” (open lines inside the outline).",
    columns: { role: "Role", layers: "Layer names" },
    roles: {
      bendUp: "Bend up",
      bendDown: "Bend down",
      ignore: "Ignored",
      engrave: "Engraving / marking",
      weld: "Weld seam",
      cut: "Cut",
    },
    prefixNote: "An asterisk is a prefix: DIM* matches DIM, DIMENSIONS, DIM_1.",
    caseNote: "Layer 0 (AutoCAD's default) counts as cut.",
  },
  checklist: {
    eyebrow: "Checklist",
    title: "Before you send the file",
    items: [
      "1:1 scale, millimetres ($INSUNITS = 4).",
      "Flat pattern only — no folded views, isometrics or sections.",
      "No dimensions, title block, frame or text (or on ignored layers).",
      "One part per file; file name = part number.",
      "Closed outline — lines meet at their ends (0.01 mm tolerance).",
      "Bend lines on layer BEND / BEND_UP / BEND_DOWN, edge to edge.",
      "A PDF with bend angles, threads, finish and quantity — same name as the DXF.",
    ],
  },
  pdf: {
    eyebrow: "PDF drawing",
    title: "Attach the PDF",
    body: "From a PDF drawing with the same name as the DXF (e.g. 200005.pdf with 200005.dxf) we read the title block and callouts. Every value read is only a suggestion — the sales person confirms it.",
    items: [
      "Material and thickness (e.g. S355, 15 mm) from the title block.",
      "Bend angles and directions.",
      "Threads (M8, M10×1) and their count.",
      "Finish: powder coating with a RAL number, zinc plating, deburring.",
      "Quantity and part weight.",
    ],
  },
  example: {
    eyebrow: "Example",
    title: "Example DXF",
    body: "A 200 × 120 mm bracket, 3 mm thick: the outline with R5 corners on layer CUT, four M8 holes on HOLES, one bend up and one bend down, an engraving line and a weld seam. Open it in your CAD to see what a quotable file looks like.",
    download: "Download stretchmetal-example.dxf",
    fileName: "stretchmetal-example.dxf",
  },
  footer: {
    login: "Sign in",
    loginHelp: "The quoting tool is for StretchMetal staff. Customers send files by e-mail or through the form on the website.",
    back: "Back to the tool",
  },
};
