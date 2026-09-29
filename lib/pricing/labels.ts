/**
 * Pricing engine — the stable `label` keys written on auto-generated
 * operation lines. The UI maps these to localized text
 * (content/quote.ts); anything not in this list is free text from the
 * rate table (feature/finish names), the thread size, or the user's own
 * label on an "other" extra.
 * File path: /lib/pricing/labels.ts
 */

export const OPERATION_LABELS = {
  laserCut: "laser_cut",
  subcontractCutting: "subcontract_cutting",
  material: "material",
  materialTube: "material_tube",
  bend: "bend",
  bendSetup: "bend_setup",
  roll: "roll",
  weld: "weld",
  weldSetup: "weld_setup",
  weldHandling: "weld_handling",
  weldMinOrder: "weld_min_order",
  thread: "thread",
  machining: "machining",
  engrave: "engrave",
  tubeCut: "tube_cut",
  handling: "handling",
  laserSetup: "laser_setup",
  deburrSetup: "deburr_setup",
  orderCharge: "order_charge",
  packagingBox: "packaging_box",
  packagingPallet: "packaging_pallet",
  leadTime: "lead_time",
  deburr: "deburr",
  finishSetup: "finish_setup",
  threadSetup: "thread_setup",
  /** Market mode: bend-line tool set-up (rate_bend.setup_per_bend_line_eur × bend lines). */
  bendLineSetup: "bend_line_setup",
  /** Market mode: per-line set-up of a feature (countersinks, press-in nuts). */
  featureSetup: "feature_setup",
  /** Market mode, quote level: top-up to a finish's minimum (per order or per colour). */
  finishMinimum: "finish_minimum",
  /* ─── Assembly mode (docs/assembly-mode-design.md §3) ─── */
  /** Quote-level packaging picked from packaging_rates (details.code = row code). */
  packaging: "packaging",
  /** Quote-level shipping line (manual or shipping_rates band). */
  shipping: "shipping",
  /** Assembly: member parts at cost (material + cutting of the cost version). */
  assemblyParts: "assembly_parts",
  assemblyFitup: "assembly_fitup",
  assemblyTack: "assembly_tack",
  assemblyWeld: "assembly_weld",
  assemblyGasWire: "assembly_gas_wire",
  assemblyDeburr: "assembly_deburr",
  assemblyHandling: "assembly_handling",
  /** Forming priced as press-brake hits (step bending) or rolling minutes. */
  stepBend: "step_bend",
  rollForming: "roll_forming",
  /** Subcontracted forming: supplier cost × (1 + subcontract margin). */
  subcontractForming: "subcontract_forming",
  /** Job setups charged once per job and spread over the quantity. */
  setupLaserNest: "setup_laser_nest",
  setupPressBrake: "setup_press_brake",
  setupRoll: "setup_roll",
  setupWeldFitup: "setup_weld_fitup",
} as const;

export type OperationLabelKey = (typeof OPERATION_LABELS)[keyof typeof OPERATION_LABELS];
