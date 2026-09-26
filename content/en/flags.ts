/**
 * flags content (EN) — mirror of /content/flags.ts (same keys, same
 * `{param}` placeholders; test/intake/flags-content.test.ts checks both).
 * File path: /content/en/flags.ts
 */

import type { FlagsContent } from "@/content/flags";

export const flags: FlagsContent = {
  title: "Flags",
  severity: { green: "OK", amber: "Check", red: "Blocked" },
  triage: {
    green: {
      label: "Green",
      message: "The flat pattern is ready to price: closed outline, holes and bend lines recognised automatically.",
    },
    amber_bend_candidates: {
      label: "Lines to confirm",
      message:
        "There are {count} open lines inside the outline without a named layer. They may be bend lines, engraving or cuts.",
      action: "Tag these lines with one click below, or select them one by one in the viewer.",
    },
    amber_forming_unknown: {
      label: "Bent or rolled?",
      message:
        "The file has only an outline and holes, but the name or the PDF drawing suggests forming. Without bend lines only the cutting is priced.",
      action: "Say whether the part is flat, bent or rolled. Draw the bend lines in the viewer or attach the PDF.",
    },
    amber_units: {
      label: "Units",
      message:
        "The file declares no units ($INSUNITS) or is in inches. Dimensions ({units}) were taken as millimetres.",
      action: "Check an outline dimension and confirm, or calibrate the viewer with two clicks on a known dimension.",
    },
    red_drawing_sheet: {
      label: "Drawing sheet",
      message:
        "This looks like an assembly or workshop drawing (several views, dimensions, title block), not a 1:1 flat pattern.",
      action: "Pick the view that is the flat pattern, or enter the part manually. Best: ask the customer to export the flat pattern following the guide.",
    },
    red_no_closed_contour: {
      label: "No closed outline",
      message:
        "No closed outer contour could be built — the lines do not meet at their ends, or the file holds no geometry.",
      action: "Raise the join tolerance and re-analyse, fix the file in CAD, or enter the part manually.",
    },
  },
  triageReasons: {
    bend_layers_found: "Bend lines recognised from layer names ({bendLines})",
    no_interior_open_lines: "No open lines inside the outline",
    interior_open_lines: "{count} open lines inside the outline without a role",
    forming_hint_in_name: "The part name suggests bending or rolling",
    forming_hint_in_pdf: "The PDF drawing suggests bending or rolling",
    units_missing: "The file declares no units",
    units_inch: "Inch file — scaled ×{scaleApplied}",
    extents_mismatch: "Drawing extents ($EXTMAX) are {extentsRatio}× the geometry",
    dimension_text_heavy: "{dimensionTextCount} dimensions and texts on the sheet",
    multiple_view_clusters: "{clusterCount} separate outline groups (views)",
    no_closed_contour: "No closed outline found",
    multi_part: "The file holds {partCount} separate parts — the largest is priced",
  },
  healing: {
    title: "Geometry healing",
    nothing: "The geometry needed no healing.",
    tolerance: "tolerance {toleranceMm} mm",
    parts: {
      gaps: "joined {count} gaps",
      duplicates: "removed {count} duplicates",
      overlaps: "removed {count} overlapping segments",
      zeroLength: "removed {count} zero-length segments",
      splines: "flattened {count} splines",
      ellipses: "flattened {count} ellipses",
      blocks: "exploded {count} blocks",
      loopsClosed: "closed {count} loops",
    },
  },
  dropped: {
    title: "Dropped entities",
    empty: "Nothing was dropped.",
    item: "{type} × {count} (layer {layer}) — {reason}",
    reasons: {
      not_geometry: "not geometry",
      zero_length: "zero length",
      ignored_layer: "ignored layer",
      unsupported: "unsupported type",
    },
  },
  families: {
    mild_steel: "mild steel",
    stainless: "stainless steel",
    aluminium: "aluminium",
    brass: "brass",
    copper: "copper",
  },
  laserReasons: {
    in_house: "cut in-house",
    over_limit: "thickness above the laser limit",
    supplier_row: "only a supplier rate exists",
    no_machine: "no flat laser in the machine park",
    none: "no rate",
  },
  tubeLimits: {
    length: "length",
    wall: "wall thickness",
    envelope: "outer size",
    circumscribed: "circumscribed circle",
    kg_per_m: "mass per metre",
    raw_weight: "raw weight",
  },
  weldProcesses: {
    mig_mag: "MIG/MAG",
    tig: "TIG",
    laser: "laser",
    mma: "stick (MMA)",
  },
  flags: {
    "geometry.manual": {
      label: "Manual geometry",
      message: "Part entered by hand (quick part) — dimensions and holes do not come from a file.",
    },
    "geometry.triage_amber": {
      label: "Triage to confirm",
      message: "File state: {state}. To confirm: {count}. Answer the question in the triage panel.",
    },
    "geometry.triage_red": {
      label: "File not usable for pricing",
      message: "File state: {state}. Fix the file, pick the right view or enter the part manually.",
    },
    "geometry.units_unconfirmed": {
      label: "Units not confirmed",
      message: "File state: {state}. Confirm that the dimensions are in millimetres.",
    },
    "geometry.no_material": {
      label: "No material",
      message: "No material chosen, or the code “{code}” does not exist in the rate tables.",
    },
    "geometry.no_thickness": {
      label: "No thickness",
      message: "Enter the sheet thickness — without it mass, cutting and bending cannot be priced.",
    },
    "laser.thickness_over_limit": {
      label: "Subcontract — above the laser limit",
      message:
        "{thicknessMm} mm exceeds the {limitMm} mm limit of our laser for {family}. Cutting priced from the supplier rate {supplier} (row {rowThicknessMm} mm).",
    },
    "laser.subcontract": {
      label: "Subcontracted cutting",
      message:
        "Thickness {thicknessMm} mm priced from the supplier rate {supplier} (row {rowThicknessMm} mm): {reason}.",
    },
    "laser.no_rate_row": {
      label: "No cutting rate",
      message:
        "No cutting rate for {materialCode} {thicknessMm} mm (laser limit {limitMm} mm, {family}; {reason}). Add a row to the laser rate table.",
    },
    "laser.blank_exceeds_bed": {
      label: "Blank does not fit the bed",
      message:
        "Blank {blankLengthMm} × {blankWidthMm} mm does not fit the {bedLengthMm} × {bedWidthMm} mm bed of {machine} (edge margin {edgeMarginMm} mm).",
    },
    "laser.slow_contours": {
      label: "Small contours",
      message:
        "{count} small contours (< {thresholdMm} mm, {lengthMm} mm in total) priced with factor {factor} — the laser slows down on small holes.",
    },
    "material.no_price": {
      label: "No material price",
      message: "Material {code} has no price per kg for thickness {thicknessMm} mm.",
    },
    "material.mass_handling": {
      label: "Heavy part",
      message: "Part mass {massKg} kg exceeds {limitKg} kg — consider a handling surcharge of {surchargeEur} €.",
    },
    "bend.force_over_limit": {
      label: "Bend force above the press limit",
      message:
        "Bend {bendId}: needs {forceKN} kN, the press brake has {limitKN} kN (length {lengthMm} mm, thickness {thicknessMm} mm, die V {dieVMm} mm, Rm {rmNmm2} N/mm²).",
    },
    "bend.length_over_limit": {
      label: "Bend too long",
      message: "Bend {bendId}: length {lengthMm} mm exceeds the press limit of {limitMm} mm.",
    },
    "bend.hole_crosses_bend": {
      label: "Hole crosses the bend line",
      message: "Bend {bendId}: {count} holes lie on the bend line — they will deform.",
    },
    "bend.hole_near_bend": {
      label: "Hole close to a bend",
      message: "Bend {bendId}: {count} holes within {distanceMm} mm of the bend line (minimum {minMm} mm).",
    },
    "bend.short_flange": {
      label: "Short flange",
      message:
        "Bend {bendId}: flange {flangeMm} mm is shorter than the minimum {minMm} mm (die V {dieVMm} mm, radius {radiusMm} mm).",
    },
    "bend.no_rate_row": {
      label: "No bending rate",
      message: "Bend {bendId}: no rate for thickness {thicknessMm} mm and length {lengthMm} mm.",
    },
    "roll.radius_too_small": {
      label: "Roll radius too small",
      message: "Radius {radiusMm} mm is below the rolling machine minimum of {minRadiusMm} mm.",
    },
    "roll.axis_too_long": {
      label: "Rolling too wide",
      message: "Axis length {axisLengthMm} mm exceeds the rolling machine width of {maxWidthMm} mm.",
    },
    "roll.thickness_over_limit": {
      label: "Rolling — thickness above the limit",
      message: "Thickness {thicknessMm} mm exceeds the rolling machine limit of {maxThicknessMm} mm — rolling is subcontracted.",
    },
    "roll.no_rate_row": {
      label: "No rolling rate",
      message: "No rolling rate for thickness {thicknessMm} mm and radius {radiusMm} mm.",
    },
    "weld.no_rate_row": {
      label: "No welding rate",
      message: "Seam {weldId}: no rate for process {process} and bead {beadMm} mm.",
    },
    "weld.min_order_applied": {
      label: "Welding minimum order",
      message: "Welding value {totalBefore} € raised to the minimum order {minOrder} € (+{shortfall} €).",
    },
    "tube.over_limit": {
      label: "Profile beyond the tube laser",
      message: "Item {index} ({profileFamily}): {what} = {value} exceeds the limit {limit} for {family}.",
    },
    "tube.no_rate_row": {
      label: "No tube cutting rate",
      message: "Item {index}: no rate for profile {profileFamily} with wall {wallMm} mm.",
    },
    "thread.no_rate_row": {
      label: "No thread rate",
      message: "Thread {size} × {count}: no price in the thread rate table.",
    },
    "feature.no_rate_row": {
      label: "No feature rate",
      message: "Extra operation {code} (item {index}): no price in the rate table.",
    },
    "finish.no_rate_row": {
      label: "No finish rate",
      message: "Finish {code} (item {index}): no price in the finish rate table.",
    },
    "finish.minimum_applied": {
      label: "Finish batch minimum",
      message: "Finish {code}: batch cost {batchBefore} € raised to the minimum {minimum} € ({batchCost} €).",
    },
    "rates.placeholder": {
      label: "Placeholder rates",
      message: "{count} of the rates used are [CONFIRM] placeholders — confirm them in the rate tables before sending.",
    },
  },
};
