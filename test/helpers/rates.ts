/**
 * Test fixture — the placeholder rate snapshot and machine park that
 * mirror the build prompt Step 9 seed values (supabase/seed.sql). Shared
 * by the pricing tests, the seed test and the UI agents' tests.
 * File path: /test/helpers/rates.ts
 *
 * Every price here is a placeholder ([CONFIRM] in the seed); `placeholder`
 * is therefore true on every row. Values the build prompt does not give
 * (labour rate, machining rate, pierce times per thickness, feature
 * prices, tube-laser prices, edge margin) are marked [CONFIRM] inline.
 * Use `cloneSnapshot()` / `cloneMachinePark()` when a test needs to mutate.
 */

import type {
  LaserRate,
  MachinePark,
  MaterialRate,
  RateSnapshot,
  TubeLaserRate,
} from "@/lib/pricing/types";

export const RATE_VERSION_ID = "00000000-0000-4000-8000-000000000001";

/** Mild steel 12 kW placeholder cutting data: [t mm, speed m/min, pierce s]. */
export const MILD_STEEL_CUTTING: ReadonlyArray<readonly [number, number, number]> = [
  [1, 25, 0.2],
  [2, 16, 0.3], // [CONFIRM] pierce times between 0.2 and 2.0 s interpolated
  [3, 11, 0.4],
  [4, 7, 0.5],
  [5, 5.5, 0.6],
  [6, 4.5, 0.8],
  [8, 3.0, 1.0],
  [10, 2.2, 1.5],
  [12, 1.7, 2.0],
];

/** Stainless and aluminium cut at 70 % of the mild-steel speeds. */
export const SOFT_SPEED_FACTOR = 0.7;

function timeRows(materialCode: string, factor: number, maxT: number): LaserRate[] {
  return MILD_STEEL_CUTTING.filter(([t]) => t <= maxT).map(([t, speed, pierce]) => ({
    materialCode,
    thicknessMm: t,
    mode: "time",
    speedMMin: speed * factor,
    pierceS: pierce,
    pricePerM: null,
    pricePerPierce: 0,
    gas: factor === 1 ? (t >= 3 ? "O2" : "N2") : "N2",
    minContourMm: null,
    inHouse: true,
    supplier: null,
    placeholder: true,
  }));
}

const supplierRows: LaserRate[] = [
  {
    materialCode: "S355",
    thicknessMm: 15,
    mode: "per_m",
    speedMMin: null,
    pierceS: null,
    pricePerM: 4.5, // [CONFIRM] subcontractor tariff
    pricePerPierce: 0.5, // [CONFIRM]
    gas: null,
    minContourMm: null,
    inHouse: false,
    supplier: "Plasma subcontractor [CONFIRM]",
    placeholder: true,
  },
  {
    materialCode: "S355",
    thicknessMm: 20,
    mode: "per_m",
    speedMMin: null,
    pierceS: null,
    pricePerM: 6.0, // [CONFIRM]
    pricePerPierce: 0.7, // [CONFIRM]
    gas: null,
    minContourMm: null,
    inHouse: false,
    supplier: "Plasma subcontractor [CONFIRM]",
    placeholder: true,
  },
];

const steelFormats = [
  { lengthMm: 3000, widthMm: 1500 },
  { lengthMm: 2500, widthMm: 1250 },
];

const materials: MaterialRate[] = [
  {
    code: "S235",
    name: "S235JR",
    family: "mild_steel",
    densityKgM3: 7850,
    rmNmm2: 400,
    pricePerKg: [{ maxThicknessMm: 30, pricePerKg: 1.1 }],
    sheetFormats: steelFormats,
    scrapPctDefault: 25,
    placeholder: true,
  },
  {
    code: "S355",
    name: "S355J2",
    family: "mild_steel",
    densityKgM3: 7850,
    rmNmm2: 510,
    pricePerKg: [{ maxThicknessMm: 30, pricePerKg: 1.2 }],
    sheetFormats: steelFormats,
    scrapPctDefault: 25,
    placeholder: true,
  },
  {
    code: "DC01",
    name: "DC01 cold rolled",
    family: "mild_steel",
    densityKgM3: 7850,
    rmNmm2: 350, // [CONFIRM] DC01 Rm 270–410
    pricePerKg: [{ maxThicknessMm: 30, pricePerKg: 1.05 }],
    sheetFormats: steelFormats,
    scrapPctDefault: 25,
    placeholder: true,
  },
  {
    code: "1.4301",
    name: "Stainless 1.4301 (304)",
    family: "stainless",
    densityKgM3: 7900,
    rmNmm2: 600, // [CONFIRM] 1.4301 Rm 520–720
    pricePerKg: [{ maxThicknessMm: 30, pricePerKg: 3.6 }],
    sheetFormats: [{ lengthMm: 3000, widthMm: 1500 }],
    scrapPctDefault: 25,
    placeholder: true,
  },
  {
    code: "AW5754",
    name: "Aluminium EN AW-5754",
    family: "aluminium",
    densityKgM3: 2700,
    rmNmm2: 200, // [CONFIRM] AW-5754 H111 Rm 190–240
    pricePerKg: [{ maxThicknessMm: 30, pricePerKg: 4.5 }],
    sheetFormats: [{ lengthMm: 3000, widthMm: 1500 }],
    scrapPctDefault: 25,
    placeholder: true,
  },
];

const tubeLaser: TubeLaserRate[] = (["round", "square", "rectangular", "open"] as const).flatMap(
  (profileFamily) => [
    { profileFamily, wallMm: 3, pricePerMCut: 3.0, handlingPerPart: 1.0, setup: 10, placeholder: true }, // [CONFIRM]
    { profileFamily, wallMm: 6, pricePerMCut: 4.0, handlingPerPart: 1.0, setup: 10, placeholder: true }, // [CONFIRM]
  ]
);

export const RATE_SNAPSHOT_V1: RateSnapshot = {
  versionId: RATE_VERSION_ID,
  label: "v1 placeholder seed",
  materials,
  laser: [
    ...timeRows("S235", 1, 12),
    ...timeRows("S355", 1, 12),
    ...timeRows("DC01", 1, 12),
    ...timeRows("1.4301", SOFT_SPEED_FACTOR, 12),
    // aluminium rows go to 8 mm on purpose: 8 mm is above the 6 mm machine
    // limit, so the lookup must ignore that in-house row.
    ...timeRows("AW5754", SOFT_SPEED_FACTOR, 8),
    ...supplierRows,
  ],
  tubeLaser,
  bend: [
    { thicknessMm: 6, lengthClassMm: 500, pricePerBend: 0.9, setupPerPartType: 8, placeholder: true },
    { thicknessMm: 6, lengthClassMm: 1500, pricePerBend: 1.6, setupPerPartType: 8, placeholder: true },
    { thicknessMm: 6, lengthClassMm: 4420, pricePerBend: 3.0, setupPerPartType: 8, placeholder: true },
    // +50 % above 6 mm
    { thicknessMm: 20, lengthClassMm: 500, pricePerBend: 1.35, setupPerPartType: 8, placeholder: true },
    { thicknessMm: 20, lengthClassMm: 1500, pricePerBend: 2.4, setupPerPartType: 8, placeholder: true },
    { thicknessMm: 20, lengthClassMm: 4420, pricePerBend: 4.5, setupPerPartType: 8, placeholder: true },
  ],
  roll: [{ thicknessMm: 6, radiusClassMm: 3000, pricePerM: 12, setup: 25, placeholder: true }],
  weld: [
    { process: "mig_mag", beadMm: 4, pricePerMm: 0.045, setup: 15, minOrder: 60, placeholder: true },
    { process: "tig", beadMm: 4, pricePerMm: 0.09, setup: 15, minOrder: 60, placeholder: true },
    { process: "laser", beadMm: 2, pricePerMm: 0.06, setup: 15, minOrder: 60, placeholder: true },
    { process: "mma", beadMm: 4, pricePerMm: 0.07, setup: 15, minOrder: 60, placeholder: true },
  ],
  thread: [
    { size: "M3", priceEach: 0.6, placeholder: true },
    { size: "M4", priceEach: 0.6, placeholder: true },
    { size: "M5", priceEach: 0.7, placeholder: true },
    { size: "M6", priceEach: 0.8, placeholder: true },
    { size: "M8", priceEach: 0.9, placeholder: true },
    { size: "M10", priceEach: 1.0, placeholder: true },
    { size: "M10x1", priceEach: 1.0, placeholder: true },
    { size: "M12", priceEach: 1.2, placeholder: true },
    { size: "M12x1.5", priceEach: 1.2, placeholder: true },
    { size: "M16", priceEach: 1.4, placeholder: true },
    { size: "M20", priceEach: 1.5, placeholder: true },
  ],
  feature: [
    { code: "countersink", name: "Countersink", priceEach: 0.8, placeholder: true }, // [CONFIRM]
    { code: "bore_h7", name: "H7 bore", priceEach: 4.0, placeholder: true }, // [CONFIRM]
    { code: "insert", name: "Press-in insert", priceEach: 1.2, placeholder: true }, // [CONFIRM]
    { code: "stud", name: "Welded stud", priceEach: 1.5, placeholder: true }, // [CONFIRM]
  ],
  finish: [
    { code: "powder", name: "Powder coating", unit: "m2", price: 14, minimum: 25, placeholder: true },
    { code: "zinc", name: "Zinc plating", unit: "kg", price: 1.2, minimum: 30, placeholder: true },
    { code: "deburr", name: "Deburring", unit: "m", price: 0.4, minimum: 0, placeholder: true },
    { code: "engrave", name: "Engraving / marking", unit: "m", price: 1.0, minimum: 0, placeholder: true }, // [CONFIRM]
  ],
  general: {
    machineRateEurH: 70,
    labourRateEurH: 35, // [CONFIRM] not in the build prompt
    machiningRateEurH: 60, // [CONFIRM] not in the build prompt
    defaultMarginPct: 30,
    marginByClass: {},
    blankMarginMm: 10,
    slowContourFactor: 1.5,
    defaultStitch: { beadLengthMm: 30, pitchMm: 60 },
    handlingMassLimitKg: 25,
    handlingSurchargeEur: 10, // [CONFIRM]
    weldHandlingPerPart: 5, // [CONFIRM]
    placeholder: true,
  },
};

/** Machine park — spec §8, all limits confirmed by the owner on 25 Sep 2026. */
export const MACHINE_PARK: MachinePark = [
  {
    code: "flat_laser_1",
    name: "TRUMPF TruFiber 12001 (12 kW)",
    kind: "flat_laser",
    limits: {
      bedLengthMm: 3000,
      bedWidthMm: 1500,
      zMm: 120,
      edgeMarginMm: 10, // [CONFIRM] usable bed = bed − 2 × margin
      maxThicknessMm: {
        mild_steel: 12.7,
        stainless: 12.7,
        aluminium: 6,
        brass: 6,
        copper: 6,
      },
    },
  },
  {
    code: "tube_laser_1",
    name: "TRUMPF tube laser (12 kW)",
    kind: "tube_laser",
    limits: {
      maxRoundDiameterMm: 273,
      maxRectSideMm: 254,
      maxCircumscribedMm: 290,
      maxLengthMm: 6500,
      maxKgPerM: 40,
      maxRawWeightKg: 260,
      wallThicknessMm: {
        mild_steel: [14, 10],
        stainless: [12.5, 8],
        aluminium: [12.5, 8],
        copper: [5, 5],
        brass: [5, 5],
      },
    },
  },
  {
    code: "press_brake_1",
    name: "Press brake 3200 kN / 4420 mm",
    kind: "press_brake",
    limits: {
      forceKN: 3200,
      bendLengthMm: 4420,
      betweenColumnsMm: 3680,
      openHeightMm: 615,
      dieFactor: 8,
    },
  },
  {
    code: "roll_1",
    name: "Plate roll 3200 mm",
    kind: "roll",
    limits: { maxWidthMm: 3200, minRadiusMm: 200, maxThicknessMm: 6 },
  },
  {
    code: "weld_1",
    name: "Welding bay",
    kind: "weld",
    limits: { processes: ["mig_mag", "tig", "laser", "mma"] },
  },
];

export function cloneSnapshot(): RateSnapshot {
  return structuredClone(RATE_SNAPSHOT_V1);
}

export function cloneMachinePark(): MachinePark {
  return structuredClone(MACHINE_PARK);
}

/* ─── Snapshot ⇄ DB rows (for the seed test and round-trip tests) ── */

import type {
  MachineRow,
  MaterialRow,
  RateBendRow,
  RateFeatureRow,
  RateFinishRow,
  RateGeneralRow,
  RateLaserRow,
  RateRollRow,
  RateThreadRow,
  RateTubeLaserRow,
  RateWeldRow,
} from "@/lib/db/types";
import type { RateRows } from "@/lib/pricing/snapshot";

/** DB-shaped rows for a snapshot — the same shape supabase/seed.sql inserts. */
export function rateSnapshotToRows(snapshot: RateSnapshot): RateRows {
  const v = snapshot.versionId;
  let n = 0;
  const id = (): string => `row-${(n += 1).toString().padStart(4, "0")}`;
  const general: RateGeneralRow = {
    rate_version_id: v,
    machine_rate_eur_h: snapshot.general.machineRateEurH,
    labour_rate_eur_h: snapshot.general.labourRateEurH,
    machining_rate_eur_h: snapshot.general.machiningRateEurH,
    default_margin_pct: snapshot.general.defaultMarginPct,
    margin_by_class: snapshot.general.marginByClass,
    blank_margin_mm: snapshot.general.blankMarginMm,
    slow_contour_factor: snapshot.general.slowContourFactor,
    default_stitch_bead_mm: snapshot.general.defaultStitch.beadLengthMm,
    default_stitch_pitch_mm: snapshot.general.defaultStitch.pitchMm,
    handling_mass_limit_kg: snapshot.general.handlingMassLimitKg,
    handling_surcharge_eur: snapshot.general.handlingSurchargeEur,
    weld_handling_per_part: snapshot.general.weldHandlingPerPart,
    placeholder: snapshot.general.placeholder,
  };
  const materials: MaterialRow[] = snapshot.materials.map((m) => ({
    rate_version_id: v,
    code: m.code,
    name: m.name,
    family: m.family,
    density_kg_m3: m.densityKgM3,
    rm_n_mm2: m.rmNmm2,
    price_per_kg: m.pricePerKg,
    sheet_formats: m.sheetFormats,
    scrap_pct_default: m.scrapPctDefault,
    placeholder: m.placeholder,
  }));
  const laser: RateLaserRow[] = snapshot.laser.map((r) => ({
    id: id(),
    rate_version_id: v,
    material_code: r.materialCode,
    thickness_mm: r.thicknessMm,
    mode: r.mode,
    speed_m_min: r.speedMMin,
    pierce_s: r.pierceS,
    price_per_m: r.pricePerM,
    price_per_pierce: r.pricePerPierce,
    gas: r.gas,
    min_contour_mm: r.minContourMm,
    in_house: r.inHouse,
    supplier: r.supplier,
    placeholder: r.placeholder,
  }));
  const tubeLaser: RateTubeLaserRow[] = snapshot.tubeLaser.map((r) => ({
    id: id(),
    rate_version_id: v,
    profile_family: r.profileFamily,
    wall_mm: r.wallMm,
    price_per_m_cut: r.pricePerMCut,
    handling_per_part: r.handlingPerPart,
    setup: r.setup,
    placeholder: r.placeholder,
  }));
  const bend: RateBendRow[] = snapshot.bend.map((r) => ({
    id: id(),
    rate_version_id: v,
    thickness_mm: r.thicknessMm,
    length_class_mm: r.lengthClassMm,
    price_per_bend: r.pricePerBend,
    setup_per_part_type: r.setupPerPartType,
    placeholder: r.placeholder,
  }));
  const roll: RateRollRow[] = snapshot.roll.map((r) => ({
    id: id(),
    rate_version_id: v,
    thickness_mm: r.thicknessMm,
    radius_class_mm: r.radiusClassMm,
    price_per_m: r.pricePerM,
    setup: r.setup,
    placeholder: r.placeholder,
  }));
  const weld: RateWeldRow[] = snapshot.weld.map((r) => ({
    id: id(),
    rate_version_id: v,
    process: r.process,
    bead_mm: r.beadMm,
    price_per_mm: r.pricePerMm,
    setup: r.setup,
    min_order: r.minOrder,
    placeholder: r.placeholder,
  }));
  const thread: RateThreadRow[] = snapshot.thread.map((r) => ({
    id: id(),
    rate_version_id: v,
    size: r.size,
    price_each: r.priceEach,
    placeholder: r.placeholder,
  }));
  const feature: RateFeatureRow[] = snapshot.feature.map((r) => ({
    id: id(),
    rate_version_id: v,
    code: r.code,
    name: r.name,
    price_each: r.priceEach,
    placeholder: r.placeholder,
  }));
  const finish: RateFinishRow[] = snapshot.finish.map((r) => ({
    id: id(),
    rate_version_id: v,
    code: r.code,
    name: r.name,
    unit: r.unit,
    price: r.price,
    minimum: r.minimum,
    placeholder: r.placeholder,
  }));
  return {
    version: { id: v, label: snapshot.label },
    general,
    materials,
    laser,
    tubeLaser,
    bend,
    roll,
    weld,
    thread,
    feature,
    finish,
  };
}

/** DB-shaped machine rows for a machine park (limits as JSON). */
export function machineParkToRows(park: MachinePark): MachineRow[] {
  return park.map((m) => ({
    code: m.code,
    name: m.name,
    kind: m.kind,
    limits: JSON.parse(JSON.stringify(m.limits)),
    updated_by: null,
    updated_at: "2026-09-25T00:00:00Z",
  }));
}
