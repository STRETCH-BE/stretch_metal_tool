/**
 * Pricing engine — shared types (the contract between the rate tables in
 * Supabase, the pure pricing functions, the quote UI and the PDF).
 * File path: /lib/pricing/types.ts
 *
 * Money: every amount in this module is EUR as a plain number, unrounded.
 * Conversion to the quote currency and rounding to 0.01 happen at the
 * display/PDF boundary only (lib/money.ts). Lengths mm, areas mm²,
 * masses kg, times minutes. No `any` (lint enforces it).
 *
 * The engine never reads rates from anywhere but the `RateSnapshot` and
 * `MachinePark` passed in — those are loaded from the rate version the
 * quote is pinned to, so old quotes re-price identically.
 */

import type {
  PartAnnotations,
  PartGeometry,
  WeldProcess,
} from "@/lib/geometry/types";

/* ─── Rate tables (one active version at a time) ─────────── */

export type MaterialFamily =
  | "mild_steel"
  | "stainless"
  | "aluminium"
  | "brass"
  | "copper";

export type ThicknessBandPrice = {
  /** Band applies to thickness ≤ maxThicknessMm (bands sorted ascending). */
  maxThicknessMm: number;
  pricePerKg: number;
};

export type MaterialRate = {
  code: string;
  name: string;
  family: MaterialFamily;
  densityKgM3: number;
  /** Tensile strength Rm (N/mm²) for the press-brake force check. */
  rmNmm2: number;
  pricePerKg: ThicknessBandPrice[];
  sheetFormats: { lengthMm: number; widthMm: number }[];
  scrapPctDefault: number;
  placeholder: boolean;
};

export type LaserRate = {
  materialCode: string;
  thicknessMm: number;
  mode: "time" | "per_m";
  /** m/min — required for mode "time". */
  speedMMin: number | null;
  /** seconds per pierce — required for mode "time". */
  pierceS: number | null;
  /** €/m — required for mode "per_m" (and for subcontract rows). */
  pricePerM: number | null;
  pricePerPierce: number;
  gas: "O2" | "N2" | "air" | null;
  /** Contours smaller than this trigger the slow-contour factor. */
  minContourMm: number | null;
  inHouse: boolean;
  supplier: string | null;
  placeholder: boolean;
};

export type TubeLaserRate = {
  profileFamily: "round" | "square" | "rectangular" | "open";
  wallMm: number;
  pricePerMCut: number;
  handlingPerPart: number;
  setup: number;
  placeholder: boolean;
};

export type BendRate = {
  thicknessMm: number;
  /** Bend length ≤ lengthClassMm (classes sorted ascending). */
  lengthClassMm: number;
  pricePerBend: number;
  setupPerPartType: number;
  placeholder: boolean;
};

export type RollRate = {
  thicknessMm: number;
  /** Radius ≤ radiusClassMm (classes sorted ascending). */
  radiusClassMm: number;
  pricePerM: number;
  setup: number;
  placeholder: boolean;
};

export type WeldRate = {
  process: WeldProcess;
  beadMm: number;
  pricePerMm: number;
  setup: number;
  /** Minimum order value for welding-only quotes. */
  minOrder: number;
  placeholder: boolean;
};

export type ThreadRate = {
  /** "M8", "M10x1", … */
  size: string;
  priceEach: number;
  placeholder: boolean;
};

export type FeatureRate = {
  code: string;
  name: string;
  priceEach: number;
  placeholder: boolean;
};

export type FinishUnit = "m2" | "kg" | "m" | "each";

export type FinishRate = {
  /** "powder", "zinc", "deburr", … */
  code: string;
  name: string;
  unit: FinishUnit;
  price: number;
  minimum: number;
  placeholder: boolean;
};

export type GeneralRate = {
  machineRateEurH: number;
  labourRateEurH: number;
  machiningRateEurH: number;
  /** Margin on price, percent (30 = 30 %). */
  defaultMarginPct: number;
  /** Optional per customer_class override of the default margin. */
  marginByClass: Record<string, number>;
  blankMarginMm: number;
  slowContourFactor: number;
  /** Default stitch pattern when the user does not specify one. */
  defaultStitch: { beadLengthMm: number; pitchMm: number };
  /** Handling surcharge suggestion above this mass (kg). */
  handlingMassLimitKg: number;
  handlingSurchargeEur: number;
  /** Welding-only quotes: handling cost per customer-supplied part. */
  weldHandlingPerPart: number;
  placeholder: boolean;
};

export type RateSnapshot = {
  versionId: string;
  label: string;
  materials: MaterialRate[];
  laser: LaserRate[];
  tubeLaser: TubeLaserRate[];
  bend: BendRate[];
  roll: RollRate[];
  weld: WeldRate[];
  thread: ThreadRate[];
  feature: FeatureRate[];
  finish: FinishRate[];
  general: GeneralRate;
};

/* ─── Machine park (limits as data, never constants) ─────── */

export type FlatLaserLimits = {
  bedLengthMm: number;
  bedWidthMm: number;
  zMm: number;
  edgeMarginMm: number;
  maxThicknessMm: Record<MaterialFamily, number>;
};

export type TubeLaserLimits = {
  maxRoundDiameterMm: number;
  maxRectSideMm: number;
  maxCircumscribedMm: number;
  maxLengthMm: number;
  maxKgPerM: number;
  maxRawWeightKg: number;
  /** [mode A, mode B] — the lower value is used for the feasibility check. */
  wallThicknessMm: Record<MaterialFamily, [number, number]>;
};

export type PressBrakeLimits = {
  forceKN: number;
  bendLengthMm: number;
  betweenColumnsMm: number;
  openHeightMm: number;
  /** Multiplier for the default die: V = dieFactor × t. */
  dieFactor: number;
};

export type RollLimits = {
  maxWidthMm: number;
  minRadiusMm: number;
  maxThicknessMm: number;
};

export type WeldLimits = {
  processes: WeldProcess[];
};

export type MachineKind =
  | "flat_laser"
  | "tube_laser"
  | "press_brake"
  | "roll"
  | "weld";

export type Machine =
  | { code: string; name: string; kind: "flat_laser"; limits: FlatLaserLimits }
  | { code: string; name: string; kind: "tube_laser"; limits: TubeLaserLimits }
  | {
      code: string;
      name: string;
      kind: "press_brake";
      limits: PressBrakeLimits;
    }
  | { code: string; name: string; kind: "roll"; limits: RollLimits }
  | { code: string; name: string; kind: "weld"; limits: WeldLimits };

export type MachinePark = Machine[];

/* ─── Quote input ─────────────────────────────────────────── */

export type QuoteType = "fabrication" | "welding_only";

/** Operations the user adds by hand on top of the geometry-driven ones. */
export type ExtraOperation =
  | { type: "machining"; minutes: number; note: string | null }
  | { type: "feature"; code: string; count: number }
  | { type: "finish"; code: string; maskingMinutes: number; note: string | null }
  | {
      type: "tube_cut";
      profileFamily: TubeLaserRate["profileFamily"];
      wallMm: number;
      cutLengthMm: number;
      metres: number;
      pricePerMTube: number | null;
    }
  | { type: "other"; label: string; unitCost: number }
  | { type: "handling"; unitCost: number };

export type PricingPart = {
  id: string;
  name: string;
  source: PartGeometry["source"];
  materialCode: string | null;
  thicknessMm: number | null;
  geometry: PartGeometry;
  annotations: PartAnnotations;
};

export type PricingItem = {
  id: string;
  partId: string;
  qty: number;
  extras: ExtraOperation[];
  /** Scrap override for this item (percent), else material default. */
  scrapPct: number | null;
};

/** Welding-only quotes: seams listed manually or marked on a drawing. */
export type WeldingOnlySeam = {
  id: string;
  label: string;
  process: WeldProcess;
  beadMm: number;
  lengthMm: number;
  pattern: "full" | "stitch";
  stitch: { beadLengthMm: number; pitchMm: number } | null;
  sides: 1 | 2;
  qty: number;
};

export type QuoteInput = {
  type: QuoteType;
  /** Margin on price, percent. */
  marginPct: number;
  customerClass: string | null;
  items: PricingItem[];
  parts: PricingPart[];
  weldingOnly: {
    seams: WeldingOnlySeam[];
    partsCount: number;
  } | null;
};

/* ─── Output ──────────────────────────────────────────────── */

export type OperationType =
  | "laser_cut"
  | "subcontract_cutting"
  | "tube_cut"
  | "material"
  | "bend"
  | "roll"
  | "weld"
  | "thread"
  | "feature"
  | "machining"
  | "finish_powder"
  | "finish_zinc"
  | "finish_deburr"
  | "finish_other"
  | "engrave"
  | "handling"
  | "setup"
  | "other";

export type DriverUnit =
  | "m"
  | "mm"
  | "pierce"
  | "kg"
  | "bend"
  | "min"
  | "m2"
  | "each"
  | "part"
  | "lot";

export type RateRef = {
  /** Which table the rate came from. */
  table:
    | "rate_laser"
    | "rate_tube_laser"
    | "materials"
    | "rate_bend"
    | "rate_roll"
    | "rate_weld"
    | "rate_thread"
    | "rate_feature"
    | "rate_finish"
    | "rate_general"
    | "manual";
  /** Key of the row used, e.g. "S355/15" or "mig_mag/4". */
  key: string;
  /** Snapshot of the numbers used — for the audit trail. */
  values: Record<string, number | string | boolean | null>;
};

export type OperationLine = {
  id: string;
  type: OperationType;
  /** Content key or free label for the breakdown row. */
  label: string;
  driverQty: number;
  driverUnit: DriverUnit;
  rateRef: RateRef;
  /** Cost per part (setup already spread over qty). */
  unitCost: number;
  /** Cost of setup included in unitCost × qty (for the "setup" totals). */
  setupShare: number;
  auto: boolean;
  notes: string | null;
  /** Free-form numbers for the UI (time minutes, force N, …). */
  details: Record<string, number | string | boolean | null>;
};

export type FlagSeverity = "green" | "amber" | "red";

export type FlagCode =
  | "geometry.manual"
  | "geometry.triage_amber"
  | "geometry.triage_red"
  | "geometry.units_unconfirmed"
  | "geometry.no_material"
  | "geometry.no_thickness"
  | "laser.thickness_over_limit"
  | "laser.blank_exceeds_bed"
  | "laser.no_rate_row"
  | "laser.slow_contours"
  | "laser.subcontract"
  | "material.no_price"
  | "material.mass_handling"
  | "bend.force_over_limit"
  | "bend.length_over_limit"
  | "bend.hole_near_bend"
  | "bend.hole_crosses_bend"
  | "bend.short_flange"
  | "bend.no_rate_row"
  | "roll.radius_too_small"
  | "roll.axis_too_long"
  | "roll.thickness_over_limit"
  | "roll.no_rate_row"
  | "weld.no_rate_row"
  | "weld.min_order_applied"
  | "tube.over_limit"
  | "tube.no_rate_row"
  | "thread.no_rate_row"
  | "feature.no_rate_row"
  | "finish.no_rate_row"
  | "finish.minimum_applied"
  | "rates.placeholder";

export type Flag = {
  code: FlagCode;
  severity: FlagSeverity;
  partId: string | null;
  itemId: string | null;
  /** Numbers for the localized message (limit, value, …). */
  params: Record<string, number | string>;
  /** Amber flags are overridable with a note; red ones block sending. */
  overridable: boolean;
};

export type PricedItem = {
  itemId: string;
  partId: string;
  qty: number;
  operations: OperationLine[];
  unitCost: number;
  unitPrice: number;
  batchCost: number;
  batchPrice: number;
  flags: Flag[];
};

export type TotalsByType = Partial<
  Record<OperationType, { cost: number; price: number }>
>;

export type PricedQuote = {
  items: PricedItem[];
  /** Welding-only block (also used when welding is shown separately). */
  welding: {
    operations: OperationLine[];
    cost: number;
    price: number;
    minOrderApplied: boolean;
  } | null;
  totalsByType: TotalsByType;
  subtotalCost: number;
  subtotalPrice: number;
  marginPct: number;
  /** Equivalent markup on cost, percent. */
  markupPct: number;
  flags: Flag[];
  /** True when any rate used is still a placeholder ([CONFIRM]). */
  usesPlaceholderRates: boolean;
  rateVersionId: string;
};

/* ─── Helpers shared by engine + UI ───────────────────────── */

/** Margin on price → equivalent markup on cost, both in percent. */
export function marginToMarkup(marginPct: number): number {
  const m = marginPct / 100;
  return m >= 1 ? Infinity : (m / (1 - m)) * 100;
}

/** Unit price from unit cost and margin-on-price percent. */
export function priceFromCost(unitCost: number, marginPct: number): number {
  const m = marginPct / 100;
  if (m >= 1) return Infinity;
  return unitCost / (1 - m);
}
