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
  /** Market mode: charged once per distinct (material, thickness) in a quote, split over the part lines. */
  setupEur: number;
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
  /** rate_bend.id of the row (null in fixtures without one) — stored on the bend line's cost breakdown for the audit. */
  id?: string | null;
  thicknessMm: number;
  /** Bend length ≤ lengthClassMm (classes sorted ascending). */
  lengthClassMm: number;
  pricePerBend: number;
  setupPerPartType: number;
  placeholder: boolean;
  /** Market mode: EUR once per distinct bend line of a part type (tool set-up), on top of setupPerPartType. */
  setupPerBendLineEur: number;
  /** Market mode: factor on setupPerBendLineEur and pricePerBend by material family (absent = 1). */
  familyMultipliers: Partial<Record<MaterialFamily, number>>;
  /** Market mode: material codes the row was benchmarked for; null = any material of the version. */
  materialCodes: string[] | null;
  /** Market mode: EUR per metre of bend length beyond the benchmark's 200 mm, added to pricePerBend per bend per piece. */
  pricePerBendPerM: number;
  /** Market mode: longest bend actually benchmarked; longer bends are priced with the per-metre extension and flagged amber. null = no limit. */
  benchmarkedMaxLengthMm: number | null;
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
  /** Market mode: charged once per quote line that carries threads of this size (EUR). */
  setupPerLineEur: number;
  /** Market mode: EUR per thread by sheet thickness — exact match, no interpolation; empty = priceEach for any thickness. */
  priceByThickness: ThreadPriceByThickness[];
  /** Market mode: material codes the row was benchmarked for; null = any material of the version. */
  materialCodes: string[] | null;
};

export type ThreadPriceByThickness = { thicknessMm: number; priceEach: number };

export type FeatureRate = {
  code: string;
  name: string;
  priceEach: number;
  placeholder: boolean;
  /** Market mode: charged once per quote line that carries this feature (EUR). */
  setupPerLineEur: number;
  /** Market mode: material codes the row was benchmarked for; null = any material of the version. */
  materialCodes: string[] | null;
  /** Market mode: eligible sheet thickness range (null = open end). */
  minThicknessMm: number | null;
  maxThicknessMm: number | null;
};

/** "part" = a price per part (market engraving); "each" is the older synonym kept for existing rows. */
export type FinishUnit = "m2" | "kg" | "m" | "each" | "part";

export type FinishRate = {
  /** "powder", "zinc", "deburr", … */
  code: string;
  name: string;
  unit: FinishUnit;
  price: number;
  minimum: number;
  placeholder: boolean;
  /** Market mode: setup charged once per order, split over the lines that carry this finish. */
  setupPerOrderEur: number;
  /** Market mode: charged once per quote line (part type) that carries this finish (EUR). */
  setupPerLineEur: number;
  /** Free-text minimum part size rule (lib/pricing/market-rules.ts parseMinPartRule). */
  minPartMm: string | null;
  /** Market mode: material codes the finish is offered for; null = any material of the version. */
  materialCodes: string[] | null;
  /** Market mode: eligible sheet thickness range (null = open end). */
  minThicknessMm: number | null;
  maxThicknessMm: number | null;
  /** Market mode: EUR per piece on top of the unit price (handling). */
  pricePerPartEur: number;
  /** Market mode: a quote carrying this finish cannot be offered below this lead time (working days); 0 = no limit. */
  minLeadTimeDays: number;
  /** Market mode: `minimum` applies once per quote ("order") or once per distinct colour of this finish ("colour"). */
  minimumScope: FinishMinimumScope;
  /** Market mode: false = the amount is not multiplied by the lead-time multiplier (certificates). */
  tierMultiplierApplies: boolean;
  /** Market mode: machine-readable limits, e.g. { maxOrderNetKg: 10 }. */
  limits: FinishLimits;
};

export type FinishMinimumScope = "order" | "colour";

/** rate_finish.limits — known keys typed, anything else kept. */
export type FinishLimits = { maxOrderNetKg?: number } & Record<string, unknown>;

/** rate_leadtime row: a promised lead time (working days) and its price multiplier. */
export type LeadtimeRate = {
  workingDays: number;
  multiplier: number;
  placeholder: boolean;
};

/**
 * "cost": the rate tables are our costs (machine-hour model) and the quote
 * margin is added on top. "market": the tables are SELLING prices (e.g.
 * 247TailorSteel × 1.10); the margin is computed against a cost version.
 */
export type PricingMode = "cost" | "market";

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
  /** Market mode: one order charge per quote, split equally over the part lines (EUR). */
  orderChargeEur: number;
  packagingBoxEur: number;
  packagingPalletEur: number;
  pricingMode: PricingMode;
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
  leadtime: LeadtimeRate[];
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

/** One row of press_brake_tools: a punch or a die. */
export type PressBrakeTool =
  | { kind: "punch"; code: string; name: string; heightMm: number; type: "straight" | "gooseneck"; tipRadiusMm: number; throatDepthMm: number | null; placeholder: boolean }
  | { kind: "die"; code: string; name: string; vMm: number; minFlangeMm: number; placeholder: boolean };

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
      /** Punches and dies (press_brake_tools table), attached by lib/rates/load.ts for the DFM checks. */
      tools?: PressBrakeTool[];
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
  | {
      type: "finish";
      code: string;
      maskingMinutes: number;
      note: string | null;
      /** Colour of the finish where it matters (powder coating: "RAL 9005"); the per-colour minimum groups on it. */
      colour?: string | null;
    }
  | {
      type: "tube_cut";
      profileFamily: TubeLaserRate["profileFamily"];
      wallMm: number;
      cutLengthMm: number;
      metres: number;
      pricePerMTube: number | null;
      /** Optional envelope for the tube-laser limit check: outer diameter (round) or larger side (square/rectangular/open), mm. */
      envelopeMm?: number | null;
      /** Optional circumscribed circle of a rectangular profile, mm. */
      circumscribedMm?: number | null;
      /** Optional linear mass of the raw profile, kg/m (raw weight = kgPerM × metres). */
      kgPerM?: number | null;
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
  /** Order quantity in pieces. For an assembly member the server keeps it equal to assembly.qty × qtyPerAssembly. */
  qty: number;
  extras: ExtraOperation[];
  /** Scrap override for this item (percent), else material default. */
  scrapPct: number | null;
  /** Member of a welded assembly (QuoteInput.assemblies) — priced inside it, never as a loose line. */
  assemblyId?: string | null;
  qtyPerAssembly?: number;
  /** The member keeps its own material instead of the assembly's. */
  materialOverride?: boolean;
  /** Note printed on the quote when a substitute grade is quoted (material.substituted). */
  materialNote?: string | null;
  /** Explicit forming operations (rolling, bending) with their feasibility resolution. */
  forming?: FormingOperation[];
};

/* ─── Assemblies, forming, job rates (docs/assembly-mode-design.md) ── */

export type SeamType = "continuous" | "stitch" | "tack";

/** A seam of a welded assembly (stored at assembly level, counted once). */
export type AssemblySeam = {
  id: string;
  label: string | null;
  /** Part whose edge was marked (null = typed by hand). */
  partId: string | null;
  lengthMm: number;
  process: WeldProcess;
  /** Material thickness at the joint (drives the weld speed); null = the assembly thickness. */
  thicknessMm: number | null;
  type: SeamType;
  stitch: { beadLengthMm: number; pitchMm: number } | null;
  tackCount: number | null;
  sides: 1 | 2;
  /** The seam this one duplicates (the neighbour's edge of the same joint): not counted. */
  pairedSeamId: string | null;
};

export type FormingResolution =
  | { kind: "in_house" }
  | { kind: "step_bend"; hits: number }
  | { kind: "subcontract"; supplier: string; costEur: number; extraLeadDays: number }
  /** The user confirmed that no forming is needed although the drawing suggested it. */
  | { kind: "none_needed" };

export type FormingOperation =
  | { id: string; kind: "roll"; insideRadiusMm: number; angleDeg: number; widthMm: number; resolution: FormingResolution | null }
  | { id: string; kind: "bend"; bends: number; angleDeg: number; lengthMm: number; resolution: FormingResolution | null };

export type PricingAssembly = {
  id: string;
  position: number;
  name: string;
  drawingRef: string | null;
  /** Assemblies ordered. */
  qty: number;
  materialCode: string | null;
  thicknessMm: number | null;
  seams: AssemblySeam[];
};

export type CustomerType = "b2b" | "b2c";

export type ShippingInput = {
  /** ISO-2 destination. */
  countryCode: string;
  /** Gross mass typed by the user, else computed from the parts + packaging. */
  grossKg: number | null;
  /** Cost typed by the user (source manual) or taken from shipping_rates (source table). */
  costEur: number | null;
  source: "manual" | "table";
  carrier: string | null;
  extraLeadDays: number;
};

export type JobSetupCode = "laser_nest" | "press_brake" | "roll" | "weld_fitup";

export type WeldSpeed = { process: WeldProcess; thicknessMm: number; speedMmMin: number };
export type PackagingRate = { code: string; name: string; maxSideMm: number; maxMassKg: number; priceEur: number; position: number };
export type ShippingRate = { countryCode: string; maxKg: number; priceEur: number; carrier: string | null };

/** Admin-edited job rates (settings tables), loaded by lib/rates/load.ts loadJobRates and mapped by lib/pricing/job-rates.ts. */
export type JobRates = {
  /** EUR once per job per setup kind. */
  setups: Record<JobSetupCode, number>;
  assembly: {
    labourRateEurH: number;
    gasWireEurH: number;
    tackSeconds: number;
    fitupMinPerPart: number;
    deburrMinPerPart: number;
    handlingMinPerAssembly: number;
    distortionFactor: number;
    stepBendSecondsPerHit: number;
    rollMinPerM: number;
  };
  weldSpeeds: WeldSpeed[];
  packaging: PackagingRate[];
  shipping: ShippingRate[];
  /** ISO-2 country → VAT %. */
  vatRates: Record<string, number>;
  ossActive: boolean;
  /** Minimum margin on revenue for assemblies, percent. */
  assemblyMarginPct: number;
  subcontractMarginPct: number;
  /** ISO-2 of the company (PL). */
  homeCountry: string;
  /** Any used row is still a placeholder. */
  placeholder: boolean;
};

/**
 * Owner's rule (29 Sep 2026): a customer in Poland pays 23 % with or without
 * a VAT number; a customer outside Poland pays 0 % when a VAT number is given
 * (reverse charge / WDT inside the EU, export outside) and 23 % without one —
 * unless OSS is active and the customer is a private person in another EU
 * country, who then pays that country's rate.
 */
export type VatMode = "none" | "pl_domestic" | "b2c_domestic" | "b2c_oss" | "reverse_charge" | "export";

export type VatResult = {
  mode: VatMode;
  ratePct: number;
  /** Country the rate belongs to (null for none / reverse charge). */
  countryCode: string | null;
  /** EUR, engine truth. */
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
};

export type PriceScaleEntry = { qty: number; unitPrice: number | null; total: number | null };
export type PriceScale = { subjectId: string; kind: "item" | "assembly"; entries: PriceScaleEntry[] };

export type AssemblyLabour = {
  fitupMin: number;
  tackMin: number;
  weldMin: number;
  deburrMin: number;
  handlingMin: number;
  formingMin: number;
  /** After the distortion / handling factor. */
  totalMin: number;
  /** Arc time (gas + wire). */
  arcMin: number;
};

export type PricedAssembly = {
  assemblyId: string;
  name: string;
  drawingRef: string | null;
  materialCode: string | null;
  thicknessMm: number | null;
  qty: number;
  memberItemIds: string[];
  /** Cost breakdown per assembly (EUR): parts at cost, labour, setups, forming, subcontract. */
  operations: OperationLine[];
  unitCost: number;
  /** null = unpriceable (an unresolved forming operation, a refused member). */
  unitPrice: number | null;
  batchCost: number;
  batchPrice: number | null;
  /** Margin on revenue actually applied, percent. */
  marginPct: number;
  labour: AssemblyLabour;
  /** Counted seam length (paired seams excluded), mm. */
  seamLengthMm: number;
  flags: Flag[];
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
  /** Promised lead time in working days (market mode: drives the rate_leadtime multiplier). */
  leadTimeDays?: number | null;
  /** Welded assemblies; their member items carry assemblyId. */
  assemblies?: PricingAssembly[];
  customerType?: CustomerType | null;
  /** ISO-2 of the customer (VAT, shipping). */
  customerCountry?: string | null;
  customerVatId?: string | null;
  shipping?: ShippingInput | null;
  /** Extra quantities to price for every item / assembly (price scale). */
  priceScale?: number[];
};

/** Optional inputs of priceQuote. */
export type PriceQuoteOptions = {
  /**
   * Market mode: the cost version (machine-hour model) the same quote is
   * priced with to compute the margin. Ignored in cost mode.
   */
  costRates?: RateSnapshot | null;
  /** Admin-edited job rates (assemblies, setups, packaging, shipping, VAT); null = none loaded. */
  jobRates?: JobRates | null;
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
  | "order"
  | "packaging"
  /** Quote-level shipping line (PricedQuote.shipping), outside the assembly margin. */
  | "shipping"
  | "leadtime"
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
    | "rate_leadtime"
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
  | "finish.part_too_small"
  | "finish.not_for_family"
  | "market.margin_below_default"
  | "market.no_cost_version"
  | "sheet.bend_deduction_unverified"
  | "sheet.masking_not_priced"
  | "sheet.hardware_mismatch"
  | "sheet.revision_mismatch"
  | "sheet.not_sheet_metal"
  | "sheet.service_unavailable"
  | "dfm.relief_too_narrow"
  | "dfm.hole_near_bend"
  | "dfm.flange_too_short"
  | "dfm.bend_collision"
  | "dfm.laser_cannot_make"
  | "dfm.flat_mass_mismatch"
  | "dfm.open_contour"
  | "dfm.overlapping_cuts"
  /** Market mode: no rate_laser row for exactly this material + thickness (or no thread row) — quote manually. */
  | "market.no_benchmark_rate"
  /** Market mode: the active version has no rows for this operation (bending, welding, …) — quote manually. */
  | "market.not_benchmarked"
  /** Market mode: requested lead time shorter than the shortest offered tier. */
  | "market.leadtime_not_offered"
  /** Market mode: priced from an in_house = false row (subcontract) — informational. */
  | "market.subcontract"
  /** Market mode: a lump sum / minutes typed by the user — not a benchmarked price. */
  | "market.manual_price"
  /** Market mode: an edge-breaking option was dropped because the coating on the same line already includes it. */
  | "market.finish_implied"
  /** Market mode: a bend longer than the version's length class (our press brake) — refused. */
  | "market.bend_too_long"
  /** Market mode: a bend longer than the benchmarked length — priced with the per-metre extension, amber. */
  | "market.extrapolated_rate"
  | "market.bend_rate_from_steel"
  | "market.cost_plus"
  | "forming.not_feasible"
  | "forming.suspected"
  | "forming.step_bend"
  | "forming.subcontract"
  | "assembly.mixed_materials"
  | "assembly.no_seams"
  | "material.substituted"
  | "customer.vat_id_missing"
  | "shipping.missing"
  /** No vat_rates row for the company's home country — the taxed modes would print 0 %. */
  | "vat.no_rate"
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
  /** Flat-pattern points the viewer circles (DFM checks on STEP sheet parts). */
  locations?: { x: number; y: number }[];
};

export type PricedItem = {
  itemId: string;
  partId: string;
  qty: number;
  operations: OperationLine[];
  unitCost: number;
  /** null = refused (market mode: no benchmark for this part) — no number is shown anywhere. */
  unitPrice: number | null;
  batchCost: number;
  batchPrice: number | null;
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
  /**
   * The margin the quote was priced WITH (QuoteInput.marginPct): in cost
   * mode the margin on price of every line (= marginPct); in market mode
   * the cost-plus margin of the operations the version does not benchmark
   * (marginPct is then the realised margin against the cost version). Lets
   * a stored snapshot be compared with the header it was computed from.
   */
  inputMarginPct: number;
  flags: Flag[];
  /** True when any rate used is still a placeholder ([CONFIRM]). */
  usesPlaceholderRates: boolean;
  rateVersionId: string;
  /** PRICING_ENGINE_VERSION (lib/pricing/version.ts) the result was computed with; an older stored pricing is stale. */
  engineVersion: number;
  pricingMode: PricingMode;
  /** Market mode: the cost version the margin was computed against (null in cost mode / when none was given). */
  costRateVersionId: string | null;
  /** Promised lead time the multiplier was resolved for (null = list price). */
  leadTimeDays: number | null;
  leadTimeMultiplier: number;
  /** Quote-level lot lines (market packaging); included in subtotalPrice. */
  quoteLines: OperationLine[];
  /** Welded assemblies priced as one line each (docs/assembly-mode-design.md). */
  assemblies: PricedAssembly[];
  /** Shipping line (its own line on the PDF, outside the assembly margin); included in subtotalPrice. */
  shipping: OperationLine | null;
  /** VAT on the net total for the PDF; null when no customer type is known. */
  vat: VatResult | null;
  /** Unit prices at the extra quantities of QuoteInput.priceScale. */
  priceScale: PriceScale[];
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
